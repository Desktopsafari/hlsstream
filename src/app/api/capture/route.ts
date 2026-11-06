import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/ip";
import { captureConfig, capturesTableReady, createCapture, isCapturesPaused, parseCaptureInput } from "@/lib/data/captures";
import { resolveStream, streamRefFrom } from "@/lib/data/streams";

// Both handlers work on one stream: `?stream=` (slug or id) or `stream_id` in
// the POST body; the frog stream when neither is given (what the capture
// buttons send today). An unknown stream is 404.

// Whether the capture buttons show at all: only once the env vars are set,
// supabase/captures.sql has been run and the stream has captures (a
// capture_key and switched on); until then visitors see nothing. Cached
// briefly at the edge so every page view isn't a database query.
export async function GET(request: Request) {
  const headers = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" };
  if (!captureConfig()) return NextResponse.json({ enabled: false }, { headers });
  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request));
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });
  if (!found.stream.is_active || !found.stream.capture_key) return NextResponse.json({ enabled: false }, { headers });
  if (!(await capturesTableReady(supabase))) return NextResponse.json({ enabled: false }, { headers });
  return NextResponse.json({ enabled: true, paused: await isCapturesPaused(supabase) }, { headers });
}

// A visitor's clip (or server photo, when the browser couldn't take one).
// Body: { kind, seconds, behind_live_seconds }. The limits, pause switch,
// storage budget and "is it live" check all happen in createCapture.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const input = parseCaptureInput(body, "visitor");
  if (typeof input === "string") return NextResponse.json({ error: input }, { status: 400 });
  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request, body));
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });
  const result = await createCapture(supabase, found.stream, { ...input, createdBy: "visitor", ip: getClientIp(request) });
  return NextResponse.json(result.body, { status: result.status });
}
