import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createCapture, deleteCapture, loadCaptureOverview, parseCaptureInput, updateCapture } from "@/lib/data/captures";
import { resolveStream, streamRefFrom, type StreamLookup } from "@/lib/data/streams";

// The admin Captures tab (behind the admin login, see proxy.ts): the list
// with usage and disk, capturing (no limits, clips up to 60 s), Feature /
// Keep and Delete.
//
// Every handler works on one stream: `stream_id` in the body or `?stream=`
// (slug or id), the frog stream when neither is given (the tab sends none
// yet). An unknown stream is 404, and a capture that belongs to another
// stream is "not found". The pause switch (./pause) stays site-wide.

const refused = (found: Extract<StreamLookup, { ok: false }>) =>
  NextResponse.json({ error: found.error }, { status: found.status });

export async function GET(request: Request) {
  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request));
  if (!found.ok) return refused(found);
  return NextResponse.json(await loadCaptureOverview(supabase, found.stream.id));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const input = parseCaptureInput(body, "admin");
  if (typeof input === "string") return NextResponse.json({ error: input }, { status: 400 });
  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request, body));
  if (!found.ok) return refused(found);
  const result = await createCapture(supabase, found.stream, { ...input, createdBy: "admin" });
  return NextResponse.json(result.body, { status: result.status });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request, body));
  if (!found.ok) return refused(found);
  const result = await updateCapture(supabase, found.stream.id, body);
  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request, body));
  if (!found.ok) return refused(found);
  const result = await deleteCapture(supabase, found.stream.id, body);
  return NextResponse.json(result.body, { status: result.status });
}
