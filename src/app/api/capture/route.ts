import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/ip";
import { captureConfig, createCapture, isCapturesPaused, parseCaptureInput } from "@/lib/capture";

// Whether the capture buttons show at all: only once the env vars are set
// and supabase/captures.sql has been run (until then visitors see nothing).
// Cached briefly at the edge so every page view isn't a database query.
export async function GET() {
  const headers = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" };
  if (!captureConfig()) return NextResponse.json({ enabled: false }, { headers });
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("captures").select("id", { count: "exact", head: true }).limit(1);
  if (error) return NextResponse.json({ enabled: false }, { headers });
  return NextResponse.json({ enabled: true, paused: await isCapturesPaused(supabase) }, { headers });
}

// A visitor's clip (or server photo, when the browser couldn't take one).
// Body: { kind, seconds, behind_live_seconds }. The limits, pause switch,
// storage budget and "is it live" check all happen in createCapture.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const input = parseCaptureInput(body, "visitor");
  if (typeof input === "string") return NextResponse.json({ error: input }, { status: 400 });
  const result = await createCapture(createServiceRoleClient(), { ...input, createdBy: "visitor", ip: getClientIp(request) });
  return NextResponse.json(result.body, { status: result.status });
}
