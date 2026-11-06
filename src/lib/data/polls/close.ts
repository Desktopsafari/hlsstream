import type { createServiceRoleClient } from "@/lib/supabase/server";
import { sendPollResultsEmail } from "@/lib/email";
import { isDailyColumns } from "@/lib/pollDuration";
import { continueRepeatingPoll, resumePausedRepeatingPoll } from "@/lib/data/polls/repeat";
import { getPollState, isLongPoll, type PollTiming } from "@/lib/pollSchedule";
import { loadPollDuration } from "@/lib/data/polls/timing";
import type { StreamId } from "@/lib/data/streams";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// Injectable so tests can count emails instead of sending them.
export type LifecycleDeps = {
  sendResultsEmail?: (question: string, options: { label: string; vote_count: number }[]) => Promise<void>;
};
// ---------------------------------------------------------------------------
// Closing a poll (the 8pm / noon crons, Close now, and Open now replacing one)
// ---------------------------------------------------------------------------

export type RepeatMode = "normal" | "pause" | "skip";

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
//
// Only acts on a poll of the given stream (the flip is filtered by stream_id),
// and the repeat copy is queued on that same stream.
//
// repeatMode "skip" is used on a stream with polls turned off: the poll still
// closes and its results are still emailed, but no repeat copy is queued (and
// no paused daily poll is resumed), since nothing may be queued there.
export async function closePollAndFinish(
  supabase: Supabase,
  streamId: StreamId,
  poll: { id: string; question: string; repeat_daily: boolean },
  deps: LifecycleDeps = {},
  opts: { repeatMode?: RepeatMode } = {},
): Promise<CloseOutcome> {
  const { data: flipped, error } = await supabase
    .from("polls")
    .update({ status: "closed", closes_at: new Date().toISOString() })
    .eq("id", poll.id)
    .eq("stream_id", streamId)
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
  if (opts.repeatMode === "skip") {
    if (poll.repeat_daily) repeatMessage = " Polls are off for this stream, so no repeat was queued.";
    return { state: "closed", repeatMessage };
  }
  if (poll.repeat_daily) {
    if (opts.repeatMode === "pause") {
      await supabase.from("polls").update({ repeat_paused: true }).eq("id", poll.id).eq("stream_id", streamId);
      repeatMessage = " Its daily repeat is paused and resumes when the long poll closes.";
    } else {
      repeatMessage = await continueRepeatingPoll(supabase, streamId, poll.id, poll.question);
    }
  }

  const { cols, opens_at } = await loadPollDuration(supabase, poll.id);
  if (!isDailyColumns(cols) && opens_at) {
    repeatMessage += await resumePausedRepeatingPoll(supabase, streamId, poll.id, opens_at);
  }
  return { state: "closed", repeatMessage };
}

// Which open polls each daily job may close. The 8 PM job closes a normal poll
// whenever it runs (as it always has) and a long poll only once its end time has
// passed; the noon job only ever closes long polls that have ended -- a normal
// poll is left to the 8 PM job.
export type CronJob = "evening" | "noon";

export function isDueForJob(
  poll: { status: string } & PollTiming,
  job: CronJob,
  now: Date = new Date(),
): boolean {
  const long = isLongPoll(poll);
  const ended = getPollState(poll, now).phase === "ended";
  return job === "evening" ? !long || ended : long && ended;
}

// Closes (and emails, once each) every open poll the job is due to close, and
// returns the text the job adds to its response.
export async function closeDuePolls(
  supabase: Supabase,
  streamId: StreamId,
  polls: ({ id: string; question: string; repeat_daily: boolean; status: string } & PollTiming)[],
  job: CronJob,
  deps: LifecycleDeps = {},
  opts: { repeatMode?: RepeatMode } = {},
): Promise<string> {
  let message = "";
  for (const p of polls) {
    if (!isDueForJob(p, job)) continue;
    const outcome = await closePollAndFinish(supabase, streamId, p, deps, opts);
    if (outcome.state === "closed") {
      message += ` Closed the ended poll "${p.question}" and emailed its results.${outcome.repeatMessage}`;
    }
  }
  return message;
}
