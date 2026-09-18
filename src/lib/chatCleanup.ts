import { createServiceRoleClient } from "@/lib/supabase/server";

export const CHAT_RETENTION_DAYS = 30;

export async function cleanupOldChatMessages(): Promise<{ deleted: boolean; error?: string }> {
  const supabase = createServiceRoleClient();
  const cutoff = new Date(Date.now() - CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase.from("chat_messages").delete().lt("created_at", cutoff);

  if (error) {
    console.error("Chat cleanup failed:", error.message);
    return { deleted: false, error: error.message };
  }
  return { deleted: true };
}
