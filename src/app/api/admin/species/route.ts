import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAdminSpeciesCard, saveSpeciesCard } from "@/lib/data/species";

export async function GET() {
  const result = await getAdminSpeciesCard(createServiceRoleClient());
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.body);
}

// Saves the text fields + ordered info blocks + names block. Images are uploaded
// separately via /api/admin/species/image.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const result = await saveSpeciesCard(createServiceRoleClient(), body);
  if (!result.ok) {
    return NextResponse.json(result.code ? { error: result.error, code: result.code } : { error: result.error }, {
      status: result.status,
    });
  }
  return NextResponse.json({ ok: true });
}
