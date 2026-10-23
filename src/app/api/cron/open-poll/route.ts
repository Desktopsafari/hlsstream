import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { closeDuePolls, endsAtForOpening, openQueuedPoll } from "@/lib/pollLifecycle";
import { getPollState, type PollTiming } from "@/lib/pollSchedule";
import { durationSelect, timingSelect } from "@/lib/pollTiming";

// Triggered daily by Vercel Cron at a fixed UTC time approximating noon
// Eastern -- see vercel.json for the schedule and README-style comments
// there about the twice-yearly DST adjustment this needs.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // A poll that is still taking votes (opened by hand with "Open now", or a
  // multi-day / open-ended poll still running) means the queued poll waits
  // instead of opening on top of it. A poll past its end doesn't count; it just
  // hasn't been flipped to closed yet.
  const { data: openRows } = await supabase
    .from("polls")
    .select(`id, question, status, repeat_daily, opens_at${await timingSelect(supabase)}`)
    .eq("status", "open");
  const openPolls = (openRows ?? []) as unknown as ({ id: string; question: string; status: string; repeat_daily: boolean } & PollTiming)[];
  if (openPolls.some((p) => getPollState(p).votingOpen)) {
    return NextResponse.json({ message: "A poll is already open, so the queued poll was left for later." });
  }

  // A multi-day poll whose end time has passed is closed here (results emailed
  // once) before the queue moves on, so its email never waits for the 8pm job.
  // Normal daily polls are left to the close job, exactly as before.
  const closedMessage = await closeDuePolls(supabase, openPolls, "noon");

  const { data: nextPoll } = await supabase
    .from("polls")
    .select(`id${await durationSelect(supabase)}`)
    .eq("status", "scheduled")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const next = nextPoll as unknown as { id: string; duration_days?: number | null } | null;

  if (!next) {
    return NextResponse.json({ message: `No scheduled poll to open.${closedMessage}` });
  }

  const now = new Date();
  // Conditional on still being queued, so it can't clash with an "Open now"
  // that grabbed the same poll a moment earlier. An "N days" poll gets its end
  // time fixed now: 8 PM ET on the last day, counting today as day 1.
  const endsAt = endsAtForOpening(next.duration_days, now);
  const opened = await openQueuedPoll(supabase, next.id, { now, endsAt });

  if (opened.state === "error") {
    console.error("Failed to open poll:", opened.error);
    return NextResponse.json({ error: "Failed to open poll" }, { status: 500 });
  }
  if (opened.state === "not_scheduled") {
    return NextResponse.json({ message: `The queued poll was already opened.${closedMessage}` });
  }

  return NextResponse.json({ message: `Poll opened.${closedMessage}`, pollId: next.id });
}
