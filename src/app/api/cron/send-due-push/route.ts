import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { runDuePush } from "@/lib/push";

// Pinged every minute by a cron entry on the VPS (not Vercel Cron), with
// `Authorization: Bearer <PUSH_CRON_SECRET>` -- its own secret, separate from
// CRON_SECRET. Sends whatever timed push is due (scheduled and repeating
// notifications; see runDuePush). Kept generic so other timed sends can share
// it later. When nothing is due it's a single small query.
export async function GET(request: Request) {
  const secret = process.env.PUSH_CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runDuePush(createServiceRoleClient());
  return NextResponse.json(result);
}
