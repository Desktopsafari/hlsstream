import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { STREAM_ID } from "@/config/constants";

// "Pause all push sending": while paused nothing is sent (now, test, scheduled
// or repeating). Timed sends that come due meanwhile are marked missed once
// their 30-minute window passes, never sent late.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body?.paused !== "boolean") return NextResponse.json({ error: "Missing paused." }, { status: 400 });
  const { error } = await createServiceRoleClient()
    .from("push_settings")
    .upsert({ stream_id: STREAM_ID, paused: body.paused, updated_at: new Date().toISOString() }, { onConflict: "stream_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, paused: body.paused });
}
