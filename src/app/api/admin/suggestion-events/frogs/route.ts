import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { addFrog, removeFrog } from "@/lib/data/events";
import { resolveStream, streamRefFrom } from "@/lib/data/streams";

// Adding and removing an event's frogs, on the stream named by `stream_id` in
// the body or `?stream=` (the frog stream when neither is given). Another
// stream's event or frog is not found.

const fail = (r: { status: number; error: string; code?: string }) =>
  NextResponse.json(r.code ? { error: r.error, code: r.code } : { error: r.error }, { status: r.status });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const eventId = typeof body?.eventId === "string" ? body.eventId : "";
  if (!eventId) return NextResponse.json({ error: "Missing eventId." }, { status: 400 });

  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request, body));
  if (!found.ok) return fail(found);
  const result = await addFrog(supabase, found.stream.id, eventId);
  if (!result.ok) return fail(result);
  return NextResponse.json({ ok: true, frogId: result.frogId });
}

// Removing a frog would also delete the name ideas sent in for it, so it's
// refused while any exist. Delete them in the review list first if you
// really want the frog gone.
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const frogId = typeof body?.frogId === "string" ? body.frogId : "";
  if (!frogId) return NextResponse.json({ error: "Missing frogId." }, { status: 400 });

  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request, body));
  if (!found.ok) return fail(found);
  const result = await removeFrog(supabase, found.stream.id, frogId);
  if (!result.ok) return fail(result);
  return NextResponse.json({ ok: true });
}
