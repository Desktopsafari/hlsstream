import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isPollPastEnd, type PollTiming } from "@/lib/pollSchedule";
import { timingSelect } from "@/lib/pollTiming";
import { loadPollImagePaths, pollImageUrl } from "@/lib/pollImages";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  const supabase = createServiceRoleClient();
  // ends_at / open_ended exist once supabase/poll_duration.sql has been run.
  const timing = await timingSelect(supabase);

  // Prefer the currently open poll; otherwise show the most recently
  // closed one (so results stay visible until the next poll opens).
  const { data: openPollRow } = await supabase
    .from("polls")
    .select(`id, question, status, opens_at, closes_at${timing}`)
    .eq("status", "open")
    .order("opens_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  type PollRow = { id: string; question: string; status: string; opens_at: string; closes_at: string } & PollTiming;
  const openPoll = openPollRow as unknown as PollRow | null;

  const poll =
    openPoll ??
    ((
      await supabase
        .from("polls")
        .select(`id, question, status, opens_at, closes_at${timing}`)
        .eq("status", "closed")
        .order("closes_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ).data as unknown as PollRow | null);

  if (!poll) {
    return NextResponse.json({ poll: null });
  }

  // Report an open poll as closed once its end has passed (8pm for a normal
  // poll, the chosen end time otherwise, never for an open-ended one), even if
  // the (imprecise) cron hasn't flipped the stored status yet.
  if (poll.status === "open" && isPollPastEnd(poll)) {
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
  });
}
