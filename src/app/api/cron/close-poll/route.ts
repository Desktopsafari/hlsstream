import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { closePollAndFinish, isDueForJob } from "@/lib/pollLifecycle";
import type { PollTiming } from "@/lib/pollSchedule";
import { timingSelect } from "@/lib/pollTiming";

// Triggered daily by Vercel Cron at a fixed UTC time approximating 8pm
// Eastern -- see vercel.json for the schedule and the DST note there.
// Closing, the results email, and carrying a repeating poll forward all live
// in closePollAndFinish (src/lib/pollLifecycle.ts), which Close now and
// "Open now" also use -- so a poll closed there is already closed here and its
// results aren't emailed twice.
//
// A normal daily poll is closed here exactly as before. A poll with a chosen
// duration (multi-day, specific end time, open-ended) is left alone until its
// end time has passed, and an open-ended one is never closed by this job.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: row } = await supabase
    .from("polls")
    .select(`id, question, status, repeat_daily, opens_at${await timingSelect(supabase)}`)
    .eq("status", "open")
    .order("opens_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const openPoll = row as unknown as ({ id: string; question: string; status: string; repeat_daily: boolean } & PollTiming) | null;

  if (!openPoll) {
    return NextResponse.json({ message: "No open poll to close." });
  }

  if (!isDueForJob(openPoll, "evening")) {
    return NextResponse.json({
      message: "A multi-day or open-ended poll is still running, so it was left open.",
      pollId: openPoll.id,
    });
  }

  const outcome = await closePollAndFinish(supabase, openPoll);

  if (outcome.state === "error") {
    return NextResponse.json({ error: "Failed to close poll" }, { status: 500 });
  }
  if (outcome.state === "already_closed") {
    return NextResponse.json({ message: "Poll was already closed.", pollId: openPoll.id });
  }

  return NextResponse.json({
    message: `Poll closed and results emailed.${outcome.repeatMessage}`,
    pollId: openPoll.id,
  });
}
