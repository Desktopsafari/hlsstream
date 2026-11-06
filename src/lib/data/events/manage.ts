import type { createServiceRoleClient } from "@/lib/supabase/server";
import { parseEasternDateTime, toEasternDateTimeInput } from "@/lib/pollSchedule";
import type { StreamId } from "@/lib/data/streams";
import { EVENT_COLUMNS, eventImageUrl, isEventActive, type EventResult, type EventRow } from "@/lib/data/events/rules";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// The admin's event list, create and edit. Every function takes the stream the
// admin is working on and only reads or changes that stream's events: an
// event id from another stream is "Event not found."

const MAX_PROMPT = 120;
const MAX_DESCRIPTION = 300;
const MAX_LABEL = 40;
const NO_IDS = ["00000000-0000-0000-0000-000000000000"];

export const EVENT_NOT_FOUND = { ok: false as const, status: 404, error: "Event not found." };

// The event, if it exists and belongs to this stream.
export async function findEventInStream(
  supabase: Supabase,
  streamId: StreamId,
  eventId: string,
): Promise<{ id: string; stream_id: string } | null> {
  if (!eventId) return null;
  const { data } = await supabase
    .from("suggestion_events")
    .select("id, stream_id")
    .eq("id", eventId)
    .eq("stream_id", streamId)
    .maybeSingle();
  return data ?? null;
}

function readText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : null;
}

// The stream's latest 50 events, newest first, with their frogs and how many
// name ideas each frog has.
export async function listAdminEvents(
  supabase: Supabase,
  streamId: StreamId,
): Promise<EventResult<{ body: Record<string, unknown> }>> {
  const { data, error } = await supabase
    .from("suggestion_events")
    .select(EVENT_COLUMNS)
    .eq("stream_id", streamId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { ok: false, status: 500, error: error.message };
  const events = (data ?? []) as EventRow[];

  const ids = events.map((e) => e.id);
  const { data: frogs } = await supabase
    .from("suggestion_event_frogs")
    .select("id, event_id, label, image_path, display_order")
    .in("event_id", ids.length ? ids : NO_IDS)
    .order("display_order", { ascending: true });

  const counts = new Map<string, number>();
  for (let from = 0; from < 20000; from += 1000) {
    const { data: rows } = await supabase
      .from("name_suggestions")
      .select("frog_id")
      .in("event_id", ids.length ? ids : NO_IDS)
      .range(from, from + 999);
    for (const r of rows ?? []) counts.set(r.frog_id, (counts.get(r.frog_id) ?? 0) + 1);
    if (!rows || rows.length < 1000) break;
  }

  const now = new Date();
  return {
    ok: true,
    body: {
      events: events.map((e) => ({
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
    },
  };
}

// Creates an event on this stream (switched off) with two starter frogs.
export async function createEvent(
  supabase: Supabase,
  streamId: StreamId,
  body: Record<string, unknown> | null,
): Promise<EventResult<{ eventId: string }>> {
  const prompt = readText(body?.prompt, MAX_PROMPT);
  const description = readText(body?.description ?? "", MAX_DESCRIPTION);
  if (!prompt) return { ok: false, status: 400, error: `A prompt is required (${MAX_PROMPT} characters max).` };
  if (description === null) {
    return { ok: false, status: 400, error: `The description is too long (${MAX_DESCRIPTION} characters max).` };
  }

  const { data: event, error } = await supabase
    .from("suggestion_events")
    .insert({ stream_id: streamId, prompt, description: description || null })
    .select("id")
    .single();
  if (error || !event) return { ok: false, status: 500, error: error?.message ?? "Failed to create event." };

  const { error: frogError } = await supabase.from("suggestion_event_frogs").insert([
    { event_id: event.id, label: "Frog A", display_order: 0 },
    { event_id: event.id, label: "Frog B", display_order: 1 },
  ]);
  if (frogError) return { ok: false, status: 500, error: frogError.message };

  return { ok: true, eventId: event.id };
}

// Saves the event's text, switch, end time, and the frogs' labels/order.
// Frog pictures and adding/removing frogs have their own functions. Only one
// event can be active at a time on a stream; other streams don't count.
export async function updateEvent(
  supabase: Supabase,
  streamId: StreamId,
  body: Record<string, unknown> | null,
): Promise<EventResult> {
  const id = typeof body?.id === "string" ? body.id : "";
  const prompt = readText(body?.prompt, MAX_PROMPT);
  const description = readText(body?.description ?? "", MAX_DESCRIPTION);
  const isOn = body?.isOn === true;
  const endsAtLocal = typeof body?.endsAtLocal === "string" ? body.endsAtLocal.trim() : "";
  const frogsInput: unknown = body?.frogs;

  if (!id) return { ok: false, status: 400, error: "Missing id." };
  if (!prompt) return { ok: false, status: 400, error: `A prompt is required (${MAX_PROMPT} characters max).` };
  if (description === null) {
    return { ok: false, status: 400, error: `The description is too long (${MAX_DESCRIPTION} characters max).` };
  }

  let endsAt: Date | null = null;
  if (endsAtLocal) {
    endsAt = parseEasternDateTime(endsAtLocal);
    if (!endsAt) return { ok: false, status: 400, error: "That end date/time isn't valid." };
  }

  const frogLabels: { id: string; label: string }[] = [];
  if (frogsInput !== undefined) {
    if (!Array.isArray(frogsInput)) return { ok: false, status: 400, error: "frogs must be a list." };
    for (const f of frogsInput) {
      const label = readText(f?.label, MAX_LABEL);
      if (typeof f?.id !== "string" || !label) {
        return { ok: false, status: 400, error: `Every frog needs a label (${MAX_LABEL} characters max).` };
      }
      frogLabels.push({ id: f.id, label });
    }
  }

  const event = await findEventInStream(supabase, streamId, id);
  if (!event) return EVENT_NOT_FOUND;

  const { data: existingFrogs } = await supabase
    .from("suggestion_event_frogs")
    .select("id")
    .eq("event_id", id);
  const frogIds = new Set((existingFrogs ?? []).map((f) => f.id));
  if (frogLabels.some((f) => !frogIds.has(f.id))) {
    return { ok: false, status: 400, error: "One of those frogs isn't part of this event." };
  }

  if (isOn) {
    if (frogIds.size === 0) return { ok: false, status: 400, error: "Add at least one frog before switching this on." };
    if (endsAt && endsAt.getTime() <= Date.now()) {
      return {
        ok: false,
        status: 400,
        error: "The end time has already passed. Pick a later time (or clear it) to switch this on.",
      };
    }

    const { data: others } = await supabase
      .from("suggestion_events")
      .select("id, prompt, is_on, ends_at")
      .eq("stream_id", streamId)
      .eq("is_on", true)
      .neq("id", id);
    const clash = (others ?? []).find((e) => isEventActive(e));
    if (clash) {
      return {
        ok: false,
        status: 409,
        error: `"${clash.prompt}" is already on. Switch it off (or wait for it to end) before turning this one on.`,
      };
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
  if (error) return { ok: false, status: 500, error: error.message };

  for (let i = 0; i < frogLabels.length; i++) {
    const { error: frogError } = await supabase
      .from("suggestion_event_frogs")
      .update({ label: frogLabels[i].label, display_order: i })
      .eq("id", frogLabels[i].id);
    if (frogError) return { ok: false, status: 500, error: frogError.message };
  }

  return { ok: true };
}
