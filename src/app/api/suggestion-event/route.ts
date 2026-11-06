import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getPublicEventPayload } from "@/lib/data/events";
import { resolveStream } from "@/lib/data/streams";

// The currently active suggestion event on one stream (switched on and not
// past its end time), or { event: null }. ?stream= is the stream's slug
// ('frogs') or id ('main'); without it, the frog stream. Checked against the
// clock on every request -- no cron job is involved in switching an event off.
export async function GET(request: Request) {
  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, new URL(request.url).searchParams.get("stream"));
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });
  const body = await getPublicEventPayload(supabase, found.stream.id);
  return NextResponse.json({ ...body, serverTime: new Date().toISOString() });
}
