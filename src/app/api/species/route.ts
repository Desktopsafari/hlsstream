import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { loadSpeciesCardRow, toSpeciesCardData } from "@/lib/species";

export async function GET() {
  const supabase = createServiceRoleClient();

  // Works with or without the names columns (supabase/species_names.sql).
  const { row, error } = await loadSpeciesCardRow(supabase);

  if (error) {
    console.error("Failed to load species card:", error);
    return NextResponse.json({ card: null });
  }

  return NextResponse.json({
    card: row ? toSpeciesCardData(row) : null,
  });
}
