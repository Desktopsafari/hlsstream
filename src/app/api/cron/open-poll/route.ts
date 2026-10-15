import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { closePollAndFinish, endsAtForOpening } from "@/lib/pollLifecycle";
import { isLongPoll, isPollPastEnd, type PollTiming } from "@/lib/pollSchedule";
import { durationColumnsExist } from "@/lib/pollTiming";

// Triggered daily by Vercel Cron at a fixed UTC time approximating noon
// Eastern -- see vercel.json for the schedule and README-style comments
// there about the twice-yearly DST adjustment this needs.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const hasDurations = await durationColumnsExist(supabase);

  // A poll that is still taking votes (opened by hand with "Open now", or a
  // multi-day / open-ended poll still running) means the queued poll waits
  // instead of opening on top of it. A poll past its end doesn't count; it just
  // hasn't been flipped to closed yet.
  const { data: openRows } = await supabase
    .from("polls")
    .select(`id, question, repeat_daily, opens_at${hasDurations ? ", ends_at, open_ended" : ""}`)
    .eq("status", "open");
  const openPolls = (openRows ?? []) as unknown as ({ id: string; question: string; repeat_daily: boolean } & PollTiming)[];
  if (openPolls.some((p) => !isPollPastEnd(p))) {
    return NextResponse.json({ message: "A poll is already open, so the queued poll was left for later." });
  }

  // A multi-day poll whose end time has passed is closed here (results emailed
  // once) before the queue moves on, so its email never waits for the 8pm job.
  // Normal daily polls are left to the close job, exactly as before.
  let closedMessage = "";
  for (const p of openPolls) {
    if (!isLongPoll(p)) continue;
    const outcome = await closePollAndFinish(supabase, p);
    if (outcome.state === "closed") {
      closedMessage += ` Closed the ended poll "${p.question}" and emailed its results.${outcome.repeatMessage}`;
    }
  }

  const { data: nextPoll } = await supabase
    .from("polls")
    .select(`id${hasDurations ? ", duration_days" : ""}`)
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
  const { data: opened, error } = await supabase
    .from("polls")
    .update({ status: "open", opens_at: now.toISOString(), ...(endsAt ? { ends_at: endsAt } : {}) })
    .eq("id", next.id)
    .eq("status", "scheduled")
    .select("id");

  if (error) {
    console.error("Failed to open poll:", error.message);
    return NextResponse.json({ error: "Failed to open poll" }, { status: 500 });
  }
  if (!opened || opened.length === 0) {
    return NextResponse.json({ message: `The queued poll was already opened.${closedMessage}` });
  }

  return NextResponse.json({ message: `Poll opened.${closedMessage}`, pollId: next.id });
}
