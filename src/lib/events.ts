import type { createServiceRoleClient } from "@/lib/supabase/server";
import { STREAM_ID, EVENT_BUCKET } from "@/config/constants";
import { publicImageUrl } from "@/lib/species";

type Supabase = ReturnType<typeof createServiceRoleClient>;

export type EventFrogRow = {
  id: string;
  label: string;
  image_path: string | null;
  display_order: number;
};

export type EventRow = {
  id: string;
  stream_id: string;
  prompt: string;
  description: string | null;
  is_on: boolean;
  ends_at: string | null;
  created_at: string;
};

// "Active" = switched on AND the end time (if any) hasn't passed. Compared
// as instants, so it doesn't depend on the viewer's or server's timezone;
// the Eastern-time part is converting what the admin types into that instant.
export function isEventActive(
  event: Pick<EventRow, "is_on" | "ends_at">,
  now: Date = new Date(),
): boolean {
  if (!event.is_on) return false;
  if (!event.ends_at) return true;
  return now.getTime() < new Date(event.ends_at).getTime();
}

export function eventImageUrl(path: string | null): string | null {
  return publicImageUrl(path, EVENT_BUCKET);
}

// The one event visitors can currently see/submit to, or null.
export async function getActiveEvent(
  supabase: Supabase,
  streamId: string = STREAM_ID,
): Promise<{ event: EventRow; frogs: EventFrogRow[] } | null> {
  const { data: events } = await supabase
    .from("suggestion_events")
    .select("id, stream_id, prompt, description, is_on, ends_at, created_at")
    .eq("stream_id", streamId)
    .eq("is_on", true)
    .order("created_at", { ascending: false });

  const event = (events ?? []).find((e) => isEventActive(e));
  if (!event) return null;

  const { data: frogs } = await supabase
    .from("suggestion_event_frogs")
    .select("id, label, image_path, display_order")
    .eq("event_id", event.id)
    .order("display_order", { ascending: true });

  return { event, frogs: frogs ?? [] };
}
