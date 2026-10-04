import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { EVENT_BUCKET, EVENT_MAX_FROGS } from "@/config/constants";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const eventId = typeof body?.eventId === "string" ? body.eventId : "";
  if (!eventId) return NextResponse.json({ error: "Missing eventId." }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data: existing } = await supabase
    .from("suggestion_event_frogs")
    .select("id, display_order")
    .eq("event_id", eventId);

  const frogs = existing ?? [];
  if (frogs.length >= EVENT_MAX_FROGS) {
    return NextResponse.json({ error: `An event can have up to ${EVENT_MAX_FROGS} frogs.` }, { status: 400 });
  }

  const nextOrder = frogs.reduce((max, f) => Math.max(max, f.display_order), -1) + 1;
  const label = frogs.length < 26 ? `Frog ${String.fromCharCode(65 + frogs.length)}` : `Frog ${frogs.length + 1}`;

  const { data: frog, error } = await supabase
    .from("suggestion_event_frogs")
    .insert({ event_id: eventId, label, display_order: nextOrder })
    .select("id")
    .single();
  if (error || !frog) {
    return NextResponse.json({ error: error?.message ?? "Failed to add frog." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, frogId: frog.id });
}

// Removing a frog would also delete the name ideas sent in for it, so it's
// refused while any exist. Delete them in the review list first if you
// really want the frog gone.
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const frogId = typeof body?.frogId === "string" ? body.frogId : "";
  if (!frogId) return NextResponse.json({ error: "Missing frogId." }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data: frog } = await supabase
    .from("suggestion_event_frogs")
    .select("id, image_path")
    .eq("id", frogId)
    .maybeSingle();
  if (!frog) return NextResponse.json({ ok: true });

  const { count } = await supabase
    .from("name_suggestions")
    .select("id", { count: "exact", head: true })
    .eq("frog_id", frogId);
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `This frog already has ${count} name idea${count === 1 ? "" : "s"}. Removing it would delete them. Delete them in the review list first if you want it gone.`,
        code: "frog_has_suggestions",
      },
      { status: 409 },
    );
  }

  const { error } = await supabase.from("suggestion_event_frogs").delete().eq("id", frogId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (frog.image_path) {
    await supabase.storage.from(EVENT_BUCKET).remove([frog.image_path]);
  }
  return NextResponse.json({ ok: true });
}
