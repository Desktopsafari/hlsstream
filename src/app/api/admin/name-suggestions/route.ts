import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { deleteName, listNameSuggestions, setNameShortlisted } from "@/lib/data/events";
import { resolveStream, streamRefFrom } from "@/lib/data/streams";

// The name-idea review list for one event on the stream named by `stream_id`
// in the body or `?stream=` (the frog stream when neither is given). Another
// stream's event is "Event not found."

const fail = (r: { status: number; error: string }) => NextResponse.json({ error: r.error }, { status: r.status });

// Name ideas for one event, grouped per frog. Duplicates (same normalized
// text) are merged with a count; sorted by count, then newest.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const eventId = params.get("eventId");
  const includeFlagged = params.get("includeFlagged") === "1";
  if (!eventId) return NextResponse.json({ error: "Missing eventId." }, { status: 400 });

  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request));
  if (!found.ok) return fail(found);
  const result = await listNameSuggestions(supabase, found.stream.id, eventId, includeFlagged);
  if (!result.ok) return fail(result);
  return NextResponse.json(result.body);
}

// Shortlist or un-shortlist a name (every merged duplicate at once).
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const { eventId, frogId, key } = body ?? {};
  if (
    typeof eventId !== "string" ||
    typeof frogId !== "string" ||
    typeof key !== "string" ||
    typeof body?.shortlisted !== "boolean"
  ) {
    return NextResponse.json({ error: "Missing eventId, frogId, key, or shortlisted." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request, body));
  if (!found.ok) return fail(found);
  const result = await setNameShortlisted(supabase, found.stream.id, { eventId, frogId, key }, body.shortlisted);
  if (!result.ok) return fail(result);
  return NextResponse.json({ ok: true });
}

// Delete a name (every merged duplicate of it).
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const { eventId, frogId, key } = body ?? {};
  if (typeof eventId !== "string" || typeof frogId !== "string" || typeof key !== "string") {
    return NextResponse.json({ error: "Missing eventId, frogId, or key." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request, body));
  if (!found.ok) return fail(found);
  const result = await deleteName(supabase, found.stream.id, { eventId, frogId, key });
  if (!result.ok) return fail(result);
  return NextResponse.json({ ok: true });
}
