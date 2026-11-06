import type { createServiceRoleClient } from "@/lib/supabase/server";
import { STREAM_ID } from "@/config/constants";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// A stream id that has been checked against the streams table. Only the
// functions below produce one, so a data-layer function that takes a StreamId
// can't be handed an unchecked string by mistake.
export type StreamId = string & { readonly __brand: "StreamId" };

export type PollStream = { id: StreamId; slug: string; polls_enabled: boolean };

// The stream a request means when it names none: the frog stream (id 'main',
// slug 'frogs'). Only used to fill in a missing ?stream= while the site has
// one stream page; nothing below assumes it is the only stream.
export const DEFAULT_STREAM_ID = STREAM_ID;

// A stream id or slug as it may appear in a request.
const STREAM_REF_RE = /^[A-Za-z0-9_-]{1,64}$/;

const COLS = "id, slug, polls_enabled";

function toStream(row: { id: string; slug: string; polls_enabled: boolean | null } | null): PollStream | null {
  if (!row) return null;
  return { id: row.id as StreamId, slug: row.slug, polls_enabled: row.polls_enabled !== false };
}

// Looks a stream up by slug ('frogs') or id ('main'). A slug wins if a value
// happens to be both.
export async function findStream(
  supabase: Supabase,
  ref: string,
): Promise<{ ok: true; stream: PollStream | null } | { ok: false; error: string }> {
  const bySlug = await supabase.from("streams").select(COLS).eq("slug", ref).maybeSingle();
  if (bySlug.error) return { ok: false, error: bySlug.error.message };
  if (bySlug.data) return { ok: true, stream: toStream(bySlug.data) };
  const byId = await supabase.from("streams").select(COLS).eq("id", ref).maybeSingle();
  if (byId.error) return { ok: false, error: byId.error.message };
  return { ok: true, stream: toStream(byId.data) };
}

export type StreamLookup = { ok: true; stream: PollStream } | { ok: false; status: number; error: string };

// The stream a request names (slug or id), or the default stream when it names
// none. An unknown or malformed stream is refused, never silently swapped for
// the default.
export async function resolveStream(supabase: Supabase, ref: string | null | undefined): Promise<StreamLookup> {
  const value = ref === undefined || ref === null || ref === "" ? DEFAULT_STREAM_ID : ref;
  if (!STREAM_REF_RE.test(value)) return { ok: false, status: 400, error: "Unknown stream." };
  const found = await findStream(supabase, value);
  if (!found.ok) {
    console.error("Stream lookup failed:", found.error);
    return { ok: false, status: 500, error: "Couldn't look up the stream." };
  }
  if (!found.stream) return { ok: false, status: 404, error: "Unknown stream." };
  return { ok: true, stream: found.stream };
}

// The stream named by an admin request: `stream_id` in the JSON or form body,
// or `?stream_id=` / `?stream=` in the URL. Missing = the default stream (the
// admin panel doesn't send one yet).
export function streamRefFrom(request: Request, body?: unknown): string | null {
  if (body instanceof FormData) {
    const v = body.get("stream_id");
    if (typeof v === "string" && v) return v;
  } else if (body && typeof body === "object") {
    const v = (body as { stream_id?: unknown }).stream_id;
    if (typeof v === "string" && v) return v;
  }
  const params = new URL(request.url).searchParams;
  return params.get("stream_id") || params.get("stream") || null;
}

// Every stream with polls turned on, in display order -- what the daily poll
// jobs work through. Null if the streams table can't be read.
export async function listPollStreams(supabase: Supabase): Promise<PollStream[] | null> {
  const { data, error } = await supabase
    .from("streams")
    .select(COLS)
    .eq("polls_enabled", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("Stream list failed:", error.message);
    return null;
  }
  return ((data ?? []) as { id: string; slug: string; polls_enabled: boolean }[])
    .map((r) => toStream(r))
    .filter((s): s is PollStream => s !== null);
}
