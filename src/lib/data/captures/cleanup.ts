import type { createServiceRoleClient } from "@/lib/supabase/server";
import { HOUR_MS } from "@/lib/data/captures/rules";
import {
  CAPTURE_COLUMNS,
  captureConfig,
  deleteFromService,
  isMissingCaptureTable,
  type CaptureRow,
} from "@/lib/data/captures/core";

type Supabase = ReturnType<typeof createServiceRoleClient>;

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
