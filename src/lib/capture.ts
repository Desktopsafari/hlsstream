import { createHmac, randomBytes } from "node:crypto";
import type { createServiceRoleClient } from "@/lib/supabase/server";
import { STREAM_ID } from "@/config/constants";
import {
  ADMIN_CLIP_SECONDS,
  ADMIN_TTL_MS,
  HOUR_MS,
  LIMITS,
  VISITOR_CLIP_SECONDS,
  VISITOR_STORAGE_BUDGET_BYTES,
  VISITOR_TTL_MS,
  parseExternalVideoUrl,
  resolveDelay,
  type DelaySource,
  type ExternalEmbed,
} from "@/lib/captureShared";

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
// count). Returns null when the visitor may go ahead.
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

// ---- making a capture -----------------------------------------------------------------

export type CaptureRequest = {
  kind: "photo" | "clip";
  seconds: number;
  reportedDelay: unknown;
  createdBy: "admin" | "visitor";
  ip?: string;
};

export type PublicCapture = {
  id: string;
  kind: "photo" | "clip";
  seconds: number;
  url: string | null;
  downloadUrl: string | null;
  thumbUrl: string | null;
  expiresAt: string | null;
  delaySource: DelaySource;
  clamped: boolean;
};

// Validates the length for who is asking: visitors 15 or 30 s, the admin up
// to 60. Photos have no length.
export function parseCaptureInput(body: unknown, createdBy: "admin" | "visitor"): { kind: "photo" | "clip"; seconds: number; reportedDelay: unknown } | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Invalid request.";
  const b = body as Record<string, unknown>;
  if (b.kind !== "photo" && b.kind !== "clip") return "Pick a photo or a clip.";
  if (b.kind === "photo") return { kind: "photo", seconds: 0, reportedDelay: b.behind_live_seconds };
  const allowed = createdBy === "admin" ? ADMIN_CLIP_SECONDS : VISITOR_CLIP_SECONDS;
  if (typeof b.seconds !== "number" || !allowed.includes(b.seconds)) {
    return `Clips can be ${allowed.slice(0, -1).join(", ")} or ${allowed[allowed.length - 1]} seconds long.`;
  }
  return { kind: "clip", seconds: b.seconds, reportedDelay: b.behind_live_seconds };
}

export async function createCapture(
  supabase: Supabase,
  input: CaptureRequest,
  now: Date = new Date(),
): Promise<{ status: number; body: { capture: PublicCapture } | { error: string } }> {
  const config = captureConfig();
  if (!config) return { status: 503, body: { error: MESSAGES.unavailable } };

  let hash: string | null = null;
  if (input.createdBy === "visitor") {
    if (await isCapturesPaused(supabase)) return { status: 403, body: { error: MESSAGES.paused } };
    hash = requesterHash(input.ip ?? "unknown", config.secret);
    const refused = await checkVisitorLimits(supabase, hash, input.kind, now);
    if (refused) return { status: refused.status, body: { error: refused.error } };
  }

  const { delay, source } = resolveDelay(input.reportedDelay, input.seconds);
  const id = newCaptureId();
  const fileName = `${id}.${input.kind === "clip" ? "mp4" : "jpg"}`;
  const thumbName = `${id}-t.jpg`;

  // The row goes in first (pending, with the file names), so the attempt
  // counts toward the limits and cleanup can always find the files, even if
  // the reply from the VPS is lost.
  const inserted = await supabase.from("captures").insert({
    id,
    stream_id: STREAM_ID,
    kind: input.kind,
    created_by: input.createdBy,
    requester_hash: hash,
    seconds: input.seconds,
    bytes: 0,
    file_name: fileName,
    thumb_name: thumbName,
    status: "pending",
    expires_at: new Date(now.getTime() + (input.createdBy === "visitor" ? VISITOR_TTL_MS : ADMIN_TTL_MS)).toISOString(),
    featured: false,
    kept: false,
    created_at: now.toISOString(),
  });
  if (inserted.error) {
    return { status: 503, body: { error: isMissingCaptureTable(inserted.error) ? MESSAGES.unavailable : MESSAGES.failed } };
  }

  const reply = await callService(config, "POST", "/capture", {
    stream: STREAM_ID,
    kind: input.kind,
    seconds: input.seconds,
    behind_live_seconds: delay,
    id,
  });

  if (!reply.ok) {
    await supabase.from("captures").update({ status: "failed" }).eq("id", id);
    const code = reply.data.error;
    if (reply.status === 409) return { status: 409, body: { error: code === "offline" ? MESSAGES.offline : MESSAGES.warmingUp } };
    if (reply.status === 507) return { status: 507, body: { error: MESSAGES.full } };
    if (reply.status === 503) return { status: 503, body: { error: MESSAGES.busy } };
    if (reply.status === 0) return { status: 502, body: { error: MESSAGES.down } };
    console.error("Capture service error:", reply.status, code);
    return { status: 502, body: { error: MESSAGES.failed } };
  }

  // Expiry runs from when the file exists, not from when it was asked for.
  const doneAt = new Date();
  const expiresAt = new Date(doneAt.getTime() + (input.createdBy === "visitor" ? VISITOR_TTL_MS : ADMIN_TTL_MS)).toISOString();
  const bytes = Number(reply.data.bytes) || 0;
  const seconds = input.kind === "clip" ? Number(reply.data.seconds) || input.seconds : 0;
  await supabase.from("captures").update({ status: "ready", bytes, seconds, expires_at: expiresAt }).eq("id", id);

  return {
    status: 200,
    body: {
      capture: {
        id,
        kind: input.kind,
        seconds,
        ...mediaUrls(config, fileName),
        thumbUrl: thumbUrl(config, thumbName),
        expiresAt,
        delaySource: source,
        clamped: source === "clamped" || reply.data.clamped === true,
      },
    },
  };
}

// ---- cleanup -----------------------------------------------------------------------

const STUCK_PENDING_MS = 15 * 60 * 1000;
const FAILED_GRACE_MS = HOUR_MS;
const CLEANUP_BATCH = 200;

// Hourly (VPS cron -> /api/cron/cleanup-captures). Expired captures that
// aren't featured or kept: files deleted on the VPS, then the rows. Featured
// items with an external link: only the VPS video goes (the gallery embeds
// the link; the small thumbnail stays). Failed and stuck attempts are
// cleared the same way. If the VPS is down nothing is removed from the
// table, so the next run tries again.
export async function cleanupCaptures(supabase: Supabase, now: Date = new Date()) {
  const config = captureConfig();
  if (!config) return { ok: false, message: "Captures not configured.", deleted: 0, mediaRemoved: 0, vpsDown: false };

  const nowIso = now.toISOString();
  const [expired, failed, stuck] = await Promise.all([
    supabase.from("captures").select(CAPTURE_COLUMNS).lt("expires_at", nowIso).eq("kept", false).limit(CLEANUP_BATCH),
    supabase.from("captures").select(CAPTURE_COLUMNS).eq("status", "failed").lt("created_at", new Date(now.getTime() - FAILED_GRACE_MS).toISOString()).limit(CLEANUP_BATCH),
    supabase.from("captures").select(CAPTURE_COLUMNS).eq("status", "pending").lt("created_at", new Date(now.getTime() - STUCK_PENDING_MS).toISOString()).limit(CLEANUP_BATCH),
  ]);
  const firstError = [expired.error, failed.error, stuck.error].find(Boolean);
  if (firstError) {
    return { ok: false, message: isMissingCaptureTable(firstError) ? "Captures table not set up." : firstError.message, deleted: 0, mediaRemoved: 0, vpsDown: false };
  }

  const remove = new Map<string, CaptureRow>();
  const stripMedia: CaptureRow[] = [];
  for (const r of (expired.data ?? []) as CaptureRow[]) {
    if (!r.featured) remove.set(r.id, r);
    else if (r.external_url && r.file_name) stripMedia.push(r);
  }
  for (const r of [...((failed.data ?? []) as CaptureRow[]), ...((stuck.data ?? []) as CaptureRow[])]) {
    if (!r.featured && !r.kept) remove.set(r.id, r);
  }

  const names = [
    ...[...remove.values()].flatMap((r) => [r.file_name, r.thumb_name]),
    ...stripMedia.map((r) => r.file_name),
  ].filter((n): n is string => !!n);

  if (names.length === 0) return { ok: true, deleted: 0, mediaRemoved: 0, vpsDown: false };
  if (!(await deleteFromService(config, names))) {
    console.error(`Capture cleanup: VPS didn't answer; ${remove.size + stripMedia.length} left for the next run.`);
    return { ok: false, message: "Capture server not reachable; will retry next run.", deleted: 0, mediaRemoved: 0, vpsDown: true };
  }

  if (remove.size > 0) await supabase.from("captures").delete().in("id", [...remove.keys()]);
  for (const r of stripMedia) {
    await supabase.from("captures").update({ file_name: null, bytes: 0, expires_at: null }).eq("id", r.id);
  }
  return { ok: true, deleted: remove.size, mediaRemoved: stripMedia.length, vpsDown: false };
}

// ---- gallery -----------------------------------------------------------------------

export type GalleryItem = {
  id: string;
  kind: "photo" | "clip";
  seconds: number;
  url: string | null;
  downloadUrl: string | null;
  thumbUrl: string | null;
  embed: ExternalEmbed | null;
  featuredAt: string | null;
};

export const GALLERY_LIMIT = 60;

// Featured captures, newest featured first. Only what the page shows: no
// hashes, no expiry, nothing about who made it.
export async function loadGallery(supabase: Supabase): Promise<GalleryItem[]> {
  const config = captureConfig();
  if (!config) return [];
  const { data, error } = await supabase
    .from("captures")
    .select("id, kind, seconds, file_name, thumb_name, featured_at, external_url, status")
    .eq("featured", true)
    .eq("status", "ready")
    .order("featured_at", { ascending: false })
    .limit(GALLERY_LIMIT);
  if (error) return [];
  return ((data ?? []) as CaptureRow[])
    .map((r) => {
      const embed = r.external_url ? parseExternalVideoUrl(r.external_url) : null;
      return {
        id: r.id,
        kind: r.kind,
        seconds: r.seconds,
        ...(embed ? { url: null, downloadUrl: null } : mediaUrls(config, r.file_name)),
        thumbUrl: thumbUrl(config, r.thumb_name),
        embed,
        featuredAt: r.featured_at,
      };
    })
    .filter((i) => i.embed || i.url);
}
