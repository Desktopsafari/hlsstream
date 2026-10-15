import {
  formatDeadline,
  formatDuration,
  formatEasternDay,
  getDaysPollEnd,
  getNextNoon,
  getPollCutoff,
  isAtCutoffHour,
  parseEasternDateTime,
} from "@/lib/pollSchedule";
import { POLL_CLOSE_HOUR, POLL_TIMEZONE } from "@/config/constants";

// How long voting runs. Shared by the admin form (live summary) and the API
// (validation), so what the admin is shown is what gets saved.
export const MIN_POLL_DAYS = 2;
export const MAX_POLL_DAYS = 30;

export type DurationInput =
  | { mode: "today" }
  | { mode: "days"; days: number }
  | { mode: "until"; until: string } // "YYYY-MM-DDTHH:mm", Eastern Time
  | { mode: "open" };

// What is stored on the poll. Today only = all empty (the normal daily poll).
// For N days, ends_at is filled in when the poll actually opens, because the
// last day is counted from the day it opens.
export type DurationColumns = {
  ends_at: string | null;
  open_ended: boolean;
  duration_days: number | null;
};

export const DAILY_COLUMNS: DurationColumns = { ends_at: null, open_ended: false, duration_days: null };

export function isDailyColumns(c: DurationColumns): boolean {
  return !c.ends_at && !c.open_ended && !c.duration_days;
}

export const DURATION_SQL_HINT =
  "Multi-day and open-ended polls need the database columns first: run supabase/poll_duration.sql in the Supabase SQL Editor.";

export type DurationResult =
  | { ok: true; columns: DurationColumns }
  | { ok: false; error: string };

// `opensAt` is when the poll is expected to open (next noon, or now for Open now).
export function resolveDuration(input: unknown, opensAt: Date, now: Date = new Date()): DurationResult {
  if (input === undefined || input === null) return { ok: true, columns: DAILY_COLUMNS };
  const d = input as Partial<DurationInput> & { days?: unknown; until?: unknown };

  switch (d.mode) {
    case "today":
      return { ok: true, columns: DAILY_COLUMNS };
    case "open":
      return { ok: true, columns: { ends_at: null, open_ended: true, duration_days: null } };
    case "days": {
      const days = Number(d.days);
      if (!Number.isInteger(days) || days < MIN_POLL_DAYS || days > MAX_POLL_DAYS) {
        return { ok: false, error: `Choose between ${MIN_POLL_DAYS} and ${MAX_POLL_DAYS} days.` };
      }
      return { ok: true, columns: { ends_at: null, open_ended: false, duration_days: days } };
    }
    case "until": {
      const end = typeof d.until === "string" ? parseEasternDateTime(d.until) : null;
      if (!end) return { ok: false, error: "Pick an end date and time." };
      if (end.getTime() <= now.getTime()) return { ok: false, error: "That end time is in the past." };
      if (end.getTime() <= opensAt.getTime()) {
        return { ok: false, error: "The end time has to be after the poll opens." };
      }
      return { ok: true, columns: { ends_at: end.toISOString(), open_ended: false, duration_days: null } };
    }
    default:
      return { ok: false, error: "Pick how long voting should run." };
  }
}

// The moment voting ends for a poll that opens at `opensAt`; null = no end.
export function endForColumns(c: DurationColumns, opensAt: Date): Date | null {
  if (c.open_ended) return null;
  if (c.ends_at) return new Date(c.ends_at);
  if (c.duration_days) return getDaysPollEnd(opensAt, c.duration_days);
  return getPollCutoff(opensAt);
}

// Calendar date in Eastern Time as a day number, for counting days inclusively.
function easternDayNumber(d: Date): number {
  const [y, m, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone: POLL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(d)
    .split("-")
    .map(Number);
  return Date.UTC(y, m - 1, day) / 86_400_000;
}

// "about 3 days" counts the days voting touches (Fri to Sun = 3 days), the way
// "Run for 3 days" does; within a single day it says how many hours.
export function approxSpan(start: Date, end: Date): string {
  const days = easternDayNumber(end) - easternDayNumber(start) + 1;
  if (days >= 2) return `about ${days} days`;
  return `about ${formatDuration(end.getTime() - start.getTime())}`;
}

// "Opens Fri 12:00 PM ET, voting ends Sun 8:00 PM ET (about 3 days)."
export function describeSchedule(
  c: DurationColumns,
  opts: { openNow?: boolean; now?: Date } = {},
): string {
  const now = opts.now ?? new Date();
  const opensAt = opts.openNow ? now : getNextNoon(now);
  const start = opts.openNow ? "Opens now" : `Opens ${formatEasternDay(opensAt, "short")} ET`;
  const end = endForColumns(c, opensAt);
  if (!end) return `${start}, and stays open until you close it.`;
  return `${start}, voting ends ${formatEasternDay(end, "short")} ET (${approxSpan(opensAt, end)}).`;
}

// The public wording under the question.
export function publicDeadline(
  poll: { ends_at?: string | null; open_ended?: boolean | null },
  now: Date = new Date(),
): string | null {
  if (poll.open_ended) return "Voting open until we close it";
  if (poll.ends_at) return `Voting open until ${formatDeadline(new Date(poll.ends_at), now)} ET`;
  return null;
}

// How late the results email can be for a given end time. Voting itself always
// stops on time; the email goes out when a daily job notices the poll has
// ended. Those run in the 8 PM ET hour (close job) and the noon hour (open
// job), so an end time off the 8 PM cutoff waits for the next of those.
export const EMAIL_NOTE_OFF_CUTOFF =
  "Voting stops exactly at this time, but the results email is sent by a daily job: at the next run around 8 PM ET (8:00-8:59) or around noon ET (12:00-12:59). Depending on the end time that can be up to about 17 hours late. Closing it yourself with Close now sends it immediately.";

export function emailNoteFor(end: Date | null): string | null {
  if (end === null) return null;
  return isAtCutoffHour(end) ? null : EMAIL_NOTE_OFF_CUTOFF;
}

export const CUTOFF_HOUR_LABEL = `${POLL_CLOSE_HOUR % 12 || 12}:00 ${POLL_CLOSE_HOUR >= 12 ? "PM" : "AM"} ET`;
