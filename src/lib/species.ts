import { SPECIES_BUCKET } from "@/config/constants";

export const CONSERVATION_STATUSES = [
  { value: "least_concern", label: "Least Concern" },
  { value: "near_threatened", label: "Near Threatened" },
  { value: "vulnerable", label: "Vulnerable" },
  { value: "endangered", label: "Endangered" },
  { value: "critically_endangered", label: "Critically Endangered" },
] as const;

export type ConservationStatus = (typeof CONSERVATION_STATUSES)[number]["value"];

export type InfoBlock = { title: string; body: string };

// Shape sent to the browser (public URLs, camelCase).
export type SpeciesCardData = {
  speciesName: string;
  scientificName: string | null;
  conservationStatus: ConservationStatus | null;
  photoUrl: string | null;
  rangeMapUrl: string | null;
  infoBlocks: InfoBlock[];
};

export type SpeciesCardRow = {
  species_name: string;
  scientific_name: string | null;
  conservation_status: ConservationStatus | null;
  photo_path: string | null;
  range_map_path: string | null;
  info_blocks: InfoBlock[] | null;
};

export function publicImageUrl(path: string | null): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/${SPECIES_BUCKET}/${path}`;
}

export function toSpeciesCardData(row: SpeciesCardRow): SpeciesCardData {
  return {
    speciesName: row.species_name,
    scientificName: row.scientific_name,
    conservationStatus: row.conservation_status,
    photoUrl: publicImageUrl(row.photo_path),
    rangeMapUrl: publicImageUrl(row.range_map_path),
    infoBlocks: Array.isArray(row.info_blocks) ? row.info_blocks : [],
  };
}
