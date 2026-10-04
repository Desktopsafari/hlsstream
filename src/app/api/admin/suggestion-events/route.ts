import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { STREAM_ID } from "@/config/constants";
import { eventImageUrl, isEventActive } from "@/lib/events";
import { parseEasternDateTime, toEasternDateTimeInput } from "@/lib/pollSchedule";

const MAX_PROMPT = 120;
const MAX_DESCRIPTION = 300;
const MAX_LABEL = 40;

export async function GET() {
  const supabase = createServiceRoleClient();

  const { data: events, error } = await supabase
    .from("suggestion_events")
    .select("id, stream_id, prompt, description, is_on, ends_at, created_at")
    .eq("stream_id", STREAM_ID)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (events ?? []).map((e) => e.id);
  const none = ["00000000-0000-0000-0000-000000000000"];

  const { data: frogs } = await supabase
    .from("suggestion_event_frogs")
    .select("id, event_id, label, image_path, display_order")
    .in("event_id", ids.length ? ids : none)
    .order("display_order", { ascending: true });

  const counts = new Map<string, number>();
  for (let from = 0; from < 20000; from += 1000) {
    const { data: rows } = await supabase
      .from("name_suggestions")
      .select("frog_id")
      .in("event_id", ids.length ? ids : none)
      .range(from, from + 999);
    for (const r of rows ?? []) counts.set(r.frog_id, (counts.get(r.frog_id) ?? 0) + 1);
    if (!rows || rows.length < 1000) break;
  }

  const now = new Date();
  return NextResponse.json({
    events: (events ?? []).map((e) => ({
      id: e.id,
      prompt: e.prompt,
      description: e.description,
      isOn: e.is_on,
      endsAtLocal: e.ends_at ? toEasternDateTimeInput(new Date(e.ends_at)) : "",
      endsAt: e.ends_at,
      isActive: isEventActive(e, now),
      hasEnded: !!e.ends_at && new Date(e.ends_at).getTime() <= now.getTime(),
      createdAt: e.created_at,
      frogs: (frogs ?? [])
        .filter((f) => f.event_id === e.id)
        .map((f) => ({
          id: f.id,
          label: f.label,
          imageUrl: eventImageUrl(f.image_path),
          suggestionCount: counts.get(f.id) ?? 0,
        })),
    })),
  });
}

function readText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : null;
}

// Creates an event (switched off) with two starter frogs.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const prompt = readText(body?.prompt, MAX_PROMPT);
  const description = readText(body?.description ?? "", MAX_DESCRIPTION);

  if (!prompt) {
    return NextResponse.json(
      { error: `A prompt is required (${MAX_PROMPT} characters max).` },
      { status: 400 },
    );
  }
  if (description === null) {
    return NextResponse.json(
      { error: `The description is too long (${MAX_DESCRIPTION} characters max).` },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();
  const { data: event, error } = await supabase
    .from("suggestion_events")
    .insert({ stream_id: STREAM_ID, prompt, description: description || null })
    .select("id")
    .single();
  if (error || !event) {
    return NextResponse.json({ error: error?.message ?? "Failed to create event." }, { status: 500 });
  }

  const { error: frogError } = await supabase.from("suggestion_event_frogs").insert([
    { event_id: event.id, label: "Frog A", display_order: 0 },
    { event_id: event.id, label: "Frog B", display_order: 1 },
  ]);
  if (frogError) {
    return NextResponse.json({ error: frogError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, eventId: event.id });
}

// Saves the event's text, switch, end time, and the frogs' labels/order.
// Frog pictures and adding/removing frogs have their own routes.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const prompt = readText(body?.prompt, MAX_PROMPT);
  const description = readText(body?.description ?? "", MAX_DESCRIPTION);
  const isOn = body?.isOn === true;
  const endsAtLocal = typeof body?.endsAtLocal === "string" ? body.endsAtLocal.trim() : "";
  const frogsInput: unknown = body?.frogs;

  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  if (!prompt) {
    return NextResponse.json(
      { error: `A prompt is required (${MAX_PROMPT} characters max).` },
      { status: 400 },
    );
  }
  if (description === null) {
    return NextResponse.json(
      { error: `The description is too long (${MAX_DESCRIPTION} characters max).` },
      { status: 400 },
    );
  }

  let endsAt: Date | null = null;
  if (endsAtLocal) {
    endsAt = parseEasternDateTime(endsAtLocal);
    if (!endsAt) {
      return NextResponse.json({ error: "That end date/time isn't valid." }, { status: 400 });
    }
  }

  const frogLabels: { id: string; label: string }[] = [];
  if (frogsInput !== undefined) {
    if (!Array.isArray(frogsInput)) {
      return NextResponse.json({ error: "frogs must be a list." }, { status: 400 });
    }
    for (const f of frogsInput) {
      const label = readText(f?.label, MAX_LABEL);
      if (typeof f?.id !== "string" || !label) {
        return NextResponse.json(
          { error: `Every frog needs a label (${MAX_LABEL} characters max).` },
          { status: 400 },
        );
      }
      frogLabels.push({ id: f.id, label });
    }
  }

  const supabase = createServiceRoleClient();
  const { data: event } = await supabase
    .from("suggestion_events")
    .select("id, stream_id")
    .eq("id", id)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  const { data: existingFrogs } = await supabase
    .from("suggestion_event_frogs")
    .select("id")
    .eq("event_id", id);
  const frogIds = new Set((existingFrogs ?? []).map((f) => f.id));
  if (frogLabels.some((f) => !frogIds.has(f.id))) {
    return NextResponse.json({ error: "One of those frogs isn't part of this event." }, { status: 400 });
  }

  if (isOn) {
    if (frogIds.size === 0) {
      return NextResponse.json({ error: "Add at least one frog before switching this on." }, { status: 400 });
    }
    if (endsAt && endsAt.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "The end time has already passed. Pick a later time (or clear it) to switch this on." },
        { status: 400 },
      );
    }

    // Only one event can be active at a time.
    const { data: others } = await supabase
      .from("suggestion_events")
      .select("id, prompt, is_on, ends_at")
      .eq("stream_id", event.stream_id)
      .eq("is_on", true)
      .neq("id", id);
    const clash = (others ?? []).find((e) => isEventActive(e));
    if (clash) {
      return NextResponse.json(
        {
          error: `"${clash.prompt}" is already on. Switch it off (or wait for it to end) before turning this one on.`,
        },
        { status: 409 },
      );
    }
  }

  const { error } = await supabase
    .from("suggestion_events")
    .update({
      prompt,
      description: description || null,
      is_on: isOn,
      ends_at: endsAt ? endsAt.toISOString() : null,
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  for (let i = 0; i < frogLabels.length; i++) {
    const { error: frogError } = await supabase
      .from("suggestion_event_frogs")
      .update({ label: frogLabels[i].label, display_order: i })
      .eq("id", frogLabels[i].id);
    if (frogError) return NextResponse.json({ error: frogError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
