import { POLL_CLOSE_HOUR, POLL_TIMEZONE } from "@/config/constants";

function zonedParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: POLL_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    h: get("hour"),
    min: get("minute"),
    s: get("second"),
  };
}

// The UTC instant at which the wall clock in POLL_TIMEZONE reads
// y-m-d hour:minute. Two passes so it stays right across a DST changeover.
function zonedWallTimeToDate(
  y: number,
  m: number,
  d: number,
  hour: number,
  minute = 0,
): Date {
  const target = Date.UTC(y, m - 1, d, hour, minute);
  let utc = target;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(utc));
    const wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    utc = target - (wall - utc);
  }
  return new Date(utc);
}

// The first POLL_CLOSE_HOUR o'clock (in POLL_TIMEZONE) after the poll opened.
export function getPollCutoff(opensAt: string | Date): Date {
  const opened = new Date(opensAt);
  const p = zonedParts(opened);
  const sameDay = zonedWallTimeToDate(p.y, p.m, p.d, POLL_CLOSE_HOUR);
  if (sameDay.getTime() > opened.getTime()) return sameDay;

  const next = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  return zonedWallTimeToDate(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    POLL_CLOSE_HOUR,
  );
}

export function isPollPastCutoff(opensAt: string | Date, now: Date = new Date()): boolean {
  return now.getTime() >= getPollCutoff(opensAt).getTime();
}

// What "Open now" may do right now. Before the cutoff hour it's allowed and
// voting would run until today's cutoff; from the cutoff hour on it isn't,
// because getPollCutoff would then point at tomorrow and the poll would sit
// open overnight instead of closing at once. `now` is a parameter so the
// after-8pm behaviour can be simulated.
export function getOpenNowWindow(now: Date = new Date()):
  | { allowed: true; cutoff: Date; msLeft: number }
  | { allowed: false } {
  const p = zonedParts(now);
  if (p.h >= POLL_CLOSE_HOUR) return { allowed: false };
  const cutoff = zonedWallTimeToDate(p.y, p.m, p.d, POLL_CLOSE_HOUR);
  return { allowed: true, cutoff, msLeft: cutoff.getTime() - now.getTime() };
}

// "4 hours 49 minutes", "1 hour", "12 minutes" (rounded down to the minute).
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes > 0 || hours === 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  return parts.join(" ");
}

// The wall-clock hour (0-23) in POLL_TIMEZONE, used to tell a poll the daily
// cron opened (always in the noon hour) from one opened early by hand.
export function easternHour(date: string | Date): number {
  return zonedParts(new Date(date)).h;
}

// Parses a "YYYY-MM-DDTHH:mm" string (what <input type="datetime-local">
// produces) as Eastern Time and returns the matching instant, or null if the
// string isn't in that shape.
export function parseEasternDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [y, m, d, h, min] = match.slice(1).map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59) return null;
  return zonedWallTimeToDate(y, m, d, h, min);
}

// The inverse, for pre-filling a datetime-local input: an instant as an
// Eastern "YYYY-MM-DDTHH:mm" string.
export function toEasternDateTimeInput(date: Date): string {
  const p = zonedParts(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}`;
}
