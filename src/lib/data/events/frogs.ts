import type { createServiceRoleClient } from "@/lib/supabase/server";
import { EVENT_BUCKET, EVENT_MAX_FROGS } from "@/config/constants";
import type { StreamId } from "@/lib/data/streams";
import { EVENT_NOT_FOUND, findEventInStream } from "@/lib/data/events/manage";
import { eventImageUrl, type EventResult } from "@/lib/data/events/rules";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// Adding and removing an event's frogs and their pictures. Only frogs of an
// event on the stream the admin is working on: another stream's frog is
// "Frog not found."

const FROG_NOT_FOUND = { ok: false as const, status: 404, error: "Frog not found." };

// Vercel serverless request bodies max out around 4.5MB, so stay under it.
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type FrogRow = { id: string; event_id: string; image_path: string | null };

// The frog, if it exists; `inStream` says whether its event is on this stream.
async function findFrog(
  supabase: Supabase,
  streamId: StreamId,
  frogId: string,
): Promise<{ frog: FrogRow; inStream: boolean } | null> {
  const { data: frog } = await supabase
    .from("suggestion_event_frogs")
    .select("id, event_id, image_path")
    .eq("id", frogId)
    .maybeSingle();
  if (!frog) return null;
  const event = await findEventInStream(supabase, streamId, frog.event_id);
  return { frog, inStream: event !== null };
}

export async function addFrog(
  supabase: Supabase,
  streamId: StreamId,
  eventId: string,
): Promise<EventResult<{ frogId: string }>> {
  if (!eventId) return { ok: false, status: 400, error: "Missing eventId." };
  if (!(await findEventInStream(supabase, streamId, eventId))) return EVENT_NOT_FOUND;

  const { data: existing } = await supabase
    .from("suggestion_event_frogs")
    .select("id, display_order")
    .eq("event_id", eventId);

  const frogs = existing ?? [];
  if (frogs.length >= EVENT_MAX_FROGS) {
    return { ok: false, status: 400, error: `An event can have up to ${EVENT_MAX_FROGS} frogs.` };
  }

  const nextOrder = frogs.reduce((max, f) => Math.max(max, f.display_order), -1) + 1;
  const label = frogs.length < 26 ? `Frog ${String.fromCharCode(65 + frogs.length)}` : `Frog ${frogs.length + 1}`;

  const { data: frog, error } = await supabase
    .from("suggestion_event_frogs")
    .insert({ event_id: eventId, label, display_order: nextOrder })
    .select("id")
    .single();
  if (error || !frog) return { ok: false, status: 500, error: error?.message ?? "Failed to add frog." };
  return { ok: true, frogId: frog.id };
}

// Removing a frog would also delete the name ideas sent in for it, so it's
// refused while any exist. Already gone = fine.
export async function removeFrog(supabase: Supabase, streamId: StreamId, frogId: string): Promise<EventResult> {
  if (!frogId) return { ok: false, status: 400, error: "Missing frogId." };
  const found = await findFrog(supabase, streamId, frogId);
  if (!found) return { ok: true };
  if (!found.inStream) return FROG_NOT_FOUND;
  const { frog } = found;

  const { count } = await supabase
    .from("name_suggestions")
    .select("id", { count: "exact", head: true })
    .eq("frog_id", frogId);
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      status: 409,
      error: `This frog already has ${count} name idea${count === 1 ? "" : "s"}. Removing it would delete them. Delete them in the review list first if you want it gone.`,
      code: "frog_has_suggestions",
    };
  }

  const { error } = await supabase.from("suggestion_event_frogs").delete().eq("id", frogId);
  if (error) return { ok: false, status: 500, error: error.message };

  if (frog.image_path) await supabase.storage.from(EVENT_BUCKET).remove([frog.image_path]);
  return { ok: true };
}

export async function setFrogImage(
  supabase: Supabase,
  streamId: StreamId,
  frogId: string,
  file: File,
): Promise<EventResult<{ url: string | null }>> {
  const ext = TYPES[file.type];
  if (!ext) return { ok: false, status: 400, error: "Images must be JPG, PNG, or WebP." };
  if (file.size > MAX_BYTES) {
    return { ok: false, status: 400, error: "That image is over 4MB. Please resize/compress it and try again." };
  }

  const found = await findFrog(supabase, streamId, frogId);
  if (!found || !found.inStream) return FROG_NOT_FOUND;
  const { frog } = found;

  // Unique name per upload so the CDN/image optimizer never serves a stale copy.
  const path = `${frog.event_id}/${frog.id}-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(EVENT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { ok: false, status: 500, error: uploadError.message };

  const { error: dbError } = await supabase
    .from("suggestion_event_frogs")
    .update({ image_path: path })
    .eq("id", frog.id);
  if (dbError) {
    await supabase.storage.from(EVENT_BUCKET).remove([path]);
    return { ok: false, status: 500, error: dbError.message };
  }

  // Replacing deletes the old file so storage (and the image optimizer's
  // source-image count) doesn't accumulate.
  if (frog.image_path) await supabase.storage.from(EVENT_BUCKET).remove([frog.image_path]);

  return { ok: true, url: eventImageUrl(path) };
}

// No frog or no picture = fine; another stream's frog = not found.
export async function clearFrogImage(supabase: Supabase, streamId: StreamId, frogId: string): Promise<EventResult> {
  const found = await findFrog(supabase, streamId, frogId);
  if (!found) return { ok: true };
  if (!found.inStream) return FROG_NOT_FOUND;
  const { frog } = found;
  if (!frog.image_path) return { ok: true };

  const { error } = await supabase
    .from("suggestion_event_frogs")
    .update({ image_path: null })
    .eq("id", frog.id);
  if (error) return { ok: false, status: 500, error: error.message };

  await supabase.storage.from(EVENT_BUCKET).remove([frog.image_path]);
  return { ok: true };
}
