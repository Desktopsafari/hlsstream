import { createServiceRoleClient } from "@/lib/supabase/server";

// How long after a poll closes its votes stay tied to a browser's session id.
// The id is only needed while the poll is open (one vote per session) and for
// a short while after, to look into anything odd; then it is replaced with an
// unrelated random value. The votes themselves stay -- poll history and the
// results screen are counted from them.
export const VOTE_LINK_RETENTION_DAYS = 7;

const UNLINKED_PREFIX = "anon-";
const BATCH_SIZE = 500;
const MAX_BATCHES = 40;

// Safe to run repeatedly: rows already unlinked (anon-...) are skipped.
export async function unlinkOldVotes(): Promise<{ unlinked: number; error?: string }> {
  const supabase = createServiceRoleClient();
  const cutoff = new Date(Date.now() - VOTE_LINK_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: polls, error: pollError } = await supabase
    .from("polls")
    .select("id")
    .eq("status", "closed")
    .lt("closes_at", cutoff);

  if (pollError) {
    console.error("Vote unlink failed (polls):", pollError.message);
    return { unlinked: 0, error: pollError.message };
  }
  const pollIds = (polls ?? []).map((p) => p.id);
  if (pollIds.length === 0) return { unlinked: 0 };

  let unlinked = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const { data: votes, error: voteError } = await supabase
      .from("votes")
      .select("id, poll_id, option_id")
      .in("poll_id", pollIds)
      .not("session_id", "like", `${UNLINKED_PREFIX}%`)
      .limit(BATCH_SIZE);

    if (voteError) {
      console.error("Vote unlink failed (votes):", voteError.message);
      return { unlinked, error: voteError.message };
    }
    if (!votes || votes.length === 0) break;

    // Only session_id is sent for update; other columns on these existing
    // rows are left as they are. A fresh random value per vote keeps the
    // one-vote-per-session-per-poll uniqueness rule satisfied.
    const { error: updateError } = await supabase.from("votes").upsert(
      votes.map((v) => ({
        id: v.id,
        poll_id: v.poll_id,
        option_id: v.option_id,
        session_id: `${UNLINKED_PREFIX}${crypto.randomUUID()}`,
      })),
      { onConflict: "id" },
    );

    if (updateError) {
      console.error("Vote unlink failed (update):", updateError.message);
      return { unlinked, error: updateError.message };
    }
    unlinked += votes.length;
    if (votes.length < BATCH_SIZE) break;
  }

  return { unlinked };
}
