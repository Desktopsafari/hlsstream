import { SPECIES_BUCKET } from "@/config/constants";

// The public URL of an object in a public Supabase Storage bucket (species
// photos, poll / announcement / event pictures). Safe in the browser.
export function publicImageUrl(
  path: string | null,
  bucket: string = SPECIES_BUCKET,
): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/${bucket}/${path}`;
}
