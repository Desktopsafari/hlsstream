import type { createServiceRoleClient } from "@/lib/supabase/server";
import { containsProfanity } from "@/lib/profanity";
import { normalizeName } from "@/lib/nameNormalize";
import type { StreamId } from "@/lib/data/streams";
import {
  EVENT_COLUMNS,
  eventImageUrl,
  isEventActive,
  type EventFrogRow,
  type EventResult,
  type EventRow,
} from "@/lib/data/events/rules";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// The one event visitors can currently see/submit to on this stream, or null.
export async function getActiveEvent(
  supabase: Supabase,
  streamId: StreamId,
): Promise<{ event: EventRow; frogs: EventFrogRow[] } | null> {
  const { data: events } = await supabase
    .from("suggestion_events")
    .select(EVENT_COLUMNS)
    .eq("stream_id", streamId)
    .eq("is_on", true)
    .order("created_at", { ascending: false });

  const event = ((events ?? []) as EventRow[]).find((e) => isEventActive(e));
  if (!event) return null;

  const { data: frogs } = await supabase
    .from("suggestion_event_frogs")
    .select("id, label, image_path, display_order")
    .eq("event_id", event.id)
    .order("display_order", { ascending: true });

  return { event, frogs: (frogs ?? []) as EventFrogRow[] };
}

// What the event card gets from /api/suggestion-event for one stream.
export async function getPublicEventPayload(supabase: Supabase, streamId: StreamId) {
  const active = await getActiveEvent(supabase, streamId);
  if (!active) return { event: null };
  return {
    event: {
      id: active.event.id,
      prompt: active.event.prompt,
      description: active.event.description,
      endsAt: active.event.ends_at,
      frogs: active.frogs.map((f) => ({
        id: f.id,
        label: f.label,
        imageUrl: eventImageUrl(f.image_path),
      })),
    },
  };
}

// Saves a visitor's name idea. Only for the event that is active right now on
// its own stream, and only for one of that event's frogs -- checked here (not
// just when the card rendered) so a stale open tab can't submit after the
// event ends or is switched off. `text` is already cleaned and length-checked.
export async function submitNameSuggestion(
  supabase: Supabase,
  input: { eventId: string; frogId: string; text: string },
): Promise<EventResult> {
  const closed = { ok: false as const, status: 409, error: "Name suggestions aren't open right now.", code: "event_closed" };
  const { data: event } = await supabase
    .from("suggestion_events")
    .select("id, stream_id")
    .eq("id", input.eventId)
    .maybeSingle();
  if (!event) return closed;

  // The stream comes from the event's own row (a foreign key to streams).
  const active = await getActiveEvent(supabase, event.stream_id as StreamId);
  if (!active || active.event.id !== input.eventId) return closed;
  if (!active.frogs.some((f) => f.id === input.frogId)) {
    return { ok: false, status: 400, error: "That frog isn't part of this event." };
  }

  const normalized = normalizeName(input.text);
  if (normalized.length === 0) return { ok: false, status: 400, error: "Please type a name idea first." };

  // The word list matches inside words, so it can catch innocent names.
  // Flag rather than reject; flagged ideas are hidden in admin by default.
  const { error } = await supabase.from("name_suggestions").insert({
    event_id: input.eventId,
    frog_id: input.frogId,
    text: input.text,
    normalized_text: normalized,
    is_flagged: containsProfanity(input.text),
  });
  if (error) {
    console.error("Failed to save name suggestion:", error.message);
    return { ok: false, status: 500, error: "Couldn't save that, please try again." };
  }
  return { ok: true };
}
