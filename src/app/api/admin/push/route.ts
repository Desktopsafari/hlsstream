import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { loadPushOverview } from "@/lib/pushAdmin";

// Everything the admin Push tab and the Live now strip show: categories with
// subscriber counts, repeating notifications with their status line, pending
// scheduled sends, the last 50 sends, and whether sending is paused.
export async function GET() {
  return NextResponse.json(await loadPushOverview(createServiceRoleClient()));
}
