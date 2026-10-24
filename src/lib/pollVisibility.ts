import type { createServiceRoleClient } from "@/lib/supabase/server";
import { getPollEnd, getPollState, type PollTiming } from "@/lib/pollSchedule";
import { timingSelect } from "@/lib/pollTiming";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// Hiding closed polls from the public page. Nothing is ever deleted: a hidden
// poll keeps its votes, options, picture and results, and the results email is
// unaffected. Whether a poll shows is decided here, from the real clock, on
// every request -- no cron job is involved.
//
//   - Open, scheduled and queued polls always show (they can't be hidden).
//   - "Hide from site" (hidden_at set) hides a closed poll, whatever the timer.
//   - "Show on site" (force_shown) keeps a closed poll visible; the auto-hide
//     timer is ignored for it.
//   - Otherwise, with "Hide closed polls after" set, a closed poll hides that
//     long after its real close time.
//
// The columns come from supabase/poll_hide.sql. Until it's run nothing hides.

export const HIDE_SQL_HINT =
  "Hiding polls needs the database changes first: run supabase/poll_hide.sql in the Supabase SQL Editor.";

export const AUTO_HIDE_SETTING_KEY = "poll_auto_hide_hours";

// "Hide closed polls after" choices, in hours (null = never, the default).
export const AUTO_HIDE_CHOICES: { hours: number | null; label: string }[] = [
  { hours: null, label: "Never" },
  { hours: 6, label: "6 hours" },
  { hours: 12, label: "12 hours" },
  { hours: 24, label: "1 day" },
  { hours: 48, label: "2 days" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
];

export function autoHideLabel(hours: number | null): string {
  return AUTO_HIDE_CHOICES.find((c) => c.hours === hours)?.label ?? `${hours} hours`;
}

export function isAutoHideChoice(value: unknown): value is number | null {
  return AUTO_HIDE_CHOICES.some((c) => c.hours === value);
}

// ---- do the columns / setting exist? -----------------------------------------

let confirmed = false;
let lastMissingAt = 0;
const RECHECK_MS = 20_000;

export function resetHideColumnCache() {
  confirmed = false;
  lastMissingAt = 0;
}

export async function hideColumnsExist(supabase: Supabase): Promise<boolean> {
  if (confirmed) return true;
  if (lastMissingAt && Date.now() - lastMissingAt < RECHECK_MS) return false;
  const { error } = await supabase.from("polls").select("hidden_at, force_shown").limit(1);
  if (error) {
    lastMissingAt = Date.now();
    return false;
  }
  confirmed = true;
  return true;
}

// The "Hide closed polls after" setting: hours, or null for never. Also null
// when the settings table doesn't exist yet.
export async function loadAutoHideHours(supabase: Supabase): Promise<{ supported: boolean; hours: number | null }> {
  const { data, error } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", AUTO_HIDE_SETTING_KEY)
    .maybeSingle();
  if (error) return { supported: false, hours: null };
  const value = (data as { value: unknown } | null)?.value ?? null;
  return { supported: true, hours: isAutoHideChoice(value) ? value : null };
}

// ---- the rule -------------------------------------------------------------------

export type HideFields = { hidden_at?: string | null; force_shown?: boolean | null };
export type VisibilityPoll = { status: string; opens_at: string; closes_at: string } & PollTiming & HideFields;

// When voting really stopped, or null while the poll is open or queued. A
// closed poll's stored closes_at is when it was flipped to closed, which for
// the daily job can be later than the end (cron runs anywhere in its hour) and
// for Close now is earlier -- so the real close is whichever came first. A
// poll still stored as open whose end has passed (the job hasn't run yet)
// closed at its end.
export function realCloseTime(poll: VisibilityPoll, now: Date = new Date()): Date | null {
  const state = getPollState(poll, now);
  if (state.phase === "ended") return state.end;
  if (state.phase !== "closed") return null;
  const flipped = new Date(poll.closes_at);
  const end = getPollEnd(poll);
  return end && end.getTime() < flipped.getTime() ? end : flipped;
}

export type PollVisibility =
  | { hidden: false; hideAt: Date | null }
  | { hidden: true; reason: "manual" }
  | { hidden: true; reason: "auto"; hours: number; since: Date };

export function getPollVisibility(
  poll: VisibilityPoll,
  autoHideHours: number | null,
  now: Date = new Date(),
): PollVisibility {
  const closedAt = realCloseTime(poll, now);
  if (!closedAt) return { hidden: false, hideAt: null };
  if (poll.hidden_at) return { hidden: true, reason: "manual" };
  if (poll.force_shown || !autoHideHours) return { hidden: false, hideAt: null };
  const hideAt = new Date(closedAt.getTime() + autoHideHours * 60 * 60 * 1000);
  if (now.getTime() >= hideAt.getTime()) return { hidden: true, reason: "auto", hours: autoHideHours, since: hideAt };
  return { hidden: false, hideAt };
}

// ---- the poll the public page shows -------------------------------------------------

export type PublicPollRow = { id: string; question: string; status: string; opens_at: string; closes_at: string } & PollTiming;

// The open poll if there is one, otherwise the most recently closed one --
// unless that one is hidden, in which case there is no poll card at all (an
// older poll is never shown in its place). Hidden polls' content never leaves
// the server.
export async function getPublicPoll(
  supabase: Supabase,
  now: Date = new Date(),
): Promise<{ poll: PublicPollRow | null; hideAt: Date | null }> {
  const timing = await timingSelect(supabase);
  const hideCols = (await hideColumnsExist(supabase)) ? ", hidden_at, force_shown" : "";
  const cols = `id, question, status, opens_at, closes_at${timing}${hideCols}`;

  const { data: openRow } = await supabase
    .from("polls")
    .select(cols)
    .eq("status", "open")
    .order("opens_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  type Row = PublicPollRow & HideFields;
  const row =
    (openRow as unknown as Row | null) ??
    ((
      await supabase
        .from("polls")
        .select(cols)
        .eq("status", "closed")
        .order("closes_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ).data as unknown as Row | null);

  if (!row) return { poll: null, hideAt: null };

  const hours = hideCols ? (await loadAutoHideHours(supabase)).hours : null;
  const visibility = getPollVisibility(row, hours, now);
  if (visibility.hidden) return { poll: null, hideAt: null };

  // The hide fields are admin-only; don't send them to visitors.
  const { hidden_at: _h, force_shown: _f, ...poll } = row;
  void _h;
  void _f;
  return { poll, hideAt: visibility.hideAt };
}

// ---- admin actions ------------------------------------------------------------------

export type HideResult = { ok: true; message: string } | { ok: false; status: number; code?: string; error: string };

// "Hide from site" / "Show on site" on a closed poll. Both are conditional
// updates, so a double click (or two tabs) can't stack up: hiding only sets
// hidden_at if it isn't already set, so the first click's timestamp stays.
export async function setPollHidden(supabase: Supabase, pollId: string, hide: boolean): Promise<HideResult> {
  if (!(await hideColumnsExist(supabase))) {
    return { ok: false, status: 400, code: "hide_unsupported", error: HIDE_SQL_HINT };
  }
  const { data: poll } = await supabase.from("polls").select("id, status, hidden_at").eq("id", pollId).maybeSingle();
  if (!poll) return { ok: false, status: 404, error: "Poll not found." };
  if (poll.status !== "closed") {
    return {
      ok: false,
      status: 409,
      code: "not_closed",
      error: "Only closed polls can be hidden or shown. Open, scheduled and queued polls always show.",
    };
  }

  if (hide) {
    const { error } = await supabase
      .from("polls")
      .update({ hidden_at: new Date().toISOString(), force_shown: false })
      .eq("id", pollId)
      .eq("status", "closed")
      .is("hidden_at", null);
    if (error) return { ok: false, status: 500, error: error.message };
    return { ok: true, message: poll.hidden_at ? "Already hidden from the site." : "Hidden from the site." };
  }

  const { error } = await supabase
    .from("polls")
    .update({ hidden_at: null, force_shown: true })
    .eq("id", pollId)
    .eq("status", "closed");
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, message: "Shown on the site. The auto-hide timer is ignored for this poll." };
}

export async function saveAutoHideHours(supabase: Supabase, hours: unknown): Promise<HideResult> {
  if (!isAutoHideChoice(hours)) return { ok: false, status: 400, error: "Pick one of the listed choices." };
  if (!(await hideColumnsExist(supabase)) || !(await loadAutoHideHours(supabase)).supported) {
    return { ok: false, status: 400, code: "hide_unsupported", error: HIDE_SQL_HINT };
  }
  const { error } = await supabase
    .from("site_settings")
    .upsert(
      { key: AUTO_HIDE_SETTING_KEY, value: hours, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) return { ok: false, status: 500, error: error.message };
  return {
    ok: true,
    message: hours === null ? "Closed polls stay on the site." : `Closed polls now hide ${autoHideLabel(hours)} after they close.`,
  };
}
