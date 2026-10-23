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

// Who lives in the tank (frogs, fish, plants ...). An empty name shows as
// "Name coming soon!".
export type Resident = { label: string; name: string };
export const RESIDENT_LABEL_MAX = 30;
export const RESIDENT_NAME_MAX = 40;
export const RESIDENTS_MAX = 12;
export const RESIDENTS_SQL_HINT =
  "The residents list needs its database column first: run supabase/species_residents.sql in the Supabase SQL Editor.";

// Shape sent to the browser (public URLs, camelCase).
export type SpeciesCardData = {
  speciesName: string;
  scientificName: string | null;
  conservationStatus: ConservationStatus | null;
  photoUrl: string | null;
  rangeMapUrl: string | null;
  infoBlocks: InfoBlock[];
  residents: Resident[];
};

export type SpeciesCardRow = {
  species_name: string;
  scientific_name: string | null;
  conservation_status: ConservationStatus | null;
  photo_path: string | null;
  range_map_path: string | null;
  info_blocks: InfoBlock[] | null;
  // Missing until supabase/species_residents.sql has been run.
  residents?: Resident[] | null;
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
    residents: Array.isArray(row.residents)
      ? row.residents
          .filter((r) => r && typeof r.label === "string" && r.label)
          .map((r) => ({ label: r.label, name: typeof r.name === "string" ? r.name : "" }))
      : [],
  };
}

type Supabase = ReturnType<typeof createServiceRoleClient>;

const CARD_COLUMNS =
  "species_name, scientific_name, conservation_status, photo_path, range_map_path, info_blocks";

function isMissingResidentsColumn(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "42703" || /residents/i.test(error.message ?? ""));
}

// The stream's species card row. Falls back to the columns that existed
// before the residents list, so the card keeps working until
// supabase/species_residents.sql is run (residentsSupported is then false).
export async function loadSpeciesCardRow(
  supabase: Supabase,
  streamId: string = STREAM_ID,
): Promise<{ row: SpeciesCardRow | null; residentsSupported: boolean; error: string | null }> {
  const withResidents = await supabase
    .from("species_cards")
    .select(`${CARD_COLUMNS}, residents`)
    .eq("stream_id", streamId)
    .maybeSingle();
  if (!withResidents.error) {
    return { row: (withResidents.data as SpeciesCardRow | null) ?? null, residentsSupported: true, error: null };
  }
  if (!isMissingResidentsColumn(withResidents.error)) {
    return { row: null, residentsSupported: false, error: withResidents.error.message };
  }
  const { data, error } = await supabase
    .from("species_cards")
    .select(CARD_COLUMNS)
    .eq("stream_id", streamId)
    .maybeSingle();
  return { row: (data as SpeciesCardRow | null) ?? null, residentsSupported: false, error: error?.message ?? null };
}

// Validates the admin's residents list: rows with neither a label nor a name
// are dropped; every other row needs a label.
export function parseResidents(value: unknown): { ok: true; residents: Resident[] } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, residents: [] };
  if (!Array.isArray(value)) return { ok: false, error: "residents must be a list." };
  const residents = value
    .map((r) => ({
      label: typeof r?.label === "string" ? r.label.replace(/\s+/g, " ").trim() : "",
      name: typeof r?.name === "string" ? r.name.replace(/\s+/g, " ").trim() : "",
    }))
    .filter((r) => r.label || r.name);
  if (residents.length > RESIDENTS_MAX) return { ok: false, error: `Up to ${RESIDENTS_MAX} residents.` };
  if (residents.some((r) => !r.label)) return { ok: false, error: "Every resident needs a label (e.g. Frog 1)." };
  if (residents.some((r) => r.label.length > RESIDENT_LABEL_MAX || r.name.length > RESIDENT_NAME_MAX)) {
    return {
      ok: false,
      error: `Resident labels max ${RESIDENT_LABEL_MAX} characters, names max ${RESIDENT_NAME_MAX}.`,
    };
  }
  return { ok: true, residents };
}
