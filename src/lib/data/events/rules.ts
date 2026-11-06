import { EVENT_BUCKET } from "@/config/constants";
import { publicImageUrl } from "@/lib/publicImageUrl";

// Suggestion (naming) events: one active event per stream, with the frogs
// shown on its card and the name ideas visitors send in. Each event belongs to
// one stream (suggestion_events.stream_id, never null); its frogs and name
// ideas belong to it through event_id. This file has no queries.

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

export const EVENT_COLUMNS = "id, stream_id, prompt, description, is_on, ends_at, created_at";

export type EventResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; status: number; error: string; code?: string };

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
