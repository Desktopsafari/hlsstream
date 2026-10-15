import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isPollPastCutoff } from "@/lib/pollSchedule";
import { loadOptionImagePaths, pollImageUrl } from "@/lib/pollImages";

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

  // Report an open poll as closed once the 8pm cutoff has passed, even if the
  // (imprecise) cron hasn't flipped the stored status yet.
  if (poll.status === "open" && isPollPastCutoff(poll.opens_at)) {
    poll.status = "closed";
  }

  const { data: options } = await supabase
    .from("poll_results")
    .select("option_id, label, display_order, vote_count")
    .eq("poll_id", poll.id)
    .order("display_order", { ascending: true });

  // Option pictures live in poll_options (the poll_results view doesn't carry
  // them). Null when supabase/poll_option_images.sql hasn't been run, in which
  // case every option simply has no picture.
  const imagePaths = await loadOptionImagePaths(supabase, [poll.id]);
  const optionsWithPictures = (options ?? []).map((o) => ({
    ...o,
    image_url: pollImageUrl(imagePaths?.get(o.option_id) ?? null),
  }));

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
    options: optionsWithPictures,
    hasVoted,
    votedOptionId,
  });
}
