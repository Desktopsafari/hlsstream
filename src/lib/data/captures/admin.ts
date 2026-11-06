import type { createServiceRoleClient } from "@/lib/supabase/server";
import type { StreamId } from "@/lib/data/streams";
import {
  CAPTURE_COLUMNS,
  callService,
  captureConfig,
  deleteFromService,
  isCapturesPaused,
  isMissingCaptureTable,
  mediaUrls,
  selectAllPages,
  thumbUrl,
  type CaptureRow,
} from "@/lib/data/captures/core";
import {
  ADMIN_TTL_MS,
  CAPTURES_ENV_HINT,
  CAPTURES_SQL_HINT,
  KEPT_WARNING_BYTES,
  VISITOR_STORAGE_BUDGET_BYTES,
  VISITOR_TTL_MS,
  parseExternalVideoUrl,
} from "@/lib/data/captures/rules";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// What the admin Captures tab shows, and its Feature / Keep / Delete actions.
// The list and every action are limited to one stream: a capture that belongs
// to another stream is "not found". The usage totals, the pause switch and the
// VPS status stay site-wide (the storage budget and the disk are shared).

const LIST_LIMIT = 200;

export async function loadCaptureOverview(supabase: Supabase, streamId: StreamId, now: Date = new Date()) {
  const config = captureConfig();
  const { data, error } = await supabase
    .from("captures")
    .select(CAPTURE_COLUMNS)
    .eq("stream_id", streamId)
    .neq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) return { supported: false, hint: isMissingCaptureTable(error) ? CAPTURES_SQL_HINT : error.message };
  if (!config) return { supported: false, hint: CAPTURES_ENV_HINT };

  const rows = (data ?? []) as CaptureRow[];
  // Usage covers every row on every stream, not just the listed ones: the
  // budget and the disk are shared.
  const all = await selectAllPages<CaptureRow>((from, to) =>
    supabase
      .from("captures")
      .select("bytes, created_by, featured, kept, status, expires_at")
      .neq("status", "failed")
      .order("id", { ascending: true })
      .range(from, to),
  );
  const nowIso = now.toISOString();
  let visitorBytes = 0;
  let keptBytes = 0;
  let totalBytes = 0;
  for (const r of all.rows) {
    totalBytes += Number(r.bytes || 0);
    if (r.featured || r.kept) keptBytes += Number(r.bytes || 0);
    else if (r.created_by === "visitor" && r.status === "ready" && r.expires_at && r.expires_at > nowIso) visitorBytes += Number(r.bytes || 0);
  }

  const [paused, status] = await Promise.all([isCapturesPaused(supabase), callService(config, "GET", "/status", undefined, 8_000)]);

  return {
    supported: true,
    paused,
    captures: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      createdBy: r.created_by,
      seconds: r.seconds,
      bytes: Number(r.bytes || 0),
      status: r.status,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      featured: r.featured,
      kept: r.kept,
      externalUrl: r.external_url,
      ...mediaUrls(config, r.file_name),
      thumbUrl: thumbUrl(config, r.thumb_name),
    })),
    usage: {
      totalBytes,
      visitorBytes,
      visitorBudgetBytes: VISITOR_STORAGE_BUDGET_BYTES,
      keptBytes,
      keptWarningBytes: KEPT_WARNING_BYTES,
      keptWarning: keptBytes > KEPT_WARNING_BYTES,
      listCapped: rows.length >= LIST_LIMIT,
    },
    // Null when the VPS didn't answer: the tab says so, nothing else breaks.
    server: status.ok ? status.data : null,
  };
}

type ActionResult = { status: number; body: Record<string, unknown> };

const ttlFor = (r: Pick<CaptureRow, "created_by">) => (r.created_by === "visitor" ? VISITOR_TTL_MS : ADMIN_TTL_MS);

async function loadRow(supabase: Supabase, streamId: StreamId, id: unknown): Promise<CaptureRow | ActionResult> {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(id)) return { status: 400, body: { error: "Missing capture." } };
  const { data, error } = await supabase
    .from("captures")
    .select(CAPTURE_COLUMNS)
    .eq("id", id)
    .eq("stream_id", streamId)
    .maybeSingle();
  if (error) return { status: 500, body: { error: error.message } };
  if (!data) return { status: 404, body: { error: "That capture no longer exists." } };
  return data as CaptureRow;
}

// Feature (optionally with a YouTube / TikTok / Instagram link), Unfeature,
// Keep, Unkeep. Featuring or keeping clears the requester hash: the item is
// then the site's, and the hash was only ever for the rate limits.
export async function updateCapture(supabase: Supabase, streamId: StreamId, body: unknown, now: Date = new Date()): Promise<ActionResult> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const row = await loadRow(supabase, streamId, b.id);
  if ("status" in row && "body" in row) return row;
  const r = row as CaptureRow;
  if (r.status !== "ready") return { status: 409, body: { error: "That capture isn't ready." } };
  const nowIso = now.toISOString();
  const later = new Date(now.getTime() + ttlFor(r)).toISOString();
  let patch: Partial<CaptureRow>;

  switch (b.action) {
    case "feature": {
      let external: string | null = null;
      if (typeof b.externalUrl === "string" && b.externalUrl.trim() !== "") {
        const parsed = parseExternalVideoUrl(b.externalUrl);
        if (!parsed) {
          return { status: 400, body: { error: "Only full YouTube, TikTok or Instagram video links (https) work here." } };
        }
        external = parsed.url;
      }
      if (!external && !r.file_name) return { status: 409, body: { error: "The file for this capture is gone; it can only be featured with a link." } };
      patch = {
        featured: true,
        featured_at: nowIso,
        requester_hash: null,
        external_url: external,
        // Plain Feature keeps the VPS file for good; with a link the file
        // expires as it would have (the gallery embeds the link instead).
        expires_at: r.kept ? null : external ? (r.expires_at ?? later) : null,
      };
      break;
    }
    case "unfeature":
      patch = { featured: false, featured_at: null, external_url: null, expires_at: r.kept ? null : r.file_name ? later : nowIso };
      break;
    case "keep":
      if (!r.file_name) return { status: 409, body: { error: "The file for this capture is gone." } };
      patch = { kept: true, requester_hash: null, expires_at: null };
      break;
    case "unkeep":
      patch = { kept: false, expires_at: r.featured && !r.external_url ? null : later };
      break;
    default:
      return { status: 400, body: { error: "Unknown action." } };
  }

  const { error } = await supabase.from("captures").update(patch).eq("id", r.id).eq("stream_id", streamId);
  if (error) return { status: 500, body: { error: error.message } };
  return { status: 200, body: { ok: true } };
}

// Delete: the VPS files first, then the row. If the VPS is down the row
// stays, so nothing is left on disk without a row pointing at it.
export async function deleteCapture(supabase: Supabase, streamId: StreamId, body: unknown): Promise<ActionResult> {
  const config = captureConfig();
  if (!config) return { status: 503, body: { error: CAPTURES_ENV_HINT } };
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const row = await loadRow(supabase, streamId, b.id);
  if ("status" in row && "body" in row) return row;
  const r = row as CaptureRow;
  const names = [r.file_name, r.thumb_name].filter((n): n is string => !!n);
  if (!(await deleteFromService(config, names))) {
    return { status: 502, body: { error: "Couldn't reach the capture server, so nothing was deleted. Try again in a minute." } };
  }
  const { error } = await supabase.from("captures").delete().eq("id", r.id).eq("stream_id", streamId);
  if (error) return { status: 500, body: { error: error.message } };
  return { status: 200, body: { ok: true } };
}
