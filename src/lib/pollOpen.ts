import type { createServiceRoleClient } from "@/lib/supabase/server";
import { closePollAndFinish, type LifecycleDeps } from "@/lib/pollClose";
import {
  approxSpan,
  DAILY_COLUMNS,
  emailNoteFor,
  endForColumns,
  isDailyColumns,
  type DurationColumns,
} from "@/lib/pollDuration";
import {
  cutoffLabel,
  formatDuration,
  formatEasternDay,
  getDaysPollEnd,
  getOpenNowWindow,
  getPollState,
} from "@/lib/pollSchedule";
import { loadPollDuration, timingSelect } from "@/lib/pollTiming";

type Supabase = ReturnType<typeof createServiceRoleClient>;

type OpenPollRow = {
  id: string;
  question: string;
  status: string;
  repeat_daily: boolean;
  opens_at: string;
  ends_at?: string | null;
  open_ended?: boolean | null;
};

// Another poll that became open within this long of "now" counts as a
// simultaneous Open now (a double-click, or two admin tabs) rather than the
// poll being replaced.
const SIMULTANEOUS_MS = 10_000;
// ---------------------------------------------------------------------------
// Open now
// ---------------------------------------------------------------------------

async function listOpenPolls(supabase: Supabase): Promise<OpenPollRow[]> {
  const { data } = await supabase
    .from("polls")
    .select(`id, question, status, repeat_daily, opens_at${await timingSelect(supabase)}`)
    .eq("status", "open")
    .order("opens_at", { ascending: false });
  return (data ?? []) as unknown as OpenPollRow[];
}

export type RepeatOutcome = "none" | "queue_copy" | "pause" | "pause_for_long";

export type OpenNowInfo = {
  allowed: boolean;
  cutoff: string;
  durationText: string | null;
  message: string;
  // True when the poll being opened has a chosen duration (not the daily one).
  long: boolean;
  // Shown when voting ends at some time other than the 8 PM cutoff.
  emailNote: string | null;
  // The poll that is open right now and would be closed to make room.
  openPoll: {
    id: string;
    question: string;
    votes: number;
    repeatDaily: boolean;
    repeatOutcome: RepeatOutcome;
    ends: string; // "Voting ends Sunday 8:00 PM ET" / "no end"
  } | null;
  // Open polls already past their end that no cron has closed yet; they are
  // closed (and their results emailed) as part of opening.
  staleCount: number;
  // A different poll waiting in the queue.
  queued: { id: string; question: string } | null;
};

function describeEnd(p: OpenPollRow): string {
  if (p.open_ended) return "no end time";
  if (p.ends_at) return `voting ends ${formatEasternDay(new Date(p.ends_at), "long")} ET`;
  return `voting ends ${cutoffLabel()}`;
}

// The duration of the poll being opened: a queued poll's stored one, or the
// form's choice for a poll that doesn't exist yet.
async function targetDuration(
  supabase: Supabase,
  opts: { pollId?: string; duration?: DurationColumns | null },
): Promise<DurationColumns> {
  if (opts.pollId) return (await loadPollDuration(supabase, opts.pollId)).cols;
  return opts.duration ?? DAILY_COLUMNS;
}

// Everything the admin needs to see before confirming "Open now".
export async function getOpenNowInfo(
  supabase: Supabase,
  opts: { pollId?: string; duration?: DurationColumns | null; now?: Date } = {},
): Promise<OpenNowInfo> {
  const now = opts.now ?? new Date();
  const label = cutoffLabel();
  const cols = await targetDuration(supabase, opts);
  const long = !isDailyColumns(cols);
  const end = long ? endForColumns(cols, now) : null;

  const open = await listOpenPolls(supabase);
  const live = open.filter((p) => getPollState(p, now).votingOpen);

  const { data: scheduled } = await supabase
    .from("polls")
    .select("id, question")
    .eq("status", "scheduled")
    .order("created_at", { ascending: true });
  const queued = ((scheduled ?? []) as { id: string; question: string }[]).find((p) => p.id !== opts.pollId) ?? null;

  let openPoll: OpenNowInfo["openPoll"] = null;
  if (live.length > 0) {
    const current = live[0];
    const { count } = await supabase
      .from("votes")
      .select("id", { count: "exact", head: true })
      .eq("poll_id", current.id);
    openPoll = {
      id: current.id,
      question: current.question,
      votes: count ?? 0,
      repeatDaily: current.repeat_daily,
      repeatOutcome: !current.repeat_daily ? "none" : long ? "pause_for_long" : queued ? "pause" : "queue_copy",
      ends: describeEnd(current),
    };
  }
  const staleCount = open.length - live.length;

  if (!long) {
    const win = getOpenNowWindow(now);
    if (!win.allowed) {
      return {
        allowed: false, cutoff: label, durationText: null, long, emailNote: null,
        message: `It's past ${label}, so a poll opened now would close instantly.`,
        openPoll, staleCount, queued,
      };
    }
    const durationText = formatDuration(win.msLeft);
    return {
      allowed: true, cutoff: label, durationText, long, emailNote: null,
      message: `Voting will be open for ${durationText} today (until ${label}).`,
      openPoll, staleCount, queued,
    };
  }

  if (end && end.getTime() <= now.getTime()) {
    return {
      allowed: false, cutoff: label, durationText: null, long, emailNote: null,
      message: "That end time has already passed, so the poll would close instantly. Change its end time first.",
      openPoll, staleCount, queued,
    };
  }
  const durationText = end ? approxSpan(now, end) : null;
  return {
    allowed: true, cutoff: label, durationText, long, emailNote: emailNoteFor(end),
    message: end
      ? `Voting will be open until ${formatEasternDay(end, "long")} ET (${durationText}).`
      : "Voting will stay open until you close it.",
    openPoll, staleCount, queued,
  };
}

export type OpenNowResult =
  | {
      ok: true;
      pollId: string;
      opensAt: string;
      message: string;
      closed: { id: string; question: string; repeatMessage: string }[];
    }
  | { ok: false; status: number; code: string; error: string };

function fail(status: number, code: string, error: string): OpenNowResult {
  return { ok: false, status, code, error };
}

// ---------------------------------------------------------------------------
// The one place a queued poll becomes open (the noon job and Open now both use it)
// ---------------------------------------------------------------------------

export type OpenQueuedOutcome = { state: "opened" } | { state: "not_scheduled" } | { state: "error"; error: string };

// Flips a queued poll to open, stamping opens_at and (for an "N days" poll) its
// end time. The flip only succeeds while the poll is still queued, so whichever
// caller gets there first opens it and the other sees "not_scheduled".
export async function openQueuedPoll(
  supabase: Supabase,
  pollId: string,
  opts: { now: Date; endsAt?: string | null },
): Promise<OpenQueuedOutcome> {
  const { data, error } = await supabase
    .from("polls")
    .update({
      status: "open",
      opens_at: opts.now.toISOString(),
      ...(opts.endsAt ? { ends_at: opts.endsAt } : {}),
    })
    .eq("id", pollId)
    .eq("status", "scheduled")
    .select("id");
  if (error) return { state: "error", error: error.message };
  if (!data || data.length === 0) return { state: "not_scheduled" };
  return { state: "opened" };
}

// Puts a poll back in the queue (used when an Open now has to back out).
export function revertQueuedOpen(supabase: Supabase, pollId: string, clearEnd: boolean) {
  return supabase
    .from("polls")
    .update({ status: "scheduled", ...(clearEnd ? { ends_at: null } : {}) })
    .eq("id", pollId)
    .eq("status", "open");
}

// Makes a queued (scheduled) poll live immediately instead of at the next
// noon open. Voting still ends at the normal cutoff (getPollCutoff, from
// opens_at) unless the poll has a chosen duration, in which case it ends at
// its own end time (or never, if open-ended). An "N days" poll's end is fixed
// here, counted from today.
//
// Atomicity: the poll is claimed with a status flip that only succeeds while
// it is still 'scheduled', so two clicks on the same poll open it once. A
// second, different poll that opens at the same moment is detected after the
// claim and this call backs out, so the worst case is that neither opens and
// the admin retries -- never two open polls.
//
// Replacing: an already-open poll is only replaced with confirmReplace. It is
// closed through closePollAndFinish, the same path the crons use, so its votes
// stay and its results email goes out once (right now). A repeating poll is
// carried forward as usual -- unless the new poll is a long one, in which case
// the repeating poll is paused and resumes when the long poll closes.
export async function openPollNow(
  supabase: Supabase,
  input: { pollId: string; confirmReplace: boolean; now?: Date },
  deps: LifecycleDeps = {},
): Promise<OpenNowResult> {
  const now = input.now ?? new Date();
  const label = cutoffLabel();

  const { data: target } = await supabase
    .from("polls")
    .select("id, question, status")
    .eq("id", input.pollId)
    .maybeSingle();
  if (!target) return fail(404, "not_found", "Poll not found.");
  if (target.status !== "scheduled") {
    return fail(409, "not_scheduled", "That poll isn't waiting in the queue (it may already be open).");
  }

  const cols = await targetDuration(supabase, { pollId: target.id });
  const long = !isDailyColumns(cols);
  let endsAtOnOpen: string | null = null;

  if (!long) {
    const win = getOpenNowWindow(now);
    if (!win.allowed) {
      return fail(
        409,
        "past_cutoff",
        `It's past ${label}, so a poll opened now would close instantly. Leave it queued for tomorrow's noon instead.`,
      );
    }
  } else {
    const end = endForColumns(cols, now);
    if (end && end.getTime() <= now.getTime()) {
      return fail(409, "end_passed", "That end time has already passed, so the poll would close instantly. Change its end time first.");
    }
    if (cols.duration_days) endsAtOnOpen = getDaysPollEnd(now, cols.duration_days).toISOString();
  }

  const before = await listOpenPolls(supabase);
  const nowMs = now.getTime();
  const isRecent = (p: OpenPollRow) => Math.abs(nowMs - Date.parse(p.opens_at)) < SIMULTANEOUS_MS;
  if (before.some(isRecent)) {
    return fail(409, "just_opened", "A poll was opened a moment ago. Wait a few seconds and check the panel before trying again.");
  }

  const live = before.filter((p) => getPollState(p, now).votingOpen);
  if (live.length > 0 && !input.confirmReplace) {
    return fail(
      409,
      "confirm_replace",
      "A poll is already open. Confirm to close it and open this one instead.",
    );
  }

  const claim = await openQueuedPoll(supabase, target.id, { now, endsAt: endsAtOnOpen });
  if (claim.state === "error") {
    console.error("Failed to open poll now:", claim.error);
    return fail(500, "db_error", "Failed to open the poll.");
  }
  if (claim.state === "not_scheduled") {
    return fail(409, "not_scheduled", "That poll was just opened or removed by something else.");
  }

  const revert = () => revertQueuedOpen(supabase, target.id, endsAtOnOpen !== null);

  const knownIds = new Set(before.map((p) => p.id));
  const after = await listOpenPolls(supabase);
  const rivals = after.filter((p) => p.id !== target.id && !knownIds.has(p.id) && isRecent(p));
  if (rivals.length > 0) {
    await revert();
    return fail(
      409,
      "collision",
      "Another poll was opened at the same moment, so nothing was changed. Check the panel and try again.",
    );
  }

  const closed: { id: string; question: string; repeatMessage: string }[] = [];
  for (const old of before) {
    const outcome = await closePollAndFinish(supabase, old, deps, { repeatMode: long ? "pause" : "normal" });
    if (outcome.state === "error") {
      await revert();
      return fail(500, "db_error", "Couldn't close the poll that was open, so nothing was changed.");
    }
    if (outcome.state === "closed") {
      closed.push({ id: old.id, question: old.question, repeatMessage: outcome.repeatMessage });
    }
  }

  const end = long ? (endsAtOnOpen ? new Date(endsAtOnOpen) : endForColumns(cols, now)) : null;
  console.log(`Poll ${target.id} opened early by the admin at ${now.toISOString()}`);
  return {
    ok: true,
    pollId: target.id,
    opensAt: now.toISOString(),
    message: !long
      ? `Poll opened. Voting runs until ${label}.`
      : end
        ? `Poll opened. Voting runs until ${formatEasternDay(end, "long")} ET.`
        : "Poll opened. It stays open until you close it.",
    closed,
  };
}

// Used by the open-poll cron: the end instant to store when a queued "N days"
// poll opens.
export function endsAtForOpening(durationDays: number | null | undefined, opensAt: Date): string | null {
  return durationDays ? getDaysPollEnd(opensAt, durationDays).toISOString() : null;
}
