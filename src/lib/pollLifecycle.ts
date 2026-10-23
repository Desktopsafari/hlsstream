import type { createServiceRoleClient } from "@/lib/supabase/server";
import { POLL_CLOSE_HOUR } from "@/config/constants";
import { sendPollResultsEmail } from "@/lib/email";
import {
  approxSpan,
  DAILY_COLUMNS,
  emailNoteFor,
  endForColumns,
  isDailyColumns,
  type DurationColumns,
} from "@/lib/pollDuration";
import {
  formatDuration,
  formatEasternDay,
  getDaysPollEnd,
  getOpenNowWindow,
  getPollState,
  isLongPoll,
} from "@/lib/pollSchedule";
import { durationColumnsExist } from "@/lib/pollTiming";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// Injectable so tests can count emails instead of sending them.
export type LifecycleDeps = {
  sendResultsEmail?: (question: string, options: { label: string; vote_count: number }[]) => Promise<void>;
};

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

// A paused daily poll closed within this long after a long poll opened (or any
// time before it) is the one that was waiting on it.
const RESUME_WINDOW_MS = 60_000;

export function cutoffLabel(): string {
  const hour12 = POLL_CLOSE_HOUR % 12 === 0 ? 12 : POLL_CLOSE_HOUR % 12;
  return `${hour12}:00 ${POLL_CLOSE_HOUR >= 12 ? "PM" : "AM"} ET`;
}

// The duration columns of a poll (daily when they don't exist yet).
async function readDuration(
  supabase: Supabase,
  pollId: string,
): Promise<{ cols: DurationColumns; opens_at: string | null }> {
  if (!(await durationColumnsExist(supabase))) return { cols: DAILY_COLUMNS, opens_at: null };
  const { data } = await supabase
    .from("polls")
    .select("opens_at, ends_at, open_ended, duration_days")
    .eq("id", pollId)
    .maybeSingle();
  const row = data as { opens_at: string; ends_at: string | null; open_ended: boolean | null; duration_days: number | null } | null;
  if (!row) return { cols: DAILY_COLUMNS, opens_at: null };
  return {
    cols: { ends_at: row.ends_at, open_ended: !!row.open_ended, duration_days: row.duration_days },
    opens_at: row.opens_at,
  };
}

// ---------------------------------------------------------------------------
// Closing a poll (the 8pm / noon crons, Close now, and Open now replacing one)
// ---------------------------------------------------------------------------

export type CloseOutcome =
  | { state: "closed"; repeatMessage: string }
  | { state: "already_closed" }
  | { state: "error"; error: string };

// Flips an open poll to closed, emails its results, and carries a repeating
// poll forward. The status flip is conditional on the poll still being open,
// so whichever caller flips it (a cron, Close now, an admin replacing it) is
// the only one that sends the results email or queues the next copy -- the
// other gets "already_closed" and does nothing. Results can't be sent twice.
//
// repeatMode "pause" is used when a long poll takes over: a repeating poll
// that is replaced is marked paused instead of queueing its next copy, and it
// resumes when the long poll closes. Closing a long poll resumes a daily poll
// that was waiting on it (resumePausedRepeatingPoll).
export async function closePollAndFinish(
  supabase: Supabase,
  poll: { id: string; question: string; repeat_daily: boolean },
  deps: LifecycleDeps = {},
  opts: { repeatMode?: "normal" | "pause" } = {},
): Promise<CloseOutcome> {
  const { data: flipped, error } = await supabase
    .from("polls")
    .update({ status: "closed", closes_at: new Date().toISOString() })
    .eq("id", poll.id)
    .eq("status", "open")
    .select("id");

  if (error) {
    console.error("Failed to close poll:", error.message);
    return { state: "error", error: error.message };
  }
  if (!flipped || flipped.length === 0) return { state: "already_closed" };

  const { data: results } = await supabase
    .from("poll_results")
    .select("label, vote_count")
    .eq("poll_id", poll.id);

  await (deps.sendResultsEmail ?? sendPollResultsEmail)(poll.question, results ?? []);

  let repeatMessage = "";
  if (poll.repeat_daily) {
    if (opts.repeatMode === "pause") {
      await supabase.from("polls").update({ repeat_paused: true }).eq("id", poll.id);
      repeatMessage = " Its daily repeat is paused and resumes when the long poll closes.";
    } else {
      repeatMessage = await continueRepeatingPoll(supabase, poll.id, poll.question);
    }
  }

  const { cols, opens_at } = await readDuration(supabase, poll.id);
  if (!isDailyColumns(cols) && opens_at) {
    repeatMessage += await resumePausedRepeatingPoll(supabase, poll.id, opens_at);
  }
  return { state: "closed", repeatMessage };
}

// The closed poll's picture path, or null if it has none or the image_path
// column on polls doesn't exist yet.
async function pollPictureForCopy(supabase: Supabase, pollId: string): Promise<string | null> {
  const { data, error } = await supabase.from("polls").select("image_path").eq("id", pollId).maybeSingle();
  if (error) return null;
  return (data as { image_path: string | null } | null)?.image_path ?? null;
}

// Runs after a repeat_daily poll closes. Mirrors the same "only one poll
// scheduled at a time" rule the admin create endpoint enforces: if the
// admin already manually queued a different poll for the next cycle (which
// can only have happened while this poll was still open, since a poll
// can't be queued once one is already scheduled), that manual choice wins.
// The repeating poll is marked repeat_paused instead of silently losing its
// flag, so the admin panel can explain what happened.
//
// The copy points at the same question picture file as the original. That's
// safe because a file is only deleted when no poll references it any more
// (see removeFileIfUnreferenced in pollImages.ts).
export async function continueRepeatingPoll(
  supabase: Supabase,
  closedPollId: string,
  question: string,
): Promise<string> {
  const { data: existingScheduled } = await supabase
    .from("polls")
    .select("id")
    .eq("status", "scheduled")
    .limit(1)
    .maybeSingle();

  if (existingScheduled) {
    await supabase.from("polls").update({ repeat_paused: true }).eq("id", closedPollId);
    return " A different poll was already queued for the next cycle, so the repeat was paused.";
  }

  const { data: options } = await supabase
    .from("poll_options")
    .select("label, display_order")
    .eq("poll_id", closedPollId)
    .order("display_order", { ascending: true });

  const imagePath = await pollPictureForCopy(supabase, closedPollId);

  const { data: nextPoll, error: insertError } = await supabase
    .from("polls")
    .insert({
      question,
      status: "scheduled",
      repeat_daily: true,
      // Only sent when there is one, so a poll without a picture inserts the
      // same columns it always did.
      ...(imagePath ? { image_path: imagePath } : {}),
      // Placeholder timestamps -- the open/close crons overwrite these
      // with the real timestamps when they actually flip the status.
      opens_at: new Date().toISOString(),
      closes_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !nextPoll) {
    console.error("Failed to create repeating poll continuation:", insertError?.message);
    return " Failed to queue tomorrow's repeat -- check the logs.";
  }

  const { error: optionsError } = await supabase.from("poll_options").insert(
    (options ?? []).map((o) => ({
      poll_id: nextPoll.id,
      label: o.label,
      display_order: o.display_order,
    })),
  );

  if (optionsError) {
    console.error("Failed to copy options for repeating poll:", optionsError.message);
    return " Failed to copy options for tomorrow's repeat -- check the logs.";
  }

  return " Queued as tomorrow's repeat.";
}

// When a long (multi-day or open-ended) poll closes, a daily poll that was
// paused to make way for it goes back in the queue. The poll that was waiting
// is the one that closed just before the long poll opened. If something else
// is already queued (the admin queued a poll by hand while the long poll ran)
// that poll keeps the slot and the daily poll stays paused -- the same "manual
// queue wins" rule as at any other time.
export async function resumePausedRepeatingPoll(
  supabase: Supabase,
  longPollId: string,
  longPollOpenedAt: string,
): Promise<string> {
  const before = new Date(Date.parse(longPollOpenedAt) + RESUME_WINDOW_MS).toISOString();
  const { data: prev } = await supabase
    .from("polls")
    .select("id, question, repeat_daily, repeat_paused")
    .eq("status", "closed")
    .neq("id", longPollId)
    .lte("closes_at", before)
    .order("closes_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const paused = prev as { id: string; question: string; repeat_daily: boolean; repeat_paused: boolean } | null;
  if (!paused || !paused.repeat_daily || !paused.repeat_paused) return "";

  const { data: queued } = await supabase.from("polls").select("id").eq("status", "scheduled").limit(1).maybeSingle();
  if (queued) return " A different poll is queued, so the paused daily poll stays paused.";

  const message = await continueRepeatingPoll(supabase, paused.id, paused.question);
  if (!/Queued/.test(message)) return message;
  await supabase.from("polls").update({ repeat_paused: false }).eq("id", paused.id);
  return " The paused daily poll was queued to resume.";
}

// ---------------------------------------------------------------------------
// Open now
// ---------------------------------------------------------------------------

async function listOpenPolls(supabase: Supabase): Promise<OpenPollRow[]> {
  const timing = (await durationColumnsExist(supabase)) ? ", ends_at, open_ended" : "";
  const { data } = await supabase
    .from("polls")
    .select(`id, question, status, repeat_daily, opens_at${timing}`)
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
  if (opts.pollId) return (await readDuration(supabase, opts.pollId)).cols;
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

  const { data: claimed, error: claimError } = await supabase
    .from("polls")
    .update({
      status: "open",
      opens_at: now.toISOString(),
      ...(endsAtOnOpen ? { ends_at: endsAtOnOpen } : {}),
    })
    .eq("id", target.id)
    .eq("status", "scheduled")
    .select("id");
  if (claimError) {
    console.error("Failed to open poll now:", claimError.message);
    return fail(500, "db_error", "Failed to open the poll.");
  }
  if (!claimed || claimed.length === 0) {
    return fail(409, "not_scheduled", "That poll was just opened or removed by something else.");
  }

  const revert = () =>
    supabase
      .from("polls")
      .update({ status: "scheduled", ...(endsAtOnOpen ? { ends_at: null } : {}) })
      .eq("id", target.id)
      .eq("status", "open");

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

export { isLongPoll };
