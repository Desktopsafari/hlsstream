import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  const supabase = createServiceRoleClient();

  // Prefer the currently open poll; otherwise show the most recently
  // closed one (so results stay visible until the next poll opens).
  const { data: openPoll } = await supabase
    .from("polls")
    .select("id, question, status, opens_at, closes_at")
    .eq("status", "open")
    .order("opens_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const poll =
    openPoll ??
    (
      await supabase
        .from("polls")
        .select("id, question, status, opens_at, closes_at")
        .eq("status", "closed")
        .order("closes_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ).data;

  if (!poll) {
    return NextResponse.json({ poll: null });
  }

  const { data: options } = await supabase
    .from("poll_results")
    .select("option_id, label, display_order, vote_count")
    .eq("poll_id", poll.id)
    .order("display_order", { ascending: true });

  let hasVoted = false;
  let votedOptionId: string | null = null;

  if (sessionId) {
    const { data: existingVote } = await supabase
      .from("votes")
      .select("option_id")
      .eq("poll_id", poll.id)
      .eq("session_id", sessionId)
      .maybeSingle();

    if (existingVote) {
      hasVoted = true;
      votedOptionId = existingVote.option_id;
    }
  }

  return NextResponse.json({
    poll,
    options: options ?? [],
    hasVoted,
    votedOptionId,
  });
}
