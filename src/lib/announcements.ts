import { randomUUID } from "node:crypto";
import type { createServiceRoleClient } from "@/lib/supabase/server";
import { EVENT_BUCKET, STREAM_ID } from "@/config/constants";
import { checkImageUpload } from "@/lib/imageUpload";
import { publicImageUrl } from "@/lib/species";
import { formatEasternDate, formatEasternDay, parseEasternDateTime, toEasternDateTimeInput } from "@/lib/pollSchedule";
import {
  ANNOUNCEMENT_MAX_VISIBLE,
  announcementHref,
  type AnnouncementButtonKind,
  type PublicAnnouncement,
} from "@/lib/announcementLinks";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// Announcement cards: short notices shown above the suggestion event card.
// Whether one shows is decided from the real clock on every request (switch,
// start, end) -- no cron job turns them on or off. Pictures live in the naming
// events' bucket under announcements/, using the same checks as poll pictures.

export const TITLE_MAX = 80;
export const MESSAGE_MAX = 600;
export const BUTTON_LABEL_MAX = 30;

export const ANNOUNCEMENTS_SQL_HINT =
  "Announcements need their database table first: run supabase/announcements.sql in the Supabase SQL Editor.";

const COLUMNS =
  "id, stream_id, title, message, image_path, button_label, button_kind, button_target, is_on, starts_at, ends_at, created_at";

export type AnnouncementRow = {
  id: string;
  stream_id: string;
  title: string;
  message: string;
  image_path: string | null;
  button_label: string | null;
  button_kind: AnnouncementButtonKind | null;
  button_target: string | null;
  is_on: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
};

// The table hasn't been created yet (supabase/announcements.sql not run).
export function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /announcements/i.test(error.message ?? "") && /does not exist|schema cache/i.test(error.message ?? "");
}

// ---- visibility -------------------------------------------------------------

// Visible = switched on, its start (if any) has come, its end (if any) hasn't.
// Compared as instants, so it doesn't depend on any timezone.
export function isAnnouncementVisible(
  a: Pick<AnnouncementRow, "is_on" | "starts_at" | "ends_at">,
  now: Date = new Date(),
): boolean {
  if (!a.is_on) return false;
  const t = now.getTime();
  if (a.starts_at && t < new Date(a.starts_at).getTime()) return false;
  if (a.ends_at && t >= new Date(a.ends_at).getTime()) return false;
  return true;
}

// Newest first = most recently created first.
function newestFirst<T extends Pick<AnnouncementRow, "created_at">>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

// The cards visitors see: at most ANNOUNCEMENT_MAX_VISIBLE, newest first.
// Any others that are also visible wait until one of these ends or is
// switched off.
export function pickVisible<T extends AnnouncementRow>(rows: T[], now: Date = new Date()): T[] {
  return newestFirst(rows.filter((a) => isAnnouncementVisible(a, now))).slice(0, ANNOUNCEMENT_MAX_VISIBLE);
}

export function announcementImageUrl(path: string | null | undefined): string | null {
  return publicImageUrl(path ?? null, EVENT_BUCKET);
}

export function toPublicAnnouncement(a: AnnouncementRow): PublicAnnouncement {
  const href = a.button_label && a.button_kind ? announcementHref(a.button_kind, a.button_target) : null;
  return {
    id: a.id,
    title: a.title,
    message: a.message,
    imageUrl: announcementImageUrl(a.image_path),
    button: href && a.button_label ? { label: a.button_label, ...href } : null,
    endsAt: a.ends_at,
  };
}

// What the home page shows right now. Any failure (including the table not
// existing yet) means "no announcements", so the page is never broken by it.
export async function getVisibleAnnouncements(
  supabase: Supabase,
  now: Date = new Date(),
  streamId: string = STREAM_ID,
): Promise<PublicAnnouncement[]> {
  try {
    const { data, error } = await supabase
      .from("announcements")
      .select(COLUMNS)
      .eq("stream_id", streamId)
      .eq("is_on", true)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error || !data) return [];
    return pickVisible(data as AnnouncementRow[], now).map(toPublicAnnouncement);
  } catch {
    return [];
  }
}

// ---- admin status line ------------------------------------------------------

function easternWhen(date: Date, now: Date): string {
  const withinWeek = Math.abs(date.getTime() - now.getTime()) < 6 * 24 * 60 * 60 * 1000;
  return `${withinWeek ? formatEasternDay(date, "short") : formatEasternDate(date)} ET`;
}

export type AnnouncementStatus = {
  kind: "showing" | "waiting" | "scheduled" | "ended" | "off";
  text: string;
};

// "Showing now", "Scheduled for Mon 12:00 PM ET", "Ended", "Off" ...
// `shown` is whether it made the 3-card cut (see pickVisible).
export function announcementStatus(
  a: Pick<AnnouncementRow, "is_on" | "starts_at" | "ends_at">,
  shown: boolean,
  now: Date = new Date(),
): AnnouncementStatus {
  const t = now.getTime();
  if (a.ends_at && t >= new Date(a.ends_at).getTime()) return { kind: "ended", text: "Ended" };
  if (!a.is_on) return { kind: "off", text: "Off" };
  if (a.starts_at && t < new Date(a.starts_at).getTime()) {
    return { kind: "scheduled", text: `Scheduled for ${easternWhen(new Date(a.starts_at), now)}` };
  }
  const until = a.ends_at ? ` until ${easternWhen(new Date(a.ends_at), now)}` : "";
  if (!shown) {
    return {
      kind: "waiting",
      text: `On, but waiting: ${ANNOUNCEMENT_MAX_VISIBLE} newer announcements are already showing${until ? ` (runs${until})` : ""}`,
    };
  }
  return { kind: "showing", text: `Showing now${until}` };
}

export function toAdminAnnouncement(a: AnnouncementRow, shownIds: Set<string>, now: Date = new Date()) {
  return {
    id: a.id,
    title: a.title,
    message: a.message,
    imagePath: a.image_path,
    imageUrl: announcementImageUrl(a.image_path),
    button: a.button_label && a.button_kind ? { label: a.button_label, kind: a.button_kind, target: a.button_target ?? "" } : null,
    isOn: a.is_on,
    startsAt: a.starts_at,
    endsAt: a.ends_at,
    startsAtLocal: a.starts_at ? toEasternDateTimeInput(new Date(a.starts_at)) : "",
    endsAtLocal: a.ends_at ? toEasternDateTimeInput(new Date(a.ends_at)) : "",
    createdAt: a.created_at,
    status: announcementStatus(a, shownIds.has(a.id), now),
  };
}

// ---- validating what the admin sends -----------------------------------------

// Plain text only: unify line breaks and drop control characters (except
// line breaks and tabs). HTML is never rendered -- React escapes it -- so
// anything that looks like a tag simply shows as typed.
export function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

export type AnnouncementFields = {
  title: string;
  message: string;
  button_label: string | null;
  button_kind: AnnouncementButtonKind | null;
  button_target: string | null;
  is_on: boolean;
  starts_at: string | null;
  ends_at: string | null;
};

type Parsed = { ok: true; fields: AnnouncementFields } | { ok: false; error: string };

export function parseAnnouncementInput(body: unknown, now: Date = new Date()): Parsed {
  const b = (body ?? {}) as Record<string, unknown>;
  const title = cleanText(b.title).replace(/\s*\n\s*/g, " ");
  const message = cleanText(b.message);
  const isOn = b.isOn === true;

  if (!title || title.length > TITLE_MAX) {
    return { ok: false, error: `A title is required (${TITLE_MAX} characters max).` };
  }
  if (message.length > MESSAGE_MAX) {
    return { ok: false, error: `The message is too long (${MESSAGE_MAX} characters max).` };
  }

  let button_label: string | null = null;
  let button_kind: AnnouncementButtonKind | null = null;
  let button_target: string | null = null;
  const button = b.button as Record<string, unknown> | null | undefined;
  if (button) {
    const label = cleanText(button.label).replace(/\s+/g, " ");
    if (!label || label.length > BUTTON_LABEL_MAX) {
      return { ok: false, error: `The button needs a label (${BUTTON_LABEL_MAX} characters max).` };
    }
    const kind = button.kind;
    if (kind !== "poll" && kind !== "internal" && kind !== "external") {
      return { ok: false, error: "Pick where the button goes." };
    }
    const target = typeof button.target === "string" ? button.target.trim() : "";
    const href = announcementHref(kind, kind === "poll" ? null : target);
    if (!href) {
      return {
        ok: false,
        error:
          kind === "internal"
            ? "Internal pages must be a path on this site that starts with / (for example /contact)."
            : "External links must be a full https:// address (other kinds of links aren't allowed).",
      };
    }
    button_label = label;
    button_kind = kind;
    button_target = kind === "poll" ? null : href.href;
  }

  let starts_at: Date | null = null;
  if (b.startMode === "at") {
    starts_at = parseEasternDateTime(typeof b.startsAtLocal === "string" ? b.startsAtLocal.trim() : "");
    if (!starts_at) return { ok: false, error: "Pick a valid start date and time (Eastern Time)." };
  } else if (b.startMode !== undefined && b.startMode !== "now") {
    return { ok: false, error: "Pick when it starts." };
  }

  let ends_at: Date | null = null;
  if (b.endMode === "at") {
    ends_at = parseEasternDateTime(typeof b.endsAtLocal === "string" ? b.endsAtLocal.trim() : "");
    if (!ends_at) return { ok: false, error: "Pick a valid end date and time (Eastern Time)." };
  } else if (b.endMode !== undefined && b.endMode !== "never") {
    return { ok: false, error: "Pick when it ends." };
  }

  if (starts_at && ends_at && ends_at.getTime() <= starts_at.getTime()) {
    return { ok: false, error: "The end time must be after the start time." };
  }
  if (isOn && ends_at && ends_at.getTime() <= now.getTime()) {
    return {
      ok: false,
      error: "The end time has already passed. Pick a later time (or \"Until I remove it\") to switch this on.",
    };
  }

  return {
    ok: true,
    fields: {
      title,
      message,
      button_label,
      button_kind,
      button_target,
      is_on: isOn,
      starts_at: starts_at ? starts_at.toISOString() : null,
      ends_at: ends_at ? ends_at.toISOString() : null,
    },
  };
}

// ---- pictures -----------------------------------------------------------------

// A picture picked before the announcement is saved waits in
// announcements/pending/ and is moved to announcements/<id>/ on save. Pending
// files that were never used are deleted once a day old (checked whenever the
// admin list loads, so no extra cron job is needed).
const PENDING_PREFIX = "announcements/pending/";
const PENDING_RE = /^announcements\/pending\/[A-Za-z0-9._-]+$/;
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function isPendingPath(value: unknown): value is string {
  return typeof value === "string" && PENDING_RE.test(value);
}

export type ImageFailure = { ok: false; status: number; code?: string; error: string };
export type ImageResult = { ok: true; path: string; url: string | null } | ImageFailure;

// A file is only deleted once no announcement points at it any more. If we
// can't tell, we keep it.
export async function removeFileIfUnreferenced(supabase: Supabase, path: string): Promise<boolean> {
  const { data, error } = await supabase.from("announcements").select("id").eq("image_path", path).limit(1);
  if (error || (data?.length ?? 0) > 0) return false;
  await supabase.storage.from(EVENT_BUCKET).remove([path]);
  return true;
}

async function loadAnnouncement(
  supabase: Supabase,
  id: string,
): Promise<{ row: { id: string; image_path: string | null } } | ImageFailure> {
  const { data, error } = await supabase.from("announcements").select("id, image_path").eq("id", id).maybeSingle();
  if (isMissingTable(error)) return { ok: false, status: 400, code: "unsupported", error: ANNOUNCEMENTS_SQL_HINT };
  if (error || !data) return { ok: false, status: 404, error: "Announcement not found." };
  return { row: data };
}

const savedPath = (id: string, ext: string) => `announcements/${id}/picture-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;

// Replace (or set) the picture on a saved announcement.
export async function setAnnouncementImage(supabase: Supabase, id: string, file: File): Promise<ImageResult> {
  const check = await checkImageUpload(file);
  if (!check.ok) return { ok: false, status: 400, error: check.error };

  const loaded = await loadAnnouncement(supabase, id);
  if (!("row" in loaded)) return loaded;
  const { row } = loaded;

  const path = savedPath(row.id, check.ext);
  const { error: uploadError } = await supabase.storage
    .from(EVENT_BUCKET)
    .upload(path, file, { contentType: check.contentType, upsert: false });
  if (uploadError) return { ok: false, status: 500, error: uploadError.message };

  const { error: dbError } = await supabase.from("announcements").update({ image_path: path }).eq("id", row.id);
  if (dbError) {
    await supabase.storage.from(EVENT_BUCKET).remove([path]);
    return { ok: false, status: 500, error: dbError.message };
  }

  if (row.image_path) await removeFileIfUnreferenced(supabase, row.image_path);
  return { ok: true, path, url: announcementImageUrl(path) };
}

export async function clearAnnouncementImage(supabase: Supabase, id: string): Promise<{ ok: true } | ImageFailure> {
  const loaded = await loadAnnouncement(supabase, id);
  if (!("row" in loaded)) return loaded;
  const { row } = loaded;
  if (!row.image_path) return { ok: true };

  const { error } = await supabase.from("announcements").update({ image_path: null }).eq("id", row.id);
  if (error) return { ok: false, status: 500, error: error.message };
  await removeFileIfUnreferenced(supabase, row.image_path);
  return { ok: true };
}

export async function uploadPendingImage(supabase: Supabase, file: File): Promise<ImageResult> {
  const check = await checkImageUpload(file);
  if (!check.ok) return { ok: false, status: 400, error: check.error };
  const path = `${PENDING_PREFIX}${randomUUID()}.${check.ext}`;
  const { error } = await supabase.storage
    .from(EVENT_BUCKET)
    .upload(path, file, { contentType: check.contentType, upsert: false });
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, path, url: announcementImageUrl(path) };
}

export async function deletePendingImage(supabase: Supabase, path: string): Promise<void> {
  if (!isPendingPath(path)) return;
  await supabase.storage.from(EVENT_BUCKET).remove([path]);
}

// Moves a pending file into the announcement's own folder and records it.
export async function attachPendingImage(
  supabase: Supabase,
  id: string,
  pendingPath: string,
): Promise<{ ok: true; path: string } | ImageFailure> {
  if (!isPendingPath(pendingPath)) {
    return { ok: false, status: 400, error: "That picture isn't a valid pending upload." };
  }
  const ext = pendingPath.split(".").pop() ?? "jpg";
  const path = savedPath(id, ext);
  const { error: moveError } = await supabase.storage.from(EVENT_BUCKET).move(pendingPath, path);
  if (moveError) return { ok: false, status: 400, error: `Couldn't use that picture: ${moveError.message}` };

  const { error: dbError } = await supabase.from("announcements").update({ image_path: path }).eq("id", id);
  if (dbError) {
    await supabase.storage.from(EVENT_BUCKET).remove([path]);
    return { ok: false, status: 500, error: dbError.message };
  }
  return { ok: true, path };
}

export async function cleanupPendingAnnouncementImages(
  supabase: Supabase,
  now: number = Date.now(),
): Promise<{ removed: number; error?: string }> {
  const folder = PENDING_PREFIX.replace(/\/$/, "");
  const { data, error } = await supabase.storage.from(EVENT_BUCKET).list(folder, { limit: 1000 });
  if (error) return { removed: 0, error: error.message };
  const stale = (data ?? [])
    .filter((f: { name: string; created_at?: string | null }) => {
      const created = f.created_at ? Date.parse(f.created_at) : NaN;
      return Number.isFinite(created) && now - created > PENDING_MAX_AGE_MS;
    })
    .map((f: { name: string }) => `${PENDING_PREFIX}${f.name}`);
  if (stale.length === 0) return { removed: 0 };
  const { error: removeError } = await supabase.storage.from(EVENT_BUCKET).remove(stale);
  if (removeError) return { removed: 0, error: removeError.message };
  return { removed: stale.length };
}

export { COLUMNS as ANNOUNCEMENT_COLUMNS };
