import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { setCapturesPaused } from "@/lib/data/captures";

// "Pause visitor captures": visitors can't save clips or server photos while
// paused (photos taken in the browser never reach the server). The admin tab
// can still capture.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body?.paused !== "boolean") return NextResponse.json({ error: "Missing paused." }, { status: 400 });
  const { error } = await setCapturesPaused(createServiceRoleClient(), body.paused);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, paused: body.paused });
}
