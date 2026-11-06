import type { createServiceRoleClient } from "@/lib/supabase/server";
import type { StreamId } from "@/lib/data/streams";
import {
  attachPendingImage,
  cleanupPendingAnnouncementImages,
  isPendingPath,
  removeFileIfUnreferenced,
} from "@/lib/data/announcements/images";
import { loadStreamAnnouncements } from "@/lib/data/announcements/public";
import {
  ANNOUNCEMENTS_SQL_HINT,
  inStreamScope,
  isMissingTable,
  parseAnnouncementInput,
  parseScope,
  pickVisible,
  toAdminAnnouncement,
  type AdminResult,
} from "@/lib/data/announcements/rules";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// The admin list, create, edit and delete. Every function takes the stream the
// admin is working on: it sees and may change that stream's announcements and
// the site-wide ones, never another stream's ("Announcement not found.").

const unsupported = { ok: false as const, status: 400, code: "unsupported", error: ANNOUNCEMENTS_SQL_HINT };
const notFound = { ok: false as const, status: 404, error: "Announcement not found." };

// The stream's own and the site-wide announcements (current, scheduled and
// past), newest first, each with its status line as seen on that stream's
// page. { supported: false } until supabase/announcements.sql runs.
export async function listAdminAnnouncements(
  supabase: Supabase,
  streamId: StreamId,
): Promise<AdminResult<{ body: Record<string, unknown> }>> {
  const loaded = await loadStreamAnnouncements(supabase, streamId, { limit: 100 });
  if ("error" in loaded) {
    if (isMissingTable(loaded.error)) return { ok: true, body: { supported: false, announcements: [] } };
    return { ok: false, status: 500, error: loaded.error.message ?? "Couldn't load announcements." };
  }

  // Housekeeping: pictures picked in the form but never saved.
  const pending = await cleanupPendingAnnouncementImages(supabase);
  if (pending.error) console.error("Pending announcement picture cleanup failed:", pending.error);

  const now = new Date();
  const shown = new Set(pickVisible(loaded.rows, now).map((a) => a.id));
  return {
    ok: true,
    body: { supported: true, announcements: loaded.rows.map((a) => toAdminAnnouncement(a, shown, now)) },
  };
}

// Creates an announcement. `scope` "site-wide" shows it on every stream page;
// "stream" or nothing shows it only on the stream the request is for. A
// picture picked before saving arrives as a pending path and is moved into
// the announcement's folder.
export async function createAnnouncement(
  supabase: Supabase,
  streamId: StreamId,
  body: Record<string, unknown> | null,
): Promise<AdminResult<{ id: string; warning?: string }>> {
  const parsed = parseAnnouncementInput(body);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const scope = parseScope(body?.scope, streamId);
  if (!scope.ok) return { ok: false, status: 400, error: scope.error };

  const pendingPath = body?.pendingImagePath;
  if (pendingPath != null && pendingPath !== "" && !isPendingPath(pendingPath)) {
    return { ok: false, status: 400, error: "That picture isn't a valid pending upload." };
  }

  const { data: created, error } = await supabase
    .from("announcements")
    .insert({ stream_id: scope.streamId === undefined ? streamId : scope.streamId, ...parsed.fields })
    .select("id")
    .single();
  if (isMissingTable(error)) return unsupported;
  if (error || !created) return { ok: false, status: 500, error: error?.message ?? "Failed to save the announcement." };

  if (typeof pendingPath === "string" && pendingPath) {
    const attached = await attachPendingImage(supabase, created.id, pendingPath);
    if (!attached.ok) return { ok: true, id: created.id, warning: `Saved, but the picture wasn't attached: ${attached.error}` };
  }
  return { ok: true, id: created.id };
}

// Saves an existing announcement's text, button, timing and switch -- and its
// scope, only if `scope` is sent (not sent = it stays where it is). Its
// picture has its own route (/api/admin/announcements/image).
export async function updateAnnouncement(
  supabase: Supabase,
  streamId: StreamId,
  body: Record<string, unknown> | null,
): Promise<AdminResult> {
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return { ok: false, status: 400, error: "Missing id." };

  const parsed = parseAnnouncementInput(body);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const scope = parseScope(body?.scope, streamId);
  if (!scope.ok) return { ok: false, status: 400, error: scope.error };

  const { data: existing, error: loadError } = await supabase
    .from("announcements")
    .select("id, stream_id")
    .eq("id", id)
    .maybeSingle();
  if (isMissingTable(loadError)) return unsupported;
  if (!existing || !inStreamScope(existing, streamId)) return notFound;

  const { error } = await supabase
    .from("announcements")
    .update({
      ...parsed.fields,
      ...(scope.streamId === undefined ? {} : { stream_id: scope.streamId }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true };
}

// Deletes an announcement and its picture (unless another announcement uses
// the same file). Already gone = fine; another stream's = not found.
export async function deleteAnnouncement(supabase: Supabase, streamId: StreamId, id: string): Promise<AdminResult> {
  const { data: existing, error: loadError } = await supabase
    .from("announcements")
    .select("id, stream_id, image_path")
    .eq("id", id)
    .maybeSingle();
  if (isMissingTable(loadError)) return unsupported;
  if (!existing) return { ok: true };
  if (!inStreamScope(existing, streamId)) return notFound;

  const { error } = await supabase.from("announcements").delete().eq("id", id);
  if (error) return { ok: false, status: 500, error: error.message };
  if (existing.image_path) await removeFileIfUnreferenced(supabase, existing.image_path);
  return { ok: true };
}
