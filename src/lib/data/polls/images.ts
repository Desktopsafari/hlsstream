import { randomUUID } from "node:crypto";
import type { createServiceRoleClient } from "@/lib/supabase/server";
import { EVENT_BUCKET } from "@/config/constants";
import { checkImageUpload } from "@/lib/imageUpload";
import { publicImageUrl } from "@/lib/species";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// A poll can have one optional picture, shown above its question. It lives in
// the naming events' bucket under polls/. A file picked in the form before the
// poll exists waits in polls/pending/ until the poll is saved (then it's moved
// to polls/<pollId>/), and the daily cleanup removes any that were never used.
const PENDING_PREFIX = "polls/pending/";
const PENDING_RE = /^polls\/pending\/[A-Za-z0-9._-]+$/;
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const IMAGES_SQL_HINT =
  "Poll pictures need the database column first: run supabase/poll_question_image.sql in the Supabase SQL Editor.";

export function isPendingPath(value: unknown): value is string {
  return typeof value === "string" && PENDING_RE.test(value);
}

export function pollImageUrl(path: string | null | undefined): string | null {
  return publicImageUrl(path ?? null, EVENT_BUCKET);
}

export type ImageFailure = { ok: false; status: number; code?: string; error: string };
export type ImageResult = { ok: true; path: string; url: string | null } | ImageFailure;

function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "42703" || /image_path/i.test(error.message ?? ""));
}

// False until supabase/poll_question_image.sql has been run. Everything that
// touches the picture checks this (or tolerates the error) so polls keep
// working without the column.
export async function imagesSupported(supabase: Supabase): Promise<boolean> {
  const { error } = await supabase.from("polls").select("image_path").limit(1);
  return !error;
}

// image_path for each poll id, or null when the column doesn't exist.
export async function loadPollImagePaths(
  supabase: Supabase,
  pollIds: string[],
): Promise<Map<string, string | null> | null> {
  if (pollIds.length === 0) return new Map();
  const { data, error } = await supabase.from("polls").select("id, image_path").in("id", pollIds);
  if (error) return null;
  return new Map((data ?? []).map((r: { id: string; image_path: string | null }) => [r.id, r.image_path]));
}

// A file can be used by more than one poll (a repeating poll's next copy reuses
// its parent's picture), so a file is only deleted from storage once no poll
// points at it any more. If we can't tell, we keep it.
export async function removeFileIfUnreferenced(supabase: Supabase, path: string): Promise<boolean> {
  const { data, error } = await supabase.from("polls").select("id").eq("image_path", path).limit(1);
  if (error || (data?.length ?? 0) > 0) return false;
  await supabase.storage.from(EVENT_BUCKET).remove([path]);
  return true;
}

// The picture follows the same edit rule as the question text (see the PUT
// handler in /api/admin/polls): it can be changed on a queued or open poll,
// even once votes exist, and not on a closed one.
async function loadEditablePoll(
  supabase: Supabase,
  pollId: string,
): Promise<{ poll: { id: string; image_path: string | null } } | ImageFailure> {
  const { data: poll, error } = await supabase
    .from("polls")
    .select("id, status, image_path")
    .eq("id", pollId)
    .maybeSingle();
  if (isMissingColumn(error)) {
    return { ok: false, status: 400, code: "images_unsupported", error: IMAGES_SQL_HINT };
  }
  if (error || !poll) return { ok: false, status: 404, error: "Poll not found." };
  if (poll.status === "closed") {
    return { ok: false, status: 409, code: "poll_closed", error: "This poll is closed, so its picture can't be changed." };
  }
  return { poll: { id: poll.id, image_path: poll.image_path } };
}

// Replace (or set) the picture on an existing poll.
export async function setPollImage(supabase: Supabase, pollId: string, file: File): Promise<ImageResult> {
  const check = await checkImageUpload(file);
  if (!check.ok) return { ok: false, status: 400, error: check.error };

  const loaded = await loadEditablePoll(supabase, pollId);
  if (!("poll" in loaded)) return loaded;
  const { poll } = loaded;

  // Unique name per upload so the CDN/image optimizer never serves a stale copy.
  const path = `polls/${poll.id}/question-${Date.now()}.${check.ext}`;
  const { error: uploadError } = await supabase.storage
    .from(EVENT_BUCKET)
    .upload(path, file, { contentType: check.contentType, upsert: false });
  if (uploadError) return { ok: false, status: 500, error: uploadError.message };

  const { error: dbError } = await supabase.from("polls").update({ image_path: path }).eq("id", poll.id);
  if (dbError) {
    await supabase.storage.from(EVENT_BUCKET).remove([path]);
    return { ok: false, status: 500, error: dbError.message };
  }

  if (poll.image_path) await removeFileIfUnreferenced(supabase, poll.image_path);
  return { ok: true, path, url: pollImageUrl(path) };
}

export async function clearPollImage(supabase: Supabase, pollId: string): Promise<{ ok: true } | ImageFailure> {
  const loaded = await loadEditablePoll(supabase, pollId);
  if (!("poll" in loaded)) return loaded;
  const { poll } = loaded;
  if (!poll.image_path) return { ok: true };

  const { error } = await supabase.from("polls").update({ image_path: null }).eq("id", poll.id);
  if (error) return { ok: false, status: 500, error: error.message };
  await removeFileIfUnreferenced(supabase, poll.image_path);
  return { ok: true };
}

// A picture chosen in the form before the poll exists.
export async function uploadPendingImage(supabase: Supabase, file: File): Promise<ImageResult> {
  const check = await checkImageUpload(file);
  if (!check.ok) return { ok: false, status: 400, error: check.error };
  const path = `${PENDING_PREFIX}${randomUUID()}.${check.ext}`;
  const { error } = await supabase.storage
    .from(EVENT_BUCKET)
    .upload(path, file, { contentType: check.contentType, upsert: false });
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, path, url: pollImageUrl(path) };
}

export async function deletePendingImage(supabase: Supabase, path: string): Promise<void> {
  if (!isPendingPath(path)) return;
  await supabase.storage.from(EVENT_BUCKET).remove([path]);
}

// Moves a pending file to the poll's own folder and records it on the poll.
// On any failure the pending file is left where it was.
export async function attachPendingImage(
  supabase: Supabase,
  pollId: string,
  pendingPath: string,
): Promise<{ ok: true; path: string } | ImageFailure> {
  if (!isPendingPath(pendingPath)) {
    return { ok: false, status: 400, error: "That picture isn't a valid pending upload." };
  }
  const ext = pendingPath.split(".").pop() ?? "jpg";
  const path = `polls/${pollId}/question-${Date.now()}.${ext}`;
  const { error: moveError } = await supabase.storage.from(EVENT_BUCKET).move(pendingPath, path);
  if (moveError) return { ok: false, status: 400, error: `Couldn't use that picture: ${moveError.message}` };

  const { error: dbError } = await supabase.from("polls").update({ image_path: path }).eq("id", pollId);
  if (dbError) {
    await supabase.storage.from(EVENT_BUCKET).remove([path]);
    return isMissingColumn(dbError)
      ? { ok: false, status: 400, code: "images_unsupported", error: IMAGES_SQL_HINT }
      : { ok: false, status: 500, error: dbError.message };
  }
  return { ok: true, path };
}

// Pending files that were never saved into a poll (the admin picked a picture
// and then left the form) are deleted once they're a day old.
export async function cleanupPendingPollImages(
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
