import type { createServiceRoleClient } from "@/lib/supabase/server";
import { SPECIES_BUCKET } from "@/config/constants";
import type { StreamId } from "@/lib/data/streams";
import { publicImageUrl } from "@/lib/publicImageUrl";
import {
  IMAGE_KINDS,
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  NAMES_SQL_HINT,
  parseSpeciesCardInput,
  toSpeciesCardData,
  type ImageKind,
  type SpeciesCardRow,
} from "@/lib/data/species/rules";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// Every function takes the stream (one card per stream: species_cards.stream_id
// is unique) and only reads or writes that stream's card; no other stream's
// card can be reached.

export type SpeciesResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; status: number; error: string; code?: string };

const CARD_COLUMNS =
  "species_name, scientific_name, conservation_status, photo_path, range_map_path, info_blocks";

function isMissingNamesColumns(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "42703" || /names/i.test(error.message ?? ""));
}

// The stream's species card row. Falls back to the columns that existed
// before the names block, so the card keeps working until
// supabase/species_names.sql is run (namesSupported is then false).
export async function loadSpeciesCardRow(
  supabase: Supabase,
  streamId: StreamId,
): Promise<{ row: SpeciesCardRow | null; namesSupported: boolean; error: string | null }> {
  const withNames = await supabase
    .from("species_cards")
    .select(`${CARD_COLUMNS}, names_heading, names`)
    .eq("stream_id", streamId)
    .maybeSingle();
  if (!withNames.error) {
    return { row: (withNames.data as SpeciesCardRow | null) ?? null, namesSupported: true, error: null };
  }
  if (!isMissingNamesColumns(withNames.error)) {
    return { row: null, namesSupported: false, error: withNames.error.message };
  }
  const { data, error } = await supabase
    .from("species_cards")
    .select(CARD_COLUMNS)
    .eq("stream_id", streamId)
    .maybeSingle();
  return { row: (data as SpeciesCardRow | null) ?? null, namesSupported: false, error: error?.message ?? null };
}

// What /api/species sends: the card, or null when there is none or it can't
// be read (the page simply shows no card).
export async function getPublicSpeciesCard(supabase: Supabase, streamId: StreamId) {
  // Works with or without the names columns (supabase/species_names.sql).
  const { row, error } = await loadSpeciesCardRow(supabase, streamId);
  if (error) {
    console.error("Failed to load species card:", error);
    return { card: null };
  }
  return { card: row ? toSpeciesCardData(row) : null };
}

// The admin form's card plus whether the names columns exist.
export async function getAdminSpeciesCard(
  supabase: Supabase,
  streamId: StreamId,
): Promise<SpeciesResult<{ body: Record<string, unknown> }>> {
  const { row, namesSupported, error } = await loadSpeciesCardRow(supabase, streamId);
  if (error) return { ok: false, status: 500, error };
  return { ok: true, body: { card: row ? toSpeciesCardData(row) : null, namesSupported } };
}

// Saves the text fields + ordered info blocks + names block, creating the
// stream's card if it has none yet (one card per stream: stream_id is unique).
// Images are saved separately (setSpeciesImage).
export async function saveSpeciesCard(
  supabase: Supabase,
  streamId: StreamId,
  body: unknown,
): Promise<SpeciesResult> {
  const parsed = parseSpeciesCardInput(body);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const { names_heading, names, ...rest } = parsed.fields;

  // Until supabase/species_names.sql is run there are no names columns:
  // save everything else, and only refuse if names were actually entered.
  const { namesSupported } = await loadSpeciesCardRow(supabase, streamId);
  if (!namesSupported && names.length > 0) {
    return { ok: false, status: 400, error: NAMES_SQL_HINT, code: "names_unsupported" };
  }

  const { error } = await supabase.from("species_cards").upsert(
    {
      stream_id: streamId,
      ...rest,
      ...(namesSupported ? { names_heading, names } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stream_id" },
  );
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true };
}

async function loadImagePath(supabase: Supabase, streamId: StreamId, column: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from("species_cards")
    .select(column)
    .eq("stream_id", streamId)
    .maybeSingle();
  return (existing as Record<string, string | null> | null)?.[column] ?? null;
}

// Sets the card's photo or range map (creating the card if needed) and
// deletes the file it replaces.
export async function setSpeciesImage(
  supabase: Supabase,
  streamId: StreamId,
  kind: ImageKind,
  file: File,
): Promise<SpeciesResult<{ url: string | null }>> {
  const ext = IMAGE_TYPES[file.type];
  if (!ext) return { ok: false, status: 400, error: "Images must be JPG, PNG, or WebP." };
  if (file.size > IMAGE_MAX_BYTES) {
    return { ok: false, status: 400, error: "That image is over 4MB. Please resize/compress it and try again." };
  }

  const column = IMAGE_KINDS[kind];
  const oldPath = await loadImagePath(supabase, streamId, column);

  // Unique name per upload so the CDN/image optimizer never serves a stale copy.
  // The folder is the stream id, as it always was ('main/...' for the frog
  // stream), so existing files keep their paths.
  const path = `${streamId}/${kind}-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(SPECIES_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { ok: false, status: 500, error: uploadError.message };

  const { error: dbError } = await supabase.from("species_cards").upsert(
    { stream_id: streamId, [column]: path, updated_at: new Date().toISOString() },
    { onConflict: "stream_id" },
  );
  if (dbError) {
    await supabase.storage.from(SPECIES_BUCKET).remove([path]);
    return { ok: false, status: 500, error: dbError.message };
  }

  if (oldPath) await supabase.storage.from(SPECIES_BUCKET).remove([oldPath]);
  return { ok: true, url: publicImageUrl(path) };
}

// Clears the card's photo or range map and deletes the file. No card or no
// picture = fine.
export async function clearSpeciesImage(
  supabase: Supabase,
  streamId: StreamId,
  kind: ImageKind,
): Promise<SpeciesResult> {
  const column = IMAGE_KINDS[kind];
  const oldPath = await loadImagePath(supabase, streamId, column);
  if (!oldPath) return { ok: true };

  const { error } = await supabase
    .from("species_cards")
    .update({ [column]: null, updated_at: new Date().toISOString() })
    .eq("stream_id", streamId);
  if (error) return { ok: false, status: 500, error: error.message };

  await supabase.storage.from(SPECIES_BUCKET).remove([oldPath]);
  return { ok: true };
}
