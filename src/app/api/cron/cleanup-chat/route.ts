import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { cleanupOldChatMessages, CHAT_RETENTION_DAYS } from "@/lib/chatCleanup";
import { cleanupOldFormAttempts } from "@/lib/rateLimit";

// Daily housekeeping, triggered by Vercel Cron (see vercel.json): deletes chat
// messages older than CHAT_RETENTION_DAYS and the short-lived IP records the
// form rate limits keep. (The route keeps its original name so the cron
// schedule didn't need to change.)
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const chat = await cleanupOldChatMessages();
  const attempts = await cleanupOldFormAttempts();

  if (!chat.deleted || !attempts.deleted) {
    return NextResponse.json(
      { error: [chat.error, attempts.error].filter(Boolean).join("; ") },
      { status: 500 },
    );
  }
  return NextResponse.json({
    message: `Deleted chat messages older than ${CHAT_RETENTION_DAYS} days and expired form-attempt records.`,
  });
}
