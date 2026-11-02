import webpush from "web-push";
import type { createServiceRoleClient } from "@/lib/supabase/server";
import { STREAM_ID } from "@/config/constants";
import { formatEasternDate, parseEasternDateTime, toEasternDateTimeInput } from "@/lib/pollSchedule";
import { ALL_DAYS, PUSH_MESSAGE_MAX, PUSH_TITLE_MAX } from "@/lib/pushShared";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// Web Push notifications (phone and desktop). Visitors subscribe from the
// "Notify me" modal; the admin sends now, at a set time, or on a repeating
// schedule. Timed sends are run by /api/cron/send-due-push, which a VPS timer
// pings every minute; all of the time math here is in Eastern Time, using the
// same helpers as the polls, so daylight saving needs no edits.

// A notification that arrives more than 2 hours late is dropped by the push
// service instead of delivered, so a phone that was off never gets a stale
// "feeding time".
export const PUSH_TTL_SECONDS = 2 * 60 * 60;
// A timed send whose moment passed more than this long ago is marked missed,
// never sent late.
export const PUSH_GRACE_MS = 30 * 60 * 1000;
// Failed sends in a row (other than "gone") before a subscription is deleted.
export const PUSH_MAX_FAILURES = 5;
// How many pushes are in flight at once.
export const PUSH_CONCURRENCY = 10;
// Public routes: subscribe, change categories, unsubscribe, status lookups.
export const PUSH_RATE_LIMIT_MAX = 30;
export const PUSH_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const PUSH_FORM = "push";

const ENDPOINT_MAX = 1000;

// ---- configuration ------------------------------------------------------------

export type PushKeys = { publicKey: string; privateKey: string; subject: string };

// The VAPID keys, or null when any is missing (push is then hidden).
export function pushKeys(): PushKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

// One of the push tables hasn't been created yet (push_notifications.sql not run).
export function isMissingPushTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /push_/i.test(error.message ?? "") && /does not exist|schema cache/i.test(error.message ?? "");
}

// ---- validating input -----------------------------------------------------------

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

// Endpoint: an https URL of sane length on a real host name. Push services
// hand these out; anything else is junk.
export function cleanEndpoint(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const endpoint = value.trim();
  if (endpoint.length < 20 || endpoint.length > ENDPOINT_MAX) return null;
  if (/[\s<>"'`\\]/.test(endpoint)) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname;
  if (!host.includes(".") || host === "localhost" || /^[\d.]+$/.test(host) || host.startsWith("[")) return null;
  return endpoint;
}

export type SubscriptionInput = { endpoint: string; p256dh: string; auth: string };

export function parseSubscription(value: unknown): SubscriptionInput | null {
  const v = (value ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = cleanEndpoint(v.endpoint);
  const p256dh = v.keys?.p256dh;
  const auth = v.keys?.auth;
  if (!endpoint) return null;
  if (typeof p256dh !== "string" || p256dh.length < 20 || p256dh.length > 200 || !B64URL.test(p256dh)) return null;
  if (typeof auth !== "string" || auth.length < 8 || auth.length > 100 || !B64URL.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

// Category ids from the visitor: a non-empty list of short strings, de-duplicated.
export function parseCategoryIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return null;
  if (value.some((c) => typeof c !== "string" || c.length === 0 || c.length > 64)) return null;
  return [...new Set(value as string[])];
}

function cleanLine(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The notification's link: a path on this site. Blank means the home page. A
// full URL is accepted only on the site's own host, and kept as its path.
// Anything else (another site, javascript:, //host ...) is refused.
export function cleanPushLink(value: unknown, siteHost?: string): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw === "") return "/";
  if (raw.length > 300 || /[\s\\<>"'`\u0000-\u001F\u007F]/.test(raw)) return null;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const url = new URL(raw);
    if ((url.protocol === "https:" || url.protocol === "http:") && siteHost && url.host === siteHost) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    // not a URL
  }
  return null;
}

export type PushMessage = { title: string; message: string; url: string; categoryId: string };

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parsePushMessage(body: unknown, siteHost?: string): Parsed<PushMessage> {
  const b = (body ?? {}) as Record<string, unknown>;
  const title = cleanLine(b.title);
  const message = cleanLine(b.message);
  const url = cleanPushLink(b.url, siteHost);
  const categoryId = typeof b.categoryId === "string" ? b.categoryId : "";
  if (!title || title.length > PUSH_TITLE_MAX) {
    return { ok: false, error: `A title is required (${PUSH_TITLE_MAX} characters max).` };
  }
  if (!message || message.length > PUSH_MESSAGE_MAX) {
    return { ok: false, error: `A message is required (${PUSH_MESSAGE_MAX} characters max).` };
  }
  if (!url) return { ok: false, error: "The link must be a page on this site, like / or /contact." };
  if (!categoryId) return { ok: false, error: "Pick a category." };
  return { ok: true, value: { title, message, url, categoryId } };
}

// ---- Eastern dates ---------------------------------------------------------------

// "2026-11-02": the Eastern calendar date of an instant.
export function easternDate(date: Date): string {
  return toEasternDateTimeInput(date).slice(0, 10);
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// "6:00 PM", Eastern.
function easternTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

// "today 6:00 PM", "tomorrow 6:00 PM", "Wed 6:00 PM", or the full date when
// it's more than a week away.
export function easternWhen(date: Date, now: Date = new Date()): string {
  const today = easternDate(now);
  const day = easternDate(date);
  if (day === today) return `today ${easternTime(date)}`;
  if (day === addDays(today, 1)) return `tomorrow ${easternTime(date)}`;
  if (date.getTime() - now.getTime() < 6 * 24 * 60 * 60 * 1000 && date > now) {
    return `${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(date)} ${easternTime(date)}`;
  }
  return formatEasternDate(date);
}

// ---- repeating notifications -------------------------------------------------------

export type RepeatingRule = {
  time_of_day: string; // "HH:MM" Eastern
  days_of_week: number[];
  is_active: boolean;
  skip_date: string | null;
  last_sent_date: string | null;
};

// The first moment at or after `from` this rule should send: a chosen
// weekday, not the skipped date, not a day it already sent on. Null if
// it's off (or has no days).
export function nextOccurrence(rule: RepeatingRule, from: Date): Date | null {
  if (!rule.is_active || rule.days_of_week.length === 0) return null;
  const start = easternDate(from);
  for (let i = 0; i <= 8; i++) {
    const day = addDays(start, i);
    if (!rule.days_of_week.includes(weekday(day))) continue;
    if (day === rule.skip_date || day === rule.last_sent_date) continue;
    const at = parseEasternDateTime(`${day}T${rule.time_of_day}`);
    if (at && at.getTime() >= from.getTime()) return at;
  }
  return null;
}

// "Next: today 6:00 PM", "Skipped today, resumes tomorrow 6:00 PM", "Off".
export function repeatingStatus(
  rule: RepeatingRule & { next_send_at: string | null },
  now: Date = new Date(),
): string {
  if (!rule.is_active) return "Off";
  const next = rule.next_send_at ? new Date(rule.next_send_at) : null;
  if (!next) return "Off (no days chosen)";
  if (rule.skip_date === easternDate(now)) return `Skipped today, resumes ${easternWhen(next, now)}`;
  return `Next: ${easternWhen(next, now)}`;
}

export type RepeatingInput = {
  title: string;
  message: string;
  url: string;
  category_id: string;
  time_of_day: string;
  days_of_week: number[];
  is_active: boolean;
};

export function parseRepeatingInput(body: unknown, siteHost?: string): Parsed<RepeatingInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const msg = parsePushMessage(b, siteHost);
  if (!msg.ok) return msg;
  const time = typeof b.timeOfDay === "string" ? b.timeOfDay.trim() : "";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, error: "Pick a time of day." };
  const rawDays = b.daysOfWeek === undefined ? ALL_DAYS : b.daysOfWeek;
  if (!Array.isArray(rawDays) || rawDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return { ok: false, error: "Days of the week aren't valid." };
  }
  const days = [...new Set(rawDays as number[])].sort();
  if (days.length === 0) return { ok: false, error: "Pick at least one day of the week." };
  return {
    ok: true,
    value: {
      title: msg.value.title,
      message: msg.value.message,
      url: msg.value.url,
      category_id: msg.value.categoryId,
      time_of_day: time,
      days_of_week: days,
      is_active: b.isActive !== false,
    },
  };
}

// ---- settings and categories --------------------------------------------------------

export async function isPushPaused(supabase: Supabase, streamId: string = STREAM_ID): Promise<boolean> {
  const { data } = await supabase.from("push_settings").select("paused").eq("stream_id", streamId).maybeSingle();
  return (data as { paused?: boolean } | null)?.paused === true;
}

export type PushCategory = { id: string; name: string; subscribers: number };

// Active categories, in order, with how many subscriptions chose each.
// `error` is set when the tables don't exist yet (or the query failed).
export async function loadCategories(
  supabase: Supabase,
  streamId: string = STREAM_ID,
  withCounts = false,
): Promise<{ categories: PushCategory[]; missing: boolean; error?: string }> {
  const { data, error } = await supabase
    .from("push_categories")
    .select("id, name, display_order")
    .eq("stream_id", streamId)
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  if (error) return { categories: [], missing: isMissingPushTable(error), error: error.message };
  const counts = new Map<string, number>();
  if (withCounts) {
    const { data: subs } = await supabase.from("push_subscriptions").select("category_ids").eq("stream_id", streamId);
    for (const s of (subs ?? []) as { category_ids: string[] }[]) {
      for (const id of s.category_ids ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const rows = (data ?? []) as { id: string; name: string }[];
  return { categories: rows.map((c) => ({ id: c.id, name: c.name, subscribers: counts.get(c.id) ?? 0 })), missing: false };
}

// ---- sending -------------------------------------------------------------------------

type SubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string; failure_count: number };
const SUB_COLUMNS = "id, endpoint, p256dh, auth, failure_count";

export type SendCounts = { recipients: number; sent: number; failed: number };

// Sends one notification to each subscription, PUSH_CONCURRENCY at a time.
// "Gone" (404/410) deletes the subscription at once; any other failure counts,
// and PUSH_MAX_FAILURES in a row deletes it. A success resets the count.
export async function sendToSubscriptions(
  supabase: Supabase,
  subs: SubscriptionRow[],
  note: { title: string; message: string; url: string },
  keys: PushKeys,
): Promise<SendCounts> {
  const payload = JSON.stringify({ title: note.title, body: note.message, url: note.url, icon: "/icon-192.png" });
  const counts = { recipients: subs.length, sent: 0, failed: 0 };
  let next = 0;

  async function worker() {
    while (next < subs.length) {
      const sub = subs[next++];
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
          TTL: PUSH_TTL_SECONDS,
          urgency: "high",
          vapidDetails: { subject: keys.subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
        });
        counts.sent++;
        await supabase
          .from("push_subscriptions")
          .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
          .eq("id", sub.id);
      } catch (err) {
        counts.failed++;
        const status = (err as { statusCode?: number }).statusCode;
        const failures = (sub.failure_count ?? 0) + 1;
        if (status === 404 || status === 410 || failures >= PUSH_MAX_FAILURES) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          await supabase.from("push_subscriptions").update({ failure_count: failures }).eq("id", sub.id);
          console.error("Push send failed:", status ?? (err as Error).message);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(PUSH_CONCURRENCY, subs.length) }, worker));
  return counts;
}

export type LogSource = "now" | "test" | "scheduled" | "repeating";

async function logSend(
  supabase: Supabase,
  note: { title: string; message: string; url: string; category_id: string | null },
  source: LogSource,
  status: "sent" | "missed",
  counts: SendCounts,
) {
  let categoryName: string | null = null;
  if (note.category_id) {
    const { data } = await supabase.from("push_categories").select("name").eq("id", note.category_id).maybeSingle();
    categoryName = (data as { name?: string } | null)?.name ?? null;
  }
  const { error } = await supabase.from("push_sends").insert({
    title: note.title,
    message: note.message,
    url: note.url,
    category_id: note.category_id,
    category_name: categoryName,
    source,
    status,
    ...counts,
  });
  if (error) console.error("Push log failed:", error.message);
}

// Sends to everyone on this stream who chose the category, and logs it.
export async function sendToCategory(
  supabase: Supabase,
  note: { title: string; message: string; url: string; category_id: string },
  source: LogSource,
  keys: PushKeys,
  streamId: string = STREAM_ID,
): Promise<SendCounts> {
  const { data } = await supabase
    .from("push_subscriptions")
    .select(`${SUB_COLUMNS}, category_ids`)
    .eq("stream_id", streamId);
  const subs = ((data ?? []) as (SubscriptionRow & { category_ids: string[] })[]).filter((s) =>
    (s.category_ids ?? []).includes(note.category_id),
  );
  const counts = await sendToSubscriptions(supabase, subs, note, keys);
  await logSend(supabase, note, source, "sent", counts);
  return counts;
}

// "Send test to this device only": the one subscription with this endpoint.
export async function sendTest(
  supabase: Supabase,
  endpoint: string,
  note: { title: string; message: string; url: string; category_id: string | null },
  keys: PushKeys,
): Promise<SendCounts | null> {
  const { data } = await supabase.from("push_subscriptions").select(SUB_COLUMNS).eq("endpoint", endpoint).maybeSingle();
  if (!data) return null;
  const counts = await sendToSubscriptions(supabase, [data as SubscriptionRow], note, keys);
  await logSend(supabase, note, "test", "sent", counts);
  return counts;
}

// ---- the every-minute run ----------------------------------------------------------------

type DueRow = { kind: string; id: string; stream_id: string; due_at: string };
const NOTE_COLUMNS = "id, stream_id, title, message, url, category_id";
const NO_COUNTS: SendCounts = { recipients: 0, sent: 0, failed: 0 };

export type DueResult = { idle: boolean; message: string; sent: number; missed: number };

// Everything whose moment has come. One small query when nothing is due.
// Each item is claimed with a conditional update before anything is sent, so
// overlapping pings can't send it twice. More than PUSH_GRACE_MS late = marked
// missed and logged, never sent. While sending is paused nothing is sent; items
// stay due and go missed if the pause outlasts their window.
export async function runDuePush(supabase: Supabase, now: Date = new Date()): Promise<DueResult> {
  const { data, error } = await supabase
    .from("push_due")
    .select("kind, id, stream_id, due_at")
    .lte("due_at", now.toISOString())
    .order("due_at", { ascending: true })
    .limit(20);
  if (error) {
    return { idle: true, message: isMissingPushTable(error) ? "Push tables not set up." : error.message, sent: 0, missed: 0 };
  }
  const due = (data ?? []) as DueRow[];
  if (due.length === 0) return { idle: true, message: "Nothing due.", sent: 0, missed: 0 };

  const keys = pushKeys();
  const pausedByStream = new Map<string, boolean>();
  let sent = 0;
  let missed = 0;
  let waiting = 0;

  for (const item of due) {
    const late = now.getTime() - new Date(item.due_at).getTime() > PUSH_GRACE_MS;
    if (!late) {
      if (!pausedByStream.has(item.stream_id)) pausedByStream.set(item.stream_id, await isPushPaused(supabase, item.stream_id));
      if (pausedByStream.get(item.stream_id) || !keys) {
        waiting++;
        continue;
      }
    }
    const outcome =
      item.kind === "scheduled"
        ? await runScheduled(supabase, item, late, now, keys)
        : item.kind === "repeating"
          ? await runRepeating(supabase, item, late, now, keys)
          : "skipped";
    if (outcome === "sent") sent++;
    if (outcome === "missed") missed++;
  }

  const parts = [`${sent} sent`, `${missed} missed`];
  if (waiting) parts.push(`${waiting} waiting (${keys ? "sending is paused" : "VAPID keys missing"})`);
  return { idle: false, message: parts.join(", "), sent, missed };
}

type NoteRow = { id: string; stream_id: string; title: string; message: string; url: string; category_id: string };

async function runScheduled(
  supabase: Supabase,
  item: DueRow,
  late: boolean,
  now: Date,
  keys: PushKeys | null,
): Promise<"sent" | "missed" | "skipped"> {
  const { data } = await supabase
    .from("push_scheduled")
    .update(late ? { status: "missed" } : { status: "sending", claimed_at: now.toISOString() })
    .eq("id", item.id)
    .eq("status", "pending")
    .select(NOTE_COLUMNS);
  const claimed = ((data ?? []) as NoteRow[])[0];
  if (!claimed) return "skipped"; // another ping got it, or it was cancelled
  if (late || !keys) {
    await logSend(supabase, claimed, "scheduled", "missed", NO_COUNTS);
    return "missed";
  }
  await sendToCategory(supabase, claimed, "scheduled", keys, claimed.stream_id);
  await supabase.from("push_scheduled").update({ status: "sent" }).eq("id", item.id);
  return "sent";
}

async function runRepeating(
  supabase: Supabase,
  item: DueRow,
  late: boolean,
  now: Date,
  keys: PushKeys | null,
): Promise<"sent" | "missed" | "skipped"> {
  const { data: row } = await supabase
    .from("push_repeating")
    .select(`${NOTE_COLUMNS}, time_of_day, days_of_week, is_active, skip_date, last_sent_date`)
    .eq("id", item.id)
    .maybeSingle();
  if (!row) return "skipped";
  const rule = row as NoteRow & RepeatingRule;
  const dueAt = new Date(item.due_at);
  const sentDay = late ? rule.last_sent_date : easternDate(dueAt);
  // After a send: the next one after this occurrence. After a miss: the next
  // one from now (this one's window is gone).
  const next = nextOccurrence({ ...rule, last_sent_date: sentDay }, late ? now : new Date(dueAt.getTime() + 1));

  // The claim: only the ping that moves next_send_at on from this exact value sends.
  const { data: claimedRows } = await supabase
    .from("push_repeating")
    .update({ next_send_at: next?.toISOString() ?? null, last_sent_date: sentDay, updated_at: now.toISOString() })
    .eq("id", item.id)
    .eq("next_send_at", item.due_at)
    .select("id");
  if (!claimedRows || claimedRows.length === 0) return "skipped";

  if (late || !keys) {
    await logSend(supabase, rule, "repeating", "missed", NO_COUNTS);
    return "missed";
  }
  await sendToCategory(supabase, rule, "repeating", keys, rule.stream_id);
  return "sent";
}
