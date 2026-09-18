import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { sendPollResultsEmail } from "@/lib/email";

// Triggered daily by Vercel Cron at a fixed UTC time approximating 8pm
// Eastern -- see vercel.json for the schedule and the DST note there.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: openPoll } = await supabase
    .from("polls")
    .select("id, question")
    .eq("status", "open")
    .order("opens_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!openPoll) {
    return NextResponse.json({ message: "No open poll to close." });
  }

  const { error } = await supabase
    .from("polls")
    .update({ status: "closed", closes_at: new Date().toISOString() })
    .eq("id", openPoll.id);

  if (error) {
    console.error("Failed to close poll:", error.message);
    return NextResponse.json({ error: "Failed to close poll" }, { status: 500 });
  }

  const { data: results } = await supabase
    .from("poll_results")
    .select("label, vote_count")
    .eq("poll_id", openPoll.id);

  await sendPollResultsEmail(openPoll.question, results ?? []);

  return NextResponse.json({ message: "Poll closed and results emailed.", pollId: openPoll.id });
}
