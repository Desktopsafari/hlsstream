import { createHmac, randomBytes } from "node:crypto";
import type { createServiceRoleClient } from "@/lib/supabase/server";
import {
  HOUR_MS,
  LIMITS,
  VISITOR_STORAGE_BUDGET_BYTES,
} from "@/lib/data/captures/rules";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// Server side of Capture. The files live on the VPS (vps/capture/); this
// keeps one row per capture in Supabase, applies the limits, and talks to the
// capture service with the shared secret. Visitor photos are normally taken
// in the browser (src/lib/browserPhoto.ts) and never get here; this path is
// their fallback, and how the admin takes photos.

export const PAUSE_SETTING_KEY = "captures_paused";
export const CAPTURE_COLUMNS =
  "id, stream_id, kind, created_by, requester_hash, seconds, bytes, file_name, thumb_name, status, expires_at, featured, featured_at, kept, external_url, created_at";

export type CaptureRow = {
  id: string;
  stream_id: string;
  kind: "photo" | "clip";
  created_by: "admin" | "visitor";
  requester_hash: string | null;
  seconds: number;
  bytes: number;
  file_name: string | null;
  thumb_name: string | null;
  status: "pending" | "ready" | "failed";
  expires_at: string | null;
  featured: boolean;
  featured_at: string | null;
  kept: boolean;
  external_url: string | null;
  created_at: string;
};

export type CaptureConfig = { secret: string; serviceUrl: string; mediaBase: string };

// Null until CAPTURE_SECRET and CAPTURE_SERVICE_URL are both set (e.g.
// https://stream.desktopsafari.com/capture-api). The files are served by
// nginx on the same host under /captures/.
export function captureConfig(): CaptureConfig | null {
  const secret = process.env.CAPTURE_SECRET;
  const serviceUrl = process.env.CAPTURE_SERVICE_URL?.replace(/\/+$/, "");
  if (!secret || !serviceUrl) return null;
  try {
    const u = new URL(serviceUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return { secret, serviceUrl, mediaBase: `${u.origin}/captures` };
  } catch {
    return null;
  }
}

export function isMissingCaptureTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return error.code === "42703" && /captures/.test(error.message ?? "");
}

// An HMAC of the IP, keyed with the capture secret: the same connection gets
// the same value (so the limits work), but the IP can't be read back from it.
export function requesterHash(ip: string, secret: string): string {
  return createHmac("sha256", `capture-requester:${secret}`).update(ip).digest("hex");
}

// 128 random bits, url-safe: the row id and the file name on the VPS.
export function newCaptureId(): string {
  return randomBytes(16).toString("base64url");
}

export function mediaUrls(config: Pick<CaptureConfig, "mediaBase">, name: string | null) {
  if (!name) return { url: null, downloadUrl: null };
  return { url: `${config.mediaBase}/f/${name}`, downloadUrl: `${config.mediaBase}/dl/${name}` };
}

export function thumbUrl(config: Pick<CaptureConfig, "mediaBase">, name: string | null): string | null {
  return name ? `${config.mediaBase}/f/${name}` : null;
}

export async function isCapturesPaused(supabase: Supabase): Promise<boolean> {
  const { data } = await supabase.from("site_settings").select("value").eq("key", PAUSE_SETTING_KEY).maybeSingle();
  return (data as { value: unknown } | null)?.value === true;
}

export async function setCapturesPaused(supabase: Supabase, paused: boolean) {
  return supabase
    .from("site_settings")
    .upsert({ key: PAUSE_SETTING_KEY, value: paused, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

// ---- the capture service -----------------------------------------------------------

export type ServiceReply = { ok: true; status: number; data: Record<string, unknown> } | { ok: false; status: number; data: Record<string, unknown> };

// status 0 = the VPS didn't answer (down, timed out, refused).
export async function callService(
  config: CaptureConfig,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  timeoutMs = 60_000,
): Promise<ServiceReply> {
  try {
    const res = await fetch(`${config.serviceUrl}${path}`, {
      method,
      headers: { "X-Capture-Secret": config.secret, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: {} };
  }
}

export async function deleteFromService(config: CaptureConfig, names: string[]): Promise<boolean> {
  if (names.length === 0) return true;
  const reply = await callService(config, "DELETE", "/files", { names }, 15_000);
  return reply.ok;
}

// ---- messages -----------------------------------------------------------------------

export const MESSAGES = {
  unavailable: "Captures aren't available right now.",
  notOnStream: "Photos and clips can't be saved on this stream.",
  paused: "Captures are paused right now. Please try again later.",
  offline: "The stream is offline right now, so there's nothing to capture.",
  warmingUp: "The stream only just came back. Try again in a minute.",
  full: "Captures are full right now, try again later.",
  busy: "Lots of captures are being made right now. Try again in a few seconds.",
  down: "The capture server isn't responding. Try again in a minute.",
  failed: "Something went wrong saving that. Please try again.",
} as const;

function waitText(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.ceil(s / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
}

type Refusal = { status: number; error: string };

const COUNTED = ["pending", "ready"];

// The visitor limits, counted from the captures table (failed attempts don't
// count). Returns null when the visitor may go ahead. Counted across every
// stream on purpose (no stream filter): a visitor's limits, the site-wide
// hourly limits and the storage budget all protect the one shared VPS.
export async function checkVisitorLimits(
  supabase: Supabase,
  hash: string,
  kind: "photo" | "clip",
  now: Date = new Date(),
): Promise<Refusal | null> {
  const limit = LIMITS[kind];
  const hourAgo = new Date(now.getTime() - HOUR_MS).toISOString();
  const noun = kind === "clip" ? "clip" : "photo";

  const mine = await supabase
    .from("captures")
    .select("created_at")
    .eq("requester_hash", hash)
    .eq("kind", kind)
    .in("status", COUNTED)
    .gt("created_at", hourAgo)
    .order("created_at", { ascending: false });
  if (mine.error) return { status: 503, error: MESSAGES.unavailable };
  const recent = (mine.data ?? []) as { created_at: string }[];
  if (recent.length > 0) {
    const sinceMs = now.getTime() - new Date(recent[0].created_at).getTime();
    if (sinceMs < limit.gapMs) {
      return { status: 429, error: `You just saved a ${noun}. You can save another in ${waitText(limit.gapMs - sinceMs)}.` };
    }
  }
  if (recent.length >= limit.perHour) {
    return { status: 429, error: `You've saved ${limit.perHour} ${noun}s in the last hour, the most allowed. Please try again later.` };
  }

  const site = await supabase
    .from("captures")
    .select("id", { count: "exact", head: true })
    .eq("kind", kind)
    .eq("created_by", "visitor")
    .in("status", COUNTED)
    .gt("created_at", hourAgo);
  if (site.error) return { status: 503, error: MESSAGES.unavailable };
  if ((site.count ?? 0) >= limit.siteWidePerHour) {
    return { status: 429, error: `Lots of people are saving ${noun}s right now. Please try again in a few minutes.` };
  }

  if ((await visitorBudgetUsed(supabase, now)) > VISITOR_STORAGE_BUDGET_BYTES) {
    return { status: 507, error: MESSAGES.full };
  }
  return null;
}

// Supabase returns at most 1000 rows per request, so totals page through.
const PAGE = 1000;
export async function selectAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
): Promise<{ rows: T[]; error: { code?: string; message?: string } | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { rows, error };
    const got = (data ?? []) as T[];
    rows.push(...got);
    if (got.length < PAGE) return { rows, error: null };
  }
}

// Bytes held by unexpired, non-featured, non-kept visitor captures: what the
// 5 GB storage budget counts.
export async function visitorBudgetUsed(supabase: Supabase, now: Date = new Date()): Promise<number> {
  const nowIso = now.toISOString();
  const { rows } = await selectAllPages<{ bytes: number }>((from, to) =>
    supabase
      .from("captures")
      .select("bytes")
      .eq("created_by", "visitor")
      .eq("featured", false)
      .eq("kept", false)
      .eq("status", "ready")
      .gt("expires_at", nowIso)
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows.reduce((sum, r) => sum + Number(r.bytes || 0), 0);
}

// Whether the captures table can be read at all (supabase/captures.sql run).
// One cheap head query: what /api/capture checks before showing the buttons.
export async function capturesTableReady(supabase: Supabase): Promise<boolean> {
  const { error } = await supabase.from("captures").select("id", { count: "exact", head: true }).limit(1);
  return !error;
}
