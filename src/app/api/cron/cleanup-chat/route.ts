import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { cleanupOldChatMessages, CHAT_RETENTION_DAYS } from "@/lib/chatCleanup";
import { cleanupOldFormAttempts } from "@/lib/rateLimit";
import { unlinkOldVotes, VOTE_LINK_RETENTION_DAYS } from "@/lib/voteUnlink";
import { cleanupPendingPollImages } from "@/lib/pollImages";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Daily housekeeping, triggered by Vercel Cron (see vercel.json):
//  - deletes chat messages older than CHAT_RETENTION_DAYS
//  - deletes the short-lived IP records the form rate limits keep
//  - unlinks votes from browsers VOTE_LINK_RETENTION_DAYS after their poll closes
//  - deletes poll pictures that were uploaded but never saved into a poll
// (The route keeps its original name so the cron schedule didn't need to change.)
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const chat = await cleanupOldChatMessages();
  const attempts = await cleanupOldFormAttempts();
  const votes = await unlinkOldVotes();
  // Poll pictures picked in the admin form but never saved. Housekeeping only,
  // so a failure here is logged rather than failing the whole job.
  const pending = await cleanupPendingPollImages(createServiceRoleClient());
  if (pending.error) console.error("Pending poll picture cleanup failed:", pending.error);

  const errors = [chat.error, attempts.error, votes.error].filter(Boolean);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 500 });
  }
  return NextResponse.json({
    message: `Deleted chat messages older than ${CHAT_RETENTION_DAYS} days and expired form-attempt records; unlinked ${votes.unlinked} vote(s) from polls closed over ${VOTE_LINK_RETENTION_DAYS} days ago.`,
  });
}
