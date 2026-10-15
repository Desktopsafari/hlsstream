import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { closePollAndFinish } from "@/lib/pollLifecycle";

// Triggered daily by Vercel Cron at a fixed UTC time approximating 8pm
// Eastern -- see vercel.json for the schedule and the DST note there.
// Closing, the results email, and carrying a repeating poll forward all live
// in closePollAndFinish (src/lib/pollLifecycle.ts), which "Open now" also uses
// when it replaces an open poll -- so a poll closed there is already closed
// here and its results aren't emailed twice.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: openPoll } = await supabase
    .from("polls")
    .select("id, question, repeat_daily")
    .eq("status", "open")
    .order("opens_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!openPoll) {
    return NextResponse.json({ message: "No open poll to close." });
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
