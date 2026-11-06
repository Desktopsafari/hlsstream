import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { cleanupCaptures } from "@/lib/data/captures";

// Pinged hourly by a cron entry on the VPS (not Vercel Cron), with
// `Authorization: Bearer <CAPTURE_CRON_SECRET>` -- its own secret. Deletes
// expired captures (VPS files first, then rows); if the VPS is down nothing
// is removed and the next run tries again.
export async function GET(request: Request) {
  const secret = process.env.CAPTURE_CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await cleanupCaptures(createServiceRoleClient()));
}
