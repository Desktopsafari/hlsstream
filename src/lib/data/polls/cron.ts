import type { createServiceRoleClient } from "@/lib/supabase/server";
import { closeDuePolls, closePollAndFinish, isDueForJob } from "@/lib/data/polls/close";
import { endsAtForOpening, openQueuedPoll } from "@/lib/data/polls/open";
import { getPollState, type PollTiming } from "@/lib/pollSchedule";
import { durationSelect, timingSelect } from "@/lib/data/polls/timing";
import { listStreams, type PollStream } from "@/lib/data/streams";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// What a cron route sends back: an HTTP status and a JSON body.
export type JobResponse = { status: number; body: Record<string, unknown> };

type OpenRow = { id: string; question: string; status: string; repeat_daily: boolean } & PollTiming;

const ok = (body: Record<string, unknown>): JobResponse => ({ status: 200, body });

// Runs a daily job once for every stream (one global schedule, decision 5).
// Streams with polls turned off are included so their ended polls still close
// and their results are still emailed; the job itself makes sure nothing is
// opened or queued on them. Each stream is handled on its own: one stream's poll
// never decides what happens on another, and one stream failing doesn't stop
// the rest. With a single stream the response is exactly that stream's
// response, as it was before there were streams.
async function forEachPollStream(
  supabase: Supabase,
  job: (stream: PollStream) => Promise<JobResponse>,
): Promise<JobResponse> {
  const streams = await listStreams(supabase);
  if (!streams) return { status: 500, body: { error: "Couldn't load the streams." } };
  if (streams.length === 0) return ok({ message: "No streams." });

  const results: { stream: PollStream; res: JobResponse }[] = [];
  for (const stream of streams) {
    let res: JobResponse;
    try {
      res = await job(stream);
    } catch (err) {
      console.error(`Poll job failed for stream ${stream.id}:`, err);
      res = { status: 500, body: { error: "The job failed for this stream." } };
    }
    results.push({ stream, res });
  }
  if (results.length === 1) return results[0].res;

  return {
    status: results.some((r) => r.res.status !== 200) ? 500 : 200,
    body: {
      message: results.map((r) => `[${r.stream.slug}] ${String(r.res.body.message ?? r.res.body.error)}`).join(" "),
      streams: results.map((r) => ({ stream: r.stream.id, status: r.res.status, ...r.res.body })),
    },
  };
}

// The noon job, for one stream: closes the stream's ended long polls (on every
// stream), then -- only if the stream has polls on -- opens its oldest queued
// poll, unless
// one of its polls is still taking votes (opened by hand with "Open now", or a
// multi-day / open-ended poll still running) -- then the queued poll waits. A
// poll past its end doesn't count; it just hasn't been flipped to closed yet.
async function openPollForStream(supabase: Supabase, stream: PollStream): Promise<JobResponse> {
  const streamId = stream.id;
  // No repeat copies on a stream with polls off (see closePollAndFinish).
  const repeatMode = stream.polls_enabled ? "normal" : "skip";
  const { data: openRows } = await supabase
    .from("polls")
    .select(`id, question, status, repeat_daily, opens_at${await timingSelect(supabase)}`)
    .eq("stream_id", streamId)
    .eq("status", "open");
  const openPolls = (openRows ?? []) as unknown as OpenRow[];
  if (openPolls.some((p) => getPollState(p).votingOpen)) {
    return ok({ message: "A poll is already open, so the queued poll was left for later." });
  }

  // A multi-day poll whose end time has passed is closed here (results emailed
  // once) before the queue moves on, so its email never waits for the 8pm job.
  // Normal daily polls are left to the close job, exactly as before.
  const closedMessage = await closeDuePolls(supabase, streamId, openPolls, "noon", {}, { repeatMode });
  if (!stream.polls_enabled) return ok({ message: `Polls are off for this stream, so nothing was opened.${closedMessage}` });

  const { data: nextPoll } = await supabase
    .from("polls")
    .select(`id${await durationSelect(supabase)}`)
    .eq("stream_id", streamId)
    .eq("status", "scheduled")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const next = nextPoll as unknown as { id: string; duration_days?: number | null } | null;

  if (!next) return ok({ message: `No scheduled poll to open.${closedMessage}` });

  const now = new Date();
  // Conditional on still being queued, so it can't clash with an "Open now"
  // that grabbed the same poll a moment earlier. An "N days" poll gets its end
  // time fixed now: 8 PM ET on the last day, counting today as day 1.
  const endsAt = endsAtForOpening(next.duration_days, now);
  const opened = await openQueuedPoll(supabase, streamId, next.id, { now, endsAt });

  if (opened.state === "error") {
    console.error("Failed to open poll:", opened.error);
    return { status: 500, body: { error: "Failed to open poll" } };
  }
  if (opened.state === "not_scheduled") {
    return ok({ message: `The queued poll was already opened.${closedMessage}` });
  }
  return ok({ message: `Poll opened.${closedMessage}`, pollId: next.id });
}

// The 8 PM job, for one stream (every stream, polls on or off: an ended poll
// is always closed and its results emailed; repeat copies only where polls are
// on). Closing, the results email, and carrying a
// repeating poll forward all live in closePollAndFinish, which Close now and
// "Open now" also use -- so a poll closed there is already closed here and its
// results aren't emailed twice.
//
// A normal daily poll is closed here exactly as before. A poll with a chosen
// duration (multi-day, specific end time, open-ended) is left alone until its
// end time has passed, and an open-ended one is never closed by this job.
async function closePollForStream(supabase: Supabase, stream: PollStream): Promise<JobResponse> {
  const streamId = stream.id;
  const { data: row } = await supabase
    .from("polls")
    .select(`id, question, status, repeat_daily, opens_at${await timingSelect(supabase)}`)
    .eq("stream_id", streamId)
    .eq("status", "open")
    .order("opens_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const openPoll = row as unknown as OpenRow | null;

  if (!openPoll) return ok({ message: "No open poll to close." });

  if (!isDueForJob(openPoll, "evening")) {
    return ok({
      message: "A multi-day or open-ended poll is still running, so it was left open.",
      pollId: openPoll.id,
    });
  }

  const outcome = await closePollAndFinish(supabase, streamId, openPoll, {}, {
    repeatMode: stream.polls_enabled ? "normal" : "skip",
  });
  if (outcome.state === "error") return { status: 500, body: { error: "Failed to close poll" } };
  if (outcome.state === "already_closed") return ok({ message: "Poll was already closed.", pollId: openPoll.id });
  return ok({ message: `Poll closed and results emailed.${outcome.repeatMessage}`, pollId: openPoll.id });
}

export function runOpenPollJob(supabase: Supabase): Promise<JobResponse> {
  return forEachPollStream(supabase, (stream) => openPollForStream(supabase, stream));
}

export function runClosePollJob(supabase: Supabase): Promise<JobResponse> {
  return forEachPollStream(supabase, (stream) => closePollForStream(supabase, stream));
}
