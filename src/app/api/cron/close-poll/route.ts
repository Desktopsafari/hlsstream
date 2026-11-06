import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { runClosePollJob } from "@/lib/data/polls";

// Triggered daily by Vercel Cron at a fixed UTC time approximating 8pm
// Eastern -- see vercel.json for the schedule and the DST note there.
// The job itself lives in src/lib/data/polls/cron.ts.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { status, body } = await runClosePollJob(createServiceRoleClient());
  return NextResponse.json(body, { status });
}
