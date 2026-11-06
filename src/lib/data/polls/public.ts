import type { createServiceRoleClient } from "@/lib/supabase/server";
import { getPollState } from "@/lib/pollSchedule";
import { loadPollImagePaths, pollImageUrl } from "@/lib/data/polls/images";
import { getPublicPoll } from "@/lib/data/polls/visibility";
import { findSessionVote, loadPollResults } from "@/lib/data/polls/votes";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// Everything the public poll card gets from /api/poll.
//
// Prefer the currently open poll; otherwise show the most recently closed one
// (so results stay visible until the next poll opens) -- unless it's hidden
// from the site, by hand or by the auto-hide timer. A hidden poll's content is
// never sent.
export async function getPublicPollPayload(supabase: Supabase, sessionId: string | null) {
  const { poll, hideAt } = await getPublicPoll(supabase);
  const serverTime = new Date().toISOString();

  if (!poll) return { poll: null, serverTime };

  // Report an open poll as closed once its end has passed (8pm for a normal
  // poll, the chosen end time otherwise, never for an open-ended one), even if
  // the (imprecise) cron hasn't flipped the stored status yet.
  if (getPollState(poll).phase === "ended") {
    poll.status = "closed";
  }

  const options = await loadPollResults(supabase, poll.id);

  // The poll's optional picture. Null when it has none, and also when
  // supabase/poll_question_image.sql hasn't been run (no column to read).
  const imagePaths = await loadPollImagePaths(supabase, [poll.id]);
  const imageUrl = pollImageUrl(imagePaths?.get(poll.id) ?? null);

  const votedOptionId = sessionId ? await findSessionVote(supabase, poll.id, sessionId) : null;

  return {
    poll: { ...poll, image_url: imageUrl },
    options,
    hasVoted: votedOptionId !== null,
    votedOptionId,
    // When the auto-hide timer will hide this (closed) poll, so an open page
    // can take the card away on time. Null = it won't hide by itself.
    hideAt: hideAt?.toISOString() ?? null,
    serverTime,
  };
}
