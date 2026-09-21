import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { STREAM_ID } from "@/config/constants";
import { toSpeciesCardData, type SpeciesCardRow } from "@/lib/species";

export async function GET() {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("species_cards")
    .select(
      "species_name, scientific_name, conservation_status, photo_path, range_map_path, info_blocks",
    )
    .eq("stream_id", STREAM_ID)
    .maybeSingle();

  if (error) {
    console.error("Failed to load species card:", error.message);
    return NextResponse.json({ card: null });
  }

  return NextResponse.json({
    card: data ? toSpeciesCardData(data as SpeciesCardRow) : null,
  });
}
