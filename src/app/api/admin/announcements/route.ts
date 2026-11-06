import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  createAnnouncement,
  deleteAnnouncement,
  listAdminAnnouncements,
  updateAnnouncement,
} from "@/lib/data/announcements";
import { resolveStream, streamRefFrom } from "@/lib/data/streams";

// Every handler works on one stream: `stream_id` in the body or `?stream=` in
// the URL (slug or id), the frog stream when neither is given. It sees and
// changes that stream's announcements and the site-wide ones (stream_id null),
// never another stream's. Create takes `scope`: "site-wide" or "stream"
// (default); edit changes the scope only when `scope` is sent.

const fail = (r: { status: number; error: string; code?: string }) =>
  NextResponse.json(r.code ? { error: r.error, code: r.code } : { error: r.error }, { status: r.status });

export async function GET(request: Request) {
  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request));
  if (!found.ok) return fail(found);
  const result = await listAdminAnnouncements(supabase, found.stream.id);
  if (!result.ok) return fail(result);
  return NextResponse.json(result.body);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request, body));
  if (!found.ok) return fail(found);
  const result = await createAnnouncement(supabase, found.stream.id, body);
  if (!result.ok) return fail(result);
  return NextResponse.json(result.warning ? { ok: true, id: result.id, warning: result.warning } : { ok: true, id: result.id });
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request, body));
  if (!found.ok) return fail(found);
  const result = await updateAnnouncement(supabase, found.stream.id, body);
  if (!result.ok) return fail(result);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request));
  if (!found.ok) return fail(found);
  const result = await deleteAnnouncement(supabase, found.stream.id, id);
  if (!result.ok) return fail(result);
  return NextResponse.json({ ok: true });
}
