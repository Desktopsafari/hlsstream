import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getVisibleAnnouncements } from "@/lib/data/announcements";
import { resolveStream } from "@/lib/data/streams";

// The announcement cards visitors can see right now on one stream's page:
// ?stream= is the stream's slug ('frogs') or id ('main'); without it, the frog
// stream (what the site has always shown). That stream's own plus the
// site-wide ones, switched on and inside their start/end window, at most 3.
// Checked against the clock on every request -- no cron job is involved. An
// empty list if the table doesn't exist yet.
export async function GET(request: Request) {
  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, new URL(request.url).searchParams.get("stream"));
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });
  const announcements = await getVisibleAnnouncements(supabase, found.stream.id);
  return NextResponse.json({ announcements, serverTime: new Date().toISOString() });
}
