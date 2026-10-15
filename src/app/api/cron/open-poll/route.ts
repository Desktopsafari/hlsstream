import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { isPollPastCutoff } from "@/lib/pollSchedule";

// Triggered daily by Vercel Cron at a fixed UTC time approximating noon
// Eastern -- see vercel.json for the schedule and README-style comments
// there about the twice-yearly DST adjustment this needs.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // A poll the admin already opened by hand ("Open now") is still taking
  // votes, so the queued one waits for tomorrow instead of opening on top of
  // it. (A poll past its 8pm cutoff doesn't count; it just hasn't been
  // flipped to closed yet.)
  const { data: openPolls } = await supabase
    .from("polls")
    .select("id, opens_at")
    .eq("status", "open");
  if ((openPolls ?? []).some((p) => !isPollPastCutoff(p.opens_at))) {
    return NextResponse.json({ message: "A poll is already open, so the queued poll was left for later." });
  }

  const { data: nextPoll } = await supabase
    .from("polls")
    .select("id")
    .eq("status", "scheduled")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!nextPoll) {
    return NextResponse.json({ message: "No scheduled poll to open." });
  }

  // Conditional on still being queued, so it can't clash with an "Open now"
  // that grabbed the same poll a moment earlier.
  const { data: opened, error } = await supabase
    .from("polls")
    .update({ status: "open", opens_at: new Date().toISOString() })
    .eq("id", nextPoll.id)
    .eq("status", "scheduled")
    .select("id");

  if (error) {
    console.error("Failed to open poll:", error.message);
    return NextResponse.json({ error: "Failed to open poll" }, { status: 500 });
  }
  if (!opened || opened.length === 0) {
    return NextResponse.json({ message: "The queued poll was already opened." });
  }

  return NextResponse.json({ message: "Poll opened.", pollId: nextPoll.id });
}
