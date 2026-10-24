import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getPollState } from "@/lib/pollSchedule";
import { loadPollImagePaths, pollImageUrl } from "@/lib/pollImages";
import { getPublicPoll } from "@/lib/pollVisibility";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  const supabase = createServiceRoleClient();

  // Prefer the currently open poll; otherwise show the most recently
  // closed one (so results stay visible until the next poll opens) -- unless
  // it's hidden from the site, by hand or by the auto-hide timer. A hidden
  // poll's content is never sent.
  const { poll, hideAt } = await getPublicPoll(supabase);
  const serverTime = new Date().toISOString();

  if (!poll) {
    return NextResponse.json({ poll: null, serverTime });
  }

  // Report an open poll as closed once its end has passed (8pm for a normal
  // poll, the chosen end time otherwise, never for an open-ended one), even if
  // the (imprecise) cron hasn't flipped the stored status yet.
  if (getPollState(poll).phase === "ended") {
    poll.status = "closed";
  }

  const { data: options } = await supabase
    .from("poll_results")
    .select("option_id, label, display_order, vote_count")
    .eq("poll_id", poll.id)
    .order("display_order", { ascending: true });

  // The poll's optional picture. Null when it has none, and also when
  // supabase/poll_question_image.sql hasn't been run (no column to read).
  const imagePaths = await loadPollImagePaths(supabase, [poll.id]);
  const imageUrl = pollImageUrl(imagePaths?.get(poll.id) ?? null);

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
    poll: { ...poll, image_url: imageUrl },
    options: options ?? [],
    hasVoted,
    votedOptionId,
    // When the auto-hide timer will hide this (closed) poll, so an open page
    // can take the card away on time. Null = it won't hide by itself.
    hideAt: hideAt?.toISOString() ?? null,
    serverTime,
  });
}
