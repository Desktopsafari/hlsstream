// The species card data layer. Every read and write of species_cards (and the
// species-images files it points at) lives in this folder; routes and the
// admin call it through this file and never query that table themselves.
//
// Server-only. (The public card and the admin form are client components and
// import their types and choice lists from ./rules directly, which has no
// server imports.)

export {
  clearSpeciesImage,
  getAdminSpeciesCard,
  getPublicSpeciesCard,
  loadSpeciesCardRow,
  saveSpeciesCard,
  setSpeciesImage,
  type SpeciesResult,
} from "@/lib/data/species/card";
export {
  CONSERVATION_STATUSES,
  NAME_MAX,
  NAMES_HEADING_DEFAULT,
  NAMES_HEADING_MAX,
  NAMES_MAX,
  NAMES_SQL_HINT,
  parseImageKind,
  parseNames,
  parseSpeciesCardInput,
  toSpeciesCardData,
  type ConservationStatus,
  type ImageKind,
  type InfoBlock,
  type SpeciesCardData,
  type SpeciesCardFields,
  type SpeciesCardRow,
} from "@/lib/data/species/rules";
