import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getVisibleAnnouncements } from "@/lib/announcements";

// The announcement cards visitors can see right now (switched on and inside
// their start/end window, at most 3, newest first). Checked against the clock
// on every request -- no cron job is involved. An empty list if the table
// doesn't exist yet.
export async function GET() {
  const announcements = await getVisibleAnnouncements(createServiceRoleClient());
  return NextResponse.json({ announcements, serverTime: new Date().toISOString() });
}
