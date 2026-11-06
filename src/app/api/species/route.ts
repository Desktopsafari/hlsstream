import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getPublicSpeciesCard } from "@/lib/data/species";
import { resolveStream } from "@/lib/data/streams";

// One stream's species card: ?stream= is the stream's slug ('frogs') or id
// ('main'); without it, the frog stream (what the site has always shown).
// An unknown stream is 404; a stream with no card gets { card: null }.
export async function GET(request: Request) {
  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, new URL(request.url).searchParams.get("stream"));
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });
  return NextResponse.json(await getPublicSpeciesCard(supabase, found.stream.id));
}
