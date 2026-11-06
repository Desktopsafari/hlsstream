import type { createServiceRoleClient } from "@/lib/supabase/server";
import { getPollState, type PollTiming } from "@/lib/pollSchedule";
import { timingSelect } from "@/lib/data/polls/timing";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// Votes, option results and the per-poll vote count. Everything here is keyed
// by poll id: a vote, its dedupe rule (one per browser per poll, enforced by
// the votes (poll_id, session_id) unique key) and every count belong to one
// poll, never to a set of polls.

export type ResultRow = { option_id: string; label: string; display_order: number; vote_count: number };

// The option counts for one poll, in display order (the poll_results view).
export async function loadPollResults(supabase: Supabase, pollId: string): Promise<ResultRow[]> {
  const { data } = await supabase
    .from("poll_results")
    .select("option_id, label, display_order, vote_count")
    .eq("poll_id", pollId)
    .order("display_order", { ascending: true });
  return (data ?? []) as ResultRow[];
}

// The option counts for several polls at once (the admin history).
export async function loadResultsForPolls(
  supabase: Supabase,
  pollIds: string[],
): Promise<(ResultRow & { poll_id: string })[]> {
  const { data } = await supabase
    .from("poll_results")
    .select("poll_id, option_id, label, display_order, vote_count")
    .in("poll_id", pollIds.length > 0 ? pollIds : ["00000000-0000-0000-0000-000000000000"]);
  return (data ?? []) as (ResultRow & { poll_id: string })[];
}

export async function countVotes(supabase: Supabase, pollId: string): Promise<number> {
  const { count } = await supabase
    .from("votes")
    .select("id", { count: "exact", head: true })
    .eq("poll_id", pollId);
  return count ?? 0;
}

// The option this browser voted for in this poll, or null.
export async function findSessionVote(supabase: Supabase, pollId: string, sessionId: string): Promise<string | null> {
  const { data: existingVote } = await supabase
    .from("votes")
    .select("option_id")
    .eq("poll_id", pollId)
    .eq("session_id", sessionId)
    .maybeSingle();
  return existingVote ? existingVote.option_id : null;
}

export type VoteResult = { ok: true } | { ok: false; status: number; error: string };

// Records one vote. The real end time is enforced here on every vote (the
// crons that flip status to "closed" run once a day, imprecisely): the normal
// 8pm cutoff, a chosen end time, or never for an open-ended poll.
export async function castVote(
  supabase: Supabase,
  input: { pollId: string; optionId: string; sessionId: string },
): Promise<VoteResult> {
  const { pollId, optionId, sessionId } = input;

  // ends_at / open_ended exist once supabase/poll_duration.sql has been run.
  const { data: pollRow } = await supabase
    .from("polls")
    .select(`id, status, opens_at${await timingSelect(supabase)}`)
    .eq("id", pollId)
    .maybeSingle();
  const poll = pollRow as unknown as ({ id: string; status: string } & PollTiming) | null;

  const state = poll ? getPollState(poll) : null;
  if (!state || (state.phase !== "open" && state.phase !== "ended")) {
    return { ok: false, status: 400, error: "This poll isn't open for voting." };
  }
  if (!state.votingOpen) {
    return { ok: false, status: 400, error: "Voting has closed for this poll." };
  }

  const { data: option } = await supabase
    .from("poll_options")
    .select("id")
    .eq("id", optionId)
    .eq("poll_id", pollId)
    .maybeSingle();
  if (!option) return { ok: false, status: 400, error: "Invalid option." };

  const { error } = await supabase.from("votes").insert({
    poll_id: pollId,
    option_id: optionId,
    session_id: sessionId,
  });

  if (error) {
    // Unique constraint violation (poll_id, session_id) -> already voted.
    if (error.code === "23505") {
      return { ok: false, status: 409, error: "You've already voted in this poll." };
    }
    console.error("Vote insert failed:", error.message);
    return { ok: false, status: 500, error: "Failed to record vote." };
  }
  return { ok: true };
}
