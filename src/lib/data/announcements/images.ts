import { randomUUID } from "node:crypto";
import type { createServiceRoleClient } from "@/lib/supabase/server";
import { EVENT_BUCKET } from "@/config/constants";
import { checkImageUpload } from "@/lib/imageUpload";
import type { StreamId } from "@/lib/data/streams";
import { ANNOUNCEMENTS_SQL_HINT, announcementImageUrl, inStreamScope, isMissingTable } from "@/lib/data/announcements/rules";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// A picture picked before the announcement is saved waits in
// announcements/pending/ and is moved to announcements/<id>/ on save. Pending
// files that were never used are deleted once a day old (checked whenever the
// admin list loads, so no extra cron job is needed). Pending files belong to
// no stream; a picture on a saved announcement can only be changed by an admin
// working on a stream that announcement shows on (site-wide or its own).
const PENDING_PREFIX = "announcements/pending/";
const PENDING_RE = /^announcements\/pending\/[A-Za-z0-9._-]+$/;
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function isPendingPath(value: unknown): value is string {
  return typeof value === "string" && PENDING_RE.test(value);
}

export type ImageFailure = { ok: false; status: number; code?: string; error: string };
export type ImageResult = { ok: true; path: string; url: string | null } | ImageFailure;

// A file is only deleted once no announcement points at it any more. If we
// can't tell, we keep it. Checked across every stream on purpose: a file still
// used anywhere is never deleted.
export async function removeFileIfUnreferenced(supabase: Supabase, path: string): Promise<boolean> {
  const { data, error } = await supabase.from("announcements").select("id").eq("image_path", path).limit(1);
  if (error || (data?.length ?? 0) > 0) return false;
  await supabase.storage.from(EVENT_BUCKET).remove([path]);
  return true;
}

async function loadAnnouncement(
  supabase: Supabase,
  streamId: StreamId,
  id: string,
): Promise<{ row: { id: string; image_path: string | null } } | ImageFailure> {
  const { data, error } = await supabase
    .from("announcements")
    .select("id, stream_id, image_path")
    .eq("id", id)
    .maybeSingle();
  if (isMissingTable(error)) return { ok: false, status: 400, code: "unsupported", error: ANNOUNCEMENTS_SQL_HINT };
  if (error || !data || !inStreamScope(data, streamId)) return { ok: false, status: 404, error: "Announcement not found." };
  return { row: { id: data.id, image_path: data.image_path } };
}

const savedPath = (id: string, ext: string) => `announcements/${id}/picture-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;

// Replace (or set) the picture on a saved announcement.
export async function setAnnouncementImage(supabase: Supabase, streamId: StreamId, id: string, file: File): Promise<ImageResult> {
  const check = await checkImageUpload(file);
  if (!check.ok) return { ok: false, status: 400, error: check.error };

  const loaded = await loadAnnouncement(supabase, streamId, id);
  if (!("row" in loaded)) return loaded;
  const { row } = loaded;

  const path = savedPath(row.id, check.ext);
  const { error: uploadError } = await supabase.storage
    .from(EVENT_BUCKET)
    .upload(path, file, { contentType: check.contentType, upsert: false });
  if (uploadError) return { ok: false, status: 500, error: uploadError.message };

  const { error: dbError } = await supabase.from("announcements").update({ image_path: path }).eq("id", row.id);
  if (dbError) {
    await supabase.storage.from(EVENT_BUCKET).remove([path]);
    return { ok: false, status: 500, error: dbError.message };
  }

  if (row.image_path) await removeFileIfUnreferenced(supabase, row.image_path);
  return { ok: true, path, url: announcementImageUrl(path) };
}

export async function clearAnnouncementImage(
  supabase: Supabase,
  streamId: StreamId,
  id: string,
): Promise<{ ok: true } | ImageFailure> {
  const loaded = await loadAnnouncement(supabase, streamId, id);
  if (!("row" in loaded)) return loaded;
  const { row } = loaded;
  if (!row.image_path) return { ok: true };

  const { error } = await supabase.from("announcements").update({ image_path: null }).eq("id", row.id);
  if (error) return { ok: false, status: 500, error: error.message };
  await removeFileIfUnreferenced(supabase, row.image_path);
  return { ok: true };
}

export async function uploadPendingImage(supabase: Supabase, file: File): Promise<ImageResult> {
  const check = await checkImageUpload(file);
  if (!check.ok) return { ok: false, status: 400, error: check.error };
  const path = `${PENDING_PREFIX}${randomUUID()}.${check.ext}`;
  const { error } = await supabase.storage
    .from(EVENT_BUCKET)
    .upload(path, file, { contentType: check.contentType, upsert: false });
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, path, url: announcementImageUrl(path) };
}

export async function deletePendingImage(supabase: Supabase, path: string): Promise<void> {
  if (!isPendingPath(path)) return;
  await supabase.storage.from(EVENT_BUCKET).remove([path]);
}

// Moves a pending file into a just-created announcement's own folder and
// records it. Only called right after that announcement was inserted.
export async function attachPendingImage(
  supabase: Supabase,
  id: string,
  pendingPath: string,
): Promise<{ ok: true; path: string } | ImageFailure> {
  if (!isPendingPath(pendingPath)) {
    return { ok: false, status: 400, error: "That picture isn't a valid pending upload." };
  }
  const ext = pendingPath.split(".").pop() ?? "jpg";
  const path = savedPath(id, ext);
  const { error: moveError } = await supabase.storage.from(EVENT_BUCKET).move(pendingPath, path);
  if (moveError) return { ok: false, status: 400, error: `Couldn't use that picture: ${moveError.message}` };

  const { error: dbError } = await supabase.from("announcements").update({ image_path: path }).eq("id", id);
  if (dbError) {
    await supabase.storage.from(EVENT_BUCKET).remove([path]);
    return { ok: false, status: 500, error: dbError.message };
  }
  return { ok: true, path };
}

// Housekeeping across every stream (pending files belong to none).
export async function cleanupPendingAnnouncementImages(
  supabase: Supabase,
  now: number = Date.now(),
): Promise<{ removed: number; error?: string }> {
  const folder = PENDING_PREFIX.replace(/\/$/, "");
  const { data, error } = await supabase.storage.from(EVENT_BUCKET).list(folder, { limit: 1000 });
  if (error) return { removed: 0, error: error.message };
  const stale = (data ?? [])
    .filter((f: { name: string; created_at?: string | null }) => {
      const created = f.created_at ? Date.parse(f.created_at) : NaN;
      return Number.isFinite(created) && now - created > PENDING_MAX_AGE_MS;
    })
    .map((f: { name: string }) => `${PENDING_PREFIX}${f.name}`);
  if (stale.length === 0) return { removed: 0 };
  const { error: removeError } = await supabase.storage.from(EVENT_BUCKET).remove(stale);
  if (removeError) return { removed: 0, error: removeError.message };
  return { removed: stale.length };
}
