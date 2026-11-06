import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getPublicSpeciesCard } from "@/lib/data/species";

export async function GET() {
  return NextResponse.json(await getPublicSpeciesCard(createServiceRoleClient()));
}
