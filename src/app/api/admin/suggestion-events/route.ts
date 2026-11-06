import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createEvent, listAdminEvents, updateEvent } from "@/lib/data/events";
import { resolveStream, streamRefFrom } from "@/lib/data/streams";

// Every handler works on one stream: `stream_id` in the body or `?stream=` in
// the URL (slug or id), the frog stream when neither is given. An unknown
// stream is refused, and an event id from another stream is "Event not found."

const fail = (r: { status: number; error: string }) => NextResponse.json({ error: r.error }, { status: r.status });

export async function GET(request: Request) {
  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request));
  if (!found.ok) return fail(found);
  const result = await listAdminEvents(supabase, found.stream.id);
  if (!result.ok) return fail(result);
  return NextResponse.json(result.body);
}

// Creates an event (switched off) with two starter frogs.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request, body));
  if (!found.ok) return fail(found);
  const result = await createEvent(supabase, found.stream.id, body);
  if (!result.ok) return fail(result);
  return NextResponse.json({ ok: true, eventId: result.eventId });
}

// Saves the event's text, switch, end time, and the frogs' labels/order.
// Frog pictures and adding/removing frogs have their own routes.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request, body));
  if (!found.ok) return fail(found);
  const result = await updateEvent(supabase, found.stream.id, body);
  if (!result.ok) return fail(result);
  return NextResponse.json({ ok: true });
}
