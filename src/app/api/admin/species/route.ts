import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAdminSpeciesCard, saveSpeciesCard } from "@/lib/data/species";
import { resolveStream, streamRefFrom } from "@/lib/data/streams";

// Every handler works on one stream's card: `stream_id` in the body or
// `?stream=` in the URL (slug or id), the frog stream when neither is given.
// An unknown stream is refused (404); no other stream's card is touched.

export async function GET(request: Request) {
  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request));
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });
  const result = await getAdminSpeciesCard(supabase, found.stream.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.body);
}

// Saves the text fields + ordered info blocks + names block. Images are uploaded
// separately via /api/admin/species/image.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request, body));
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });
  const result = await saveSpeciesCard(supabase, found.stream.id, body);
  if (!result.ok) {
    return NextResponse.json(result.code ? { error: result.error, code: result.code } : { error: result.error }, {
      status: result.status,
    });
  }
  return NextResponse.json({ ok: true });
}
