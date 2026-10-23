import type { createServiceRoleClient } from "@/lib/supabase/server";
import { SPECIES_BUCKET, STREAM_ID } from "@/config/constants";

export const CONSERVATION_STATUSES = [
  { value: "least_concern", label: "Least Concern" },
  { value: "near_threatened", label: "Near Threatened" },
  { value: "vulnerable", label: "Vulnerable" },
  { value: "endangered", label: "Endangered" },
  { value: "critically_endangered", label: "Critically Endangered" },
] as const;

export type ConservationStatus = (typeof CONSERVATION_STATUSES)[number]["value"];

export type InfoBlock = { title: string; body: string };

// Optional names block: a heading ("Frog names") and one name per line.
// No names = the block isn't shown at all.
export const NAMES_HEADING_DEFAULT = "Frog names";
export const NAMES_HEADING_MAX = 30;
export const NAME_MAX = 40;
export const NAMES_MAX = 12;
export const NAMES_SQL_HINT =
  "The names list needs its database columns first: run supabase/species_names.sql in the Supabase SQL Editor.";

// Shape sent to the browser (public URLs, camelCase).
export type SpeciesCardData = {
  speciesName: string;
  scientificName: string | null;
  conservationStatus: ConservationStatus | null;
  photoUrl: string | null;
  rangeMapUrl: string | null;
  infoBlocks: InfoBlock[];
  namesHeading: string;
  names: string[];
};

export type SpeciesCardRow = {
  species_name: string;
  scientific_name: string | null;
  conservation_status: ConservationStatus | null;
  photo_path: string | null;
  range_map_path: string | null;
  info_blocks: InfoBlock[] | null;
  // Missing until supabase/species_names.sql has been run.
  names_heading?: string | null;
  names?: string[] | null;
};

export function publicImageUrl(
  path: string | null,
  bucket: string = SPECIES_BUCKET,
): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/${bucket}/${path}`;
}

export function toSpeciesCardData(row: SpeciesCardRow): SpeciesCardData {
  return {
    speciesName: row.species_name,
    scientificName: row.scientific_name,
    conservationStatus: row.conservation_status,
    photoUrl: publicImageUrl(row.photo_path),
    rangeMapUrl: publicImageUrl(row.range_map_path),
    infoBlocks: Array.isArray(row.info_blocks) ? row.info_blocks : [],
    namesHeading: row.names_heading?.trim() || NAMES_HEADING_DEFAULT,
    names: Array.isArray(row.names) ? row.names.filter((n) => typeof n === "string" && n.trim()) : [],
  };
}

type Supabase = ReturnType<typeof createServiceRoleClient>;

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
  streamId: string = STREAM_ID,
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

// Validates the admin's names block. The names arrive as the text box's
// contents: one name per line, blank lines ignored, each line trimmed.
export function parseNames(
  heading: unknown,
  namesText: unknown,
): { ok: true; heading: string; names: string[] } | { ok: false; error: string } {
  const h = typeof heading === "string" ? heading.replace(/\s+/g, " ").trim() : "";
  if (h.length > NAMES_HEADING_MAX) {
    return { ok: false, error: `The names heading is too long (${NAMES_HEADING_MAX} characters max).` };
  }
  const text = typeof namesText === "string" ? namesText : "";
  const names = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/[\u0000-\u001F\u007F]/g, "").trim())
    .filter(Boolean);
  if (names.length > NAMES_MAX) return { ok: false, error: `Up to ${NAMES_MAX} names.` };
  if (names.some((n) => n.length > NAME_MAX)) {
    return { ok: false, error: `Each name can be up to ${NAME_MAX} characters.` };
  }
  return { ok: true, heading: h || NAMES_HEADING_DEFAULT, names };
}
