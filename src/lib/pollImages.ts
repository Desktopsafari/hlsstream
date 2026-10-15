import { randomUUID } from "node:crypto";
import type { createServiceRoleClient } from "@/lib/supabase/server";
import { EVENT_BUCKET } from "@/config/constants";
import { checkImageUpload } from "@/lib/imageUpload";
import { publicImageUrl } from "@/lib/species";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// Option pictures live in the naming events' bucket under polls/. Files
// picked in a form before the poll exists wait in polls/pending/ until the
// poll is saved (then they're moved to polls/<pollId>/), and the daily
// cleanup removes any that were never used.
export const PENDING_PREFIX = "polls/pending/";
const PENDING_RE = /^polls\/pending\/[A-Za-z0-9._-]+$/;
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const IMAGES_SQL_HINT =
  "Pictures need the database column first: run supabase/poll_option_images.sql in the Supabase SQL Editor.";

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

// False until supabase/poll_option_images.sql has been run. Everything that
// touches pictures checks this (or tolerates the error) so the poll keeps
// working without the column.
export async function imagesSupported(supabase: Supabase): Promise<boolean> {
  const { error } = await supabase.from("poll_options").select("image_path").limit(1);
  return !error;
}

// image_path for each option id, or null when the column doesn't exist.
export async function loadOptionImagePaths(
  supabase: Supabase,
  pollIds: string[],
): Promise<Map<string, string | null> | null> {
  if (pollIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("poll_options")
    .select("id, image_path")
    .in("poll_id", pollIds);
  if (error) return null;
  return new Map((data ?? []).map((r: { id: string; image_path: string | null }) => [r.id, r.image_path]));
}

// A file can be used by more than one option (a repeating poll's copy reuses
// its parent's picture), so a file is only deleted from storage once no
// option points at it any more. If we can't tell, we keep it.
export async function removeFileIfUnreferenced(supabase: Supabase, path: string): Promise<boolean> {
  const { data, error } = await supabase.from("poll_options").select("id").eq("image_path", path).limit(1);
  if (error || (data?.length ?? 0) > 0) return false;
  await supabase.storage.from(EVENT_BUCKET).remove([path]);
  return true;
}

export async function removeFilesIfUnreferenced(
  supabase: Supabase,
  paths: (string | null | undefined)[],
): Promise<void> {
  for (const path of new Set(paths.filter((p): p is string => !!p))) {
    await removeFileIfUnreferenced(supabase, path);
  }
}

// Same rule as the options themselves: once votes exist (or the poll is
// closed) pictures can't change.
async function checkEditable(supabase: Supabase, pollId: string): Promise<ImageFailure | null> {
  const { data: poll } = await supabase.from("polls").select("status").eq("id", pollId).maybeSingle();
  if (!poll) return { ok: false, status: 404, error: "Poll not found." };
  if (poll.status === "closed") {
    return { ok: false, status: 409, code: "poll_closed", error: "This poll is closed, so its pictures can't be changed." };
  }
  const { count } = await supabase
    .from("votes")
    .select("id", { count: "exact", head: true })
    .eq("poll_id", pollId);
  const votes = count ?? 0;
  if (votes > 0) {
    return {
      ok: false,
      status: 409,
      code: "options_locked",
      error: `This poll already has ${votes} vote${votes === 1 ? "" : "s"}, so its pictures are locked along with its options. Replacing or removing a picture now would change what people voted on.`,
    };
  }
  return null;
}

type OptionRow = { id: string; poll_id: string; image_path: string | null };

async function loadOption(
  supabase: Supabase,
  optionId: string,
): Promise<{ option: OptionRow } | ImageFailure> {
  const { data, error } = await supabase
    .from("poll_options")
    .select("id, poll_id, image_path")
    .eq("id", optionId)
    .maybeSingle();
  if (isMissingColumn(error)) {
    return { ok: false, status: 400, code: "images_unsupported", error: IMAGES_SQL_HINT };
  }
  if (error || !data) return { ok: false, status: 404, error: "Option not found." };
  return { option: data as OptionRow };
}

// Replace (or set) the picture on an existing option.
export async function setOptionImage(supabase: Supabase, optionId: string, file: File): Promise<ImageResult> {
  const check = await checkImageUpload(file);
  if (!check.ok) return { ok: false, status: 400, error: check.error };

  const loaded = await loadOption(supabase, optionId);
  if (!("option" in loaded)) return loaded;
  const { option } = loaded;

  const blocked = await checkEditable(supabase, option.poll_id);
  if (blocked) return blocked;

  // Unique name per upload so the CDN/image optimizer never serves a stale copy.
  const path = `polls/${option.poll_id}/${option.id}-${Date.now()}.${check.ext}`;
  const { error: uploadError } = await supabase.storage
    .from(EVENT_BUCKET)
    .upload(path, file, { contentType: check.contentType, upsert: false });
  if (uploadError) return { ok: false, status: 500, error: uploadError.message };

  const { error: dbError } = await supabase.from("poll_options").update({ image_path: path }).eq("id", option.id);
  if (dbError) {
    await supabase.storage.from(EVENT_BUCKET).remove([path]);
    return { ok: false, status: 500, error: dbError.message };
  }

  if (option.image_path) await removeFileIfUnreferenced(supabase, option.image_path);
  return { ok: true, path, url: pollImageUrl(path) };
}

export async function clearOptionImage(supabase: Supabase, optionId: string): Promise<{ ok: true } | ImageFailure> {
  const loaded = await loadOption(supabase, optionId);
  if (!("option" in loaded)) return loaded;
  const { option } = loaded;
  if (!option.image_path) return { ok: true };

  const blocked = await checkEditable(supabase, option.poll_id);
  if (blocked) return blocked;

  const { error } = await supabase.from("poll_options").update({ image_path: null }).eq("id", option.id);
  if (error) return { ok: false, status: 500, error: error.message };
  await removeFileIfUnreferenced(supabase, option.image_path);
  return { ok: true };
}

// A picture chosen in a form before the poll/option exists.
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

// Moves a pending file to the option's own folder and records it on the
// option. On any failure the pending file is left where it was.
export async function attachPendingImage(
  supabase: Supabase,
  pollId: string,
  optionId: string,
  pendingPath: string,
): Promise<{ ok: true; path: string } | ImageFailure> {
  if (!isPendingPath(pendingPath)) {
    return { ok: false, status: 400, error: "That picture isn't a valid pending upload." };
  }
  const ext = pendingPath.split(".").pop() ?? "jpg";
  const path = `polls/${pollId}/${optionId}-${Date.now()}.${ext}`;
  const { error: moveError } = await supabase.storage.from(EVENT_BUCKET).move(pendingPath, path);
  if (moveError) return { ok: false, status: 400, error: `Couldn't use that picture: ${moveError.message}` };

  const { error: dbError } = await supabase.from("poll_options").update({ image_path: path }).eq("id", optionId);
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
