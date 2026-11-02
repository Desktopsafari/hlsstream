import type { createServiceRoleClient } from "@/lib/supabase/server";
import { STREAM_ID } from "@/config/constants";
import {
  easternDate,
  easternWhen,
  isMissingPushTable,
  isPushPaused,
  loadCategories,
  nextOccurrence,
  pushKeys,
  repeatingStatus,
  type RepeatingRule,
} from "@/lib/push";
import { PUSH_KEYS_HINT, PUSH_SQL_HINT } from "@/lib/pushShared";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// What the admin Push tab (and the Live now strip) shows.

type RepeatingRow = RepeatingRule & {
  id: string;
  title: string;
  message: string;
  url: string;
  category_id: string;
  next_send_at: string | null;
};
export const REPEATING_COLUMNS =
  "id, title, message, url, category_id, time_of_day, days_of_week, is_active, skip_date, last_sent_date, next_send_at";

// next_send_at after a change made at `now`.
export function nextFor(rule: RepeatingRule, now: Date): string | null {
  return nextOccurrence(rule, now)?.toISOString() ?? null;
}

export async function loadPushOverview(supabase: Supabase, now: Date = new Date()) {
  const keysMissing = !pushKeys();
  const cats = await loadCategories(supabase, STREAM_ID, true);
  if (cats.error) {
    return {
      supported: false,
      hint: cats.missing ? PUSH_SQL_HINT : cats.error,
      keysMissing,
    };
  }
  const names = new Map(cats.categories.map((c) => [c.id, c.name]));

  const [paused, repeatingRes, scheduledRes, logRes] = await Promise.all([
    isPushPaused(supabase),
    supabase.from("push_repeating").select(REPEATING_COLUMNS).eq("stream_id", STREAM_ID).order("time_of_day", { ascending: true }),
    supabase
      .from("push_scheduled")
      .select("id, title, message, url, category_id, send_at")
      .eq("stream_id", STREAM_ID)
      .eq("status", "pending")
      .order("send_at", { ascending: true }),
    supabase
      .from("push_sends")
      .select("id, title, category_name, source, status, recipients, sent, failed, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const firstError = [repeatingRes.error, scheduledRes.error, logRes.error].find(Boolean);
  if (firstError) {
    return { supported: false, hint: isMissingPushTable(firstError) ? PUSH_SQL_HINT : firstError.message, keysMissing };
  }

  const today = easternDate(now);
  const repeating = ((repeatingRes.data ?? []) as RepeatingRow[]).map((r) => ({
    id: r.id,
    title: r.title,
    message: r.message,
    url: r.url,
    categoryId: r.category_id,
    categoryName: names.get(r.category_id) ?? "(inactive category)",
    timeOfDay: r.time_of_day,
    daysOfWeek: r.days_of_week,
    isActive: r.is_active,
    skippedToday: r.skip_date === today,
    nextSendAt: r.next_send_at,
    status: repeatingStatus(r, now),
  }));
  const scheduled = ((scheduledRes.data ?? []) as { id: string; title: string; message: string; url: string; category_id: string; send_at: string }[]).map(
    (s) => ({
      id: s.id,
      title: s.title,
      message: s.message,
      url: s.url,
      categoryName: names.get(s.category_id) ?? "(inactive category)",
      sendAt: s.send_at,
      when: easternWhen(new Date(s.send_at), now),
    }),
  );

  // The soonest upcoming timed send, for the Live now strip.
  const upcoming = [
    ...repeating.filter((r) => r.isActive && r.nextSendAt).map((r) => ({ title: r.title, at: r.nextSendAt as string })),
    ...scheduled.map((s) => ({ title: s.title, at: s.sendAt })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];

  return {
    supported: true,
    keysMissing,
    hint: keysMissing ? PUSH_KEYS_HINT : null,
    paused,
    categories: cats.categories,
    repeating,
    scheduled,
    log: logRes.data ?? [],
    next: upcoming ? `“${upcoming.title}” ${easternWhen(new Date(upcoming.at), now)}` : null,
  };
}

export async function categoryExists(supabase: Supabase, id: string): Promise<boolean> {
  const { data } = await supabase.from("push_categories").select("id").eq("id", id).eq("stream_id", STREAM_ID).maybeSingle();
  return !!data;
}
