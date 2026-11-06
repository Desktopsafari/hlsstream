import { publicImageUrl } from "@/lib/publicImageUrl";

// The "Meet the Resident" species card: shapes, choices and validation. No
// queries and no server-only imports, so the public card and the admin form
// (client components) import their types and choice lists from this file
// directly. The queries are in ./card.ts.

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

// ---- what the admin saves -----------------------------------------------------

const MAX_BLOCKS = 12;

export type SpeciesCardFields = {
  species_name: string;
  scientific_name: string | null;
  conservation_status: ConservationStatus | null;
  info_blocks: InfoBlock[];
  names_heading: string;
  names: string[];
};

// Validates the admin's text fields, ordered info blocks and names block.
export function parseSpeciesCardInput(body: unknown): { ok: true; fields: SpeciesCardFields } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const speciesName = typeof b.speciesName === "string" ? b.speciesName.trim() : "";
  const scientificName =
    typeof b.scientificName === "string" && b.scientificName.trim() ? b.scientificName.trim() : null;
  const status = b.conservationStatus || null;

  if (speciesName.length === 0 || speciesName.length > 80) {
    return { ok: false, error: "Species name is required (80 characters max)." };
  }
  if (scientificName && scientificName.length > 100) {
    return { ok: false, error: "Scientific name is too long." };
  }
  if (status && !CONSERVATION_STATUSES.some((s) => s.value === status)) {
    return { ok: false, error: "Invalid conservation status." };
  }

  const rawBlocks: unknown = b.infoBlocks ?? [];
  if (!Array.isArray(rawBlocks)) return { ok: false, error: "infoBlocks must be a list." };
  const infoBlocks: InfoBlock[] = rawBlocks
    .map((x) => ({
      title: typeof x?.title === "string" ? x.title.trim() : "",
      body: typeof x?.body === "string" ? x.body.trim() : "",
    }))
    .filter((x) => x.title || x.body);

  if (infoBlocks.length > MAX_BLOCKS) return { ok: false, error: `Up to ${MAX_BLOCKS} info blocks.` };
  if (infoBlocks.some((x) => x.title.length > 40 || x.body.length > 500)) {
    return { ok: false, error: "Block titles max 40 characters, bodies max 500." };
  }

  const names = parseNames(b.namesHeading, b.names);
  if (!names.ok) return { ok: false, error: names.error };

  return {
    ok: true,
    fields: {
      species_name: speciesName,
      scientific_name: scientificName,
      conservation_status: status as ConservationStatus | null,
      info_blocks: infoBlocks,
      names_heading: names.heading,
      names: names.names,
    },
  };
}

// ---- pictures -----------------------------------------------------------------

// Vercel serverless request bodies max out around 4.5MB, so stay under it.
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const IMAGE_KINDS = {
  photo: "photo_path",
  range: "range_map_path",
} as const;

export type ImageKind = keyof typeof IMAGE_KINDS;

export function parseImageKind(value: unknown): ImageKind | null {
  return value === "photo" || value === "range" ? value : null;
}
