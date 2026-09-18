import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

// Triggered daily by Vercel Cron at a fixed UTC time approximating noon
// Eastern -- see vercel.json for the schedule and README-style comments
// there about the twice-yearly DST adjustment this needs.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

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

  const { error } = await supabase
    .from("polls")
    .update({ status: "open", opens_at: new Date().toISOString() })
    .eq("id", nextPoll.id);

  if (error) {
    console.error("Failed to open poll:", error.message);
    return NextResponse.json({ error: "Failed to open poll" }, { status: 500 });
  }

  return NextResponse.json({ message: "Poll opened.", pollId: nextPoll.id });
}
