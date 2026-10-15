import type { createServiceRoleClient } from "@/lib/supabase/server";
import { POLL_CLOSE_HOUR } from "@/config/constants";
import { sendPollResultsEmail } from "@/lib/email";
import { formatDuration, getOpenNowWindow, isPollPastCutoff } from "@/lib/pollSchedule";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// Injectable so tests can count emails instead of sending them.
export type LifecycleDeps = {
  sendResultsEmail?: (question: string, options: { label: string; vote_count: number }[]) => Promise<void>;
};

type OpenPollRow = { id: string; question: string; repeat_daily: boolean; opens_at: string };

// Another poll that became open within this long of "now" counts as a
// simultaneous Open now (a double-click, or two admin tabs) rather than the
// poll being replaced.
const SIMULTANEOUS_MS = 10_000;

export function cutoffLabel(): string {
  const hour12 = POLL_CLOSE_HOUR % 12 === 0 ? 12 : POLL_CLOSE_HOUR % 12;
  return `${hour12}:00 ${POLL_CLOSE_HOUR >= 12 ? "PM" : "AM"} ET`;
}

// ---------------------------------------------------------------------------
// Closing a poll (shared by the 8pm cron and by "Open now" replacing a poll)
// ---------------------------------------------------------------------------

export type CloseOutcome =
  | { state: "closed"; repeatMessage: string }
  | { state: "already_closed" }
  | { state: "error"; error: string };

// Flips an open poll to closed, emails its results, and carries a repeating
// poll forward. The status flip is conditional on the poll still being open,
// so whichever caller flips it (the cron, or an admin replacing it) is the
// only one that sends the results email or queues tomorrow's copy -- the
// other gets "already_closed" and does nothing. Results can't be sent twice.
export async function closePollAndFinish(
  supabase: Supabase,
  poll: { id: string; question: string; repeat_daily: boolean },
  deps: LifecycleDeps = {},
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

  const repeatMessage = poll.repeat_daily
    ? await continueRepeatingPoll(supabase, poll.id, poll.question)
    : "";
  return { state: "closed", repeatMessage };
}

// Options for a repeating poll's next copy, with their pictures when the
// image_path column exists (and without it when it doesn't).
async function optionsForCopy(supabase: Supabase, pollId: string) {
  const withImages = await supabase
    .from("poll_options")
    .select("label, display_order, image_path")
    .eq("poll_id", pollId)
    .order("display_order", { ascending: true });
  if (!withImages.error) {
    return (withImages.data ?? []) as { label: string; display_order: number; image_path: string | null }[];
  }
  const plain = await supabase
    .from("poll_options")
    .select("label, display_order")
    .eq("poll_id", pollId)
    .order("display_order", { ascending: true });
  return ((plain.data ?? []) as { label: string; display_order: number }[]).map((o) => ({
    ...o,
    image_path: null as string | null,
  }));
}

// Runs after a repeat_daily poll closes. Mirrors the same "only one poll
// scheduled at a time" rule the admin create endpoint enforces: if the
// admin already manually queued a different poll for the next cycle (which
// can only have happened while this poll was still open, since a poll
// can't be queued once one is already scheduled), that manual choice wins.
// The repeating poll is marked repeat_paused instead of silently losing its
// flag, so the admin panel can explain what happened.
//
// The copy's options point at the same picture files as the original. That's
// safe because a file is only deleted when no option references it any more
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

  const options = await optionsForCopy(supabase, closedPollId);

  const { data: nextPoll, error: insertError } = await supabase
    .from("polls")
    .insert({
      question,
      status: "scheduled",
      repeat_daily: true,
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

  const hasPictures = options.some((o) => o.image_path);
  const { error: optionsError } = await supabase.from("poll_options").insert(
    options.map((o) => ({
      poll_id: nextPoll.id,
      label: o.label,
      display_order: o.display_order,
      // Only sent when there is one, so a poll without pictures inserts the
      // same columns it always did.
      ...(hasPictures ? { image_path: o.image_path } : {}),
    })),
  );

  if (optionsError) {
    console.error("Failed to copy options for repeating poll:", optionsError.message);
    return " Failed to copy options for tomorrow's repeat -- check the logs.";
  }

  return " Queued as tomorrow's repeat.";
}

// ---------------------------------------------------------------------------
// Open now
// ---------------------------------------------------------------------------

async function listOpenPolls(supabase: Supabase): Promise<OpenPollRow[]> {
  const { data } = await supabase
    .from("polls")
    .select("id, question, repeat_daily, opens_at")
    .eq("status", "open")
    .order("opens_at", { ascending: false });
  return (data ?? []) as OpenPollRow[];
}

export type RepeatOutcome = "none" | "queue_copy" | "pause";

export type OpenNowInfo = {
  allowed: boolean;
  cutoff: string;
  durationText: string | null;
  message: string;
  // The poll that is open right now and would be closed to make room.
  openPoll: {
    id: string;
    question: string;
    votes: number;
    repeatDaily: boolean;
    repeatOutcome: RepeatOutcome;
  } | null;
  // Open polls already past 8pm that the cron hasn't closed yet; they are
  // closed (and their results emailed) as part of opening.
  staleCount: number;
  // A different poll waiting in the queue.
  queued: { id: string; question: string } | null;
};

// Everything the admin needs to see before confirming "Open now".
export async function getOpenNowInfo(
  supabase: Supabase,
  opts: { pollId?: string; now?: Date } = {},
): Promise<OpenNowInfo> {
  const now = opts.now ?? new Date();
  const win = getOpenNowWindow(now);
  const label = cutoffLabel();

  const open = await listOpenPolls(supabase);
  const live = open.filter((p) => !isPollPastCutoff(p.opens_at, now));

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
      repeatOutcome: !current.repeat_daily ? "none" : queued ? "pause" : "queue_copy",
    };
  }

  if (!win.allowed) {
    return {
      allowed: false,
      cutoff: label,
      durationText: null,
      message: `It's past ${label}, so a poll opened now would close instantly.`,
      openPoll,
      staleCount: open.length - live.length,
      queued,
    };
  }

  const durationText = formatDuration(win.msLeft);
  return {
    allowed: true,
    cutoff: label,
    durationText,
    message: `Voting will be open for ${durationText} today (until ${label}).`,
    openPoll,
    staleCount: open.length - live.length,
    queued,
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
// noon open. Voting still ends at the normal cutoff, which getPollCutoff
// derives from opens_at.
//
// Atomicity: the poll is claimed with a status flip that only succeeds while
// it is still 'scheduled', so two clicks on the same poll open it once. A
// second, different poll that opens at the same moment is detected after the
// claim and this call backs out, so the worst case is that neither opens and
// the admin retries -- never two open polls.
//
// Replacing: an already-open poll is only replaced with confirmReplace. It is
// closed through closePollAndFinish, the same path the 8pm cron uses, so its
// votes stay, its results email goes out once (right now rather than at 8pm),
// and a repeating poll is carried forward (or paused behind a manually queued
// one) exactly as it would be at 8pm.
export async function openPollNow(
  supabase: Supabase,
  input: { pollId: string; confirmReplace: boolean; now?: Date },
  deps: LifecycleDeps = {},
): Promise<OpenNowResult> {
  const now = input.now ?? new Date();
  const label = cutoffLabel();

  const win = getOpenNowWindow(now);
  if (!win.allowed) {
    return fail(
      409,
      "past_cutoff",
      `It's past ${label}, so a poll opened now would close instantly. Leave it queued for tomorrow's noon instead.`,
    );
  }

  const { data: target } = await supabase
    .from("polls")
    .select("id, question, status")
    .eq("id", input.pollId)
    .maybeSingle();
  if (!target) return fail(404, "not_found", "Poll not found.");
  if (target.status !== "scheduled") {
    return fail(409, "not_scheduled", "That poll isn't waiting in the queue (it may already be open).");
  }

  const before = await listOpenPolls(supabase);
  const nowMs = now.getTime();
  const isRecent = (p: OpenPollRow) => Math.abs(nowMs - Date.parse(p.opens_at)) < SIMULTANEOUS_MS;
  if (before.some(isRecent)) {
    return fail(409, "just_opened", "A poll was opened a moment ago. Wait a few seconds and check the panel before trying again.");
  }

  const live = before.filter((p) => !isPollPastCutoff(p.opens_at, now));
  if (live.length > 0 && !input.confirmReplace) {
    return fail(
      409,
      "confirm_replace",
      "A poll is already open. Confirm to close it and open this one instead.",
    );
  }

  const { data: claimed, error: claimError } = await supabase
    .from("polls")
    .update({ status: "open", opens_at: now.toISOString() })
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
    supabase.from("polls").update({ status: "scheduled" }).eq("id", target.id).eq("status", "open");

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
    const outcome = await closePollAndFinish(supabase, old, deps);
    if (outcome.state === "error") {
      await revert();
      return fail(500, "db_error", "Couldn't close the poll that was open, so nothing was changed.");
    }
    if (outcome.state === "closed") {
      closed.push({ id: old.id, question: old.question, repeatMessage: outcome.repeatMessage });
    }
  }

  console.log(`Poll ${target.id} opened early by the admin at ${now.toISOString()}`);
  return {
    ok: true,
    pollId: target.id,
    opensAt: now.toISOString(),
    message: `Poll opened. Voting runs until ${label}.`,
    closed,
  };
}
