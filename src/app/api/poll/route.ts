import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getPublicPollPayload } from "@/lib/data/polls";
import { resolveStream } from "@/lib/data/streams";

// The poll card for one stream: ?stream= is the stream's slug ('frogs') or id
// ('main'); without it, the frog stream (what the site has always shown).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, searchParams.get("stream"));
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });

  return NextResponse.json(await getPublicPollPayload(supabase, found.stream, sessionId));
}
