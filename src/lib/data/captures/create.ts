import type { createServiceRoleClient } from "@/lib/supabase/server";
import type { PollStream } from "@/lib/data/streams";
import {
  ADMIN_CLIP_SECONDS,
  ADMIN_TTL_MS,
  VISITOR_CLIP_SECONDS,
  VISITOR_TTL_MS,
  resolveDelay,
  type DelaySource,
} from "@/lib/data/captures/rules";
import {
  MESSAGES,
  callService,
  captureConfig,
  checkVisitorLimits,
  isCapturesPaused,
  isMissingCaptureTable,
  mediaUrls,
  newCaptureId,
  requesterHash,
  thumbUrl,
} from "@/lib/data/captures/core";

type Supabase = ReturnType<typeof createServiceRoleClient>;

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

// The capture belongs to the stream asked for: its row carries the stream's
// id, and the capture service is asked for that stream's capture_key (the
// rewind buffer capture-buffer@<key>; the frog stream's key is 'main'). A
// stream with no capture_key, or switched off, is refused before anything is
// counted or stored.
//
// The pause switch, the per-visitor limits, the site-wide hourly limits and
// the storage budget are all site-wide on purpose: they protect the one VPS
// every stream shares, so they count captures on every stream.
export async function createCapture(
  supabase: Supabase,
  stream: PollStream,
  input: CaptureRequest,
  now: Date = new Date(),
): Promise<{ status: number; body: { capture: PublicCapture } | { error: string } }> {
  if (!stream.is_active || !stream.capture_key) return { status: 409, body: { error: MESSAGES.notOnStream } };
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
    stream_id: stream.id,
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
    stream: stream.capture_key,
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
