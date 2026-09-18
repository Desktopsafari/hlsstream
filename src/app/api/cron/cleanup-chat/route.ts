import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { cleanupOldChatMessages, CHAT_RETENTION_DAYS } from "@/lib/chatCleanup";

// Deletes chat messages older than CHAT_RETENTION_DAYS. Triggered daily by
// Vercel Cron (see vercel.json).
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await cleanupOldChatMessages();

  if (!result.deleted) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ message: `Deleted chat messages older than ${CHAT_RETENTION_DAYS} days.` });
}
