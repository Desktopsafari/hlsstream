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

// ---------------------------------------------------------------------------
// Poll end times. A normal daily poll ends at the first 8 PM ET after it
// opened (getPollCutoff). A poll with a chosen duration stores its own end
// instant (ends_at) or is open-ended (never expires by time). Voting is
// decided from these on every vote request, so it stops on time even when the
// close cron hasn't run yet.
// ---------------------------------------------------------------------------

export type PollTiming = {
  opens_at: string;
  ends_at?: string | null;
  open_ended?: boolean | null;
};

// When voting ends, or null for an open-ended poll.
export function getPollEnd(poll: PollTiming): Date | null {
  if (poll.open_ended) return null;
  if (poll.ends_at) return new Date(poll.ends_at);
  return getPollCutoff(poll.opens_at);
}

export function isPollPastEnd(poll: PollTiming, now: Date = new Date()): boolean {
  const end = getPollEnd(poll);
  return end !== null && now.getTime() >= end.getTime();
}

// The one place that decides where a poll is in its life, from its stored
// status AND the clock:
//   scheduled  waiting in the queue
//   open       taking votes
//   ended      stored as open, but its end time has passed -- voting is
//              refused and the card shows it closed; a cron just hasn't
//              flipped the stored status yet
//   closed     closed (results email sent)
export type PollPhase = "scheduled" | "open" | "ended" | "closed";

export type PollState = {
  phase: PollPhase;
  votingOpen: boolean;
  // When voting ends (null = open-ended, or the poll isn't open).
  end: Date | null;
};

export function getPollState(
  poll: { status: string } & PollTiming,
  now: Date = new Date(),
): PollState {
  if (poll.status === "scheduled") return { phase: "scheduled", votingOpen: false, end: null };
  if (poll.status !== "open") return { phase: "closed", votingOpen: false, end: null };
  const end = getPollEnd(poll);
  const past = end !== null && now.getTime() >= end.getTime();
  return { phase: past ? "ended" : "open", votingOpen: !past, end };
}

// A poll with a chosen duration (as opposed to the normal daily one).
export function isLongPoll(poll: { ends_at?: string | null; open_ended?: boolean | null }): boolean {
  return !!poll.open_ended || !!poll.ends_at;
}

// 8 PM ET on the last day of an N-day poll that opened at `opensAt`
// (day 1 is the day it opened). Correct across a DST changeover.
export function getDaysPollEnd(opensAt: string | Date, days: number): Date {
  const p = zonedParts(new Date(opensAt));
  const last = new Date(Date.UTC(p.y, p.m - 1, p.d + days - 1));
  return zonedWallTimeToDate(
    last.getUTCFullYear(),
    last.getUTCMonth() + 1,
    last.getUTCDate(),
    POLL_CLOSE_HOUR,
  );
}

// The next 12:00 PM ET after `now`: when a newly queued poll opens.
export function getNextNoon(now: Date = new Date()): Date {
  const p = zonedParts(now);
  const today = zonedWallTimeToDate(p.y, p.m, p.d, 12);
  if (today.getTime() > now.getTime()) return today;
  const next = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  return zonedWallTimeToDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 12);
}

// "Sunday 8:00 PM", "Fri 12:00 PM" ... in POLL_TIMEZONE (no "ET" suffix).
export function formatEasternDay(date: Date, weekday: "long" | "short" = "long"): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: POLL_TIMEZONE,
    weekday,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}

// "Sun, Nov 15, 8:00 PM" -- used when the date matters more than the weekday.
export function formatEasternDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: POLL_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")}, ${get("month")} ${get("day")}, ${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}

// Public wording: "Sunday 8:00 PM" within a week, otherwise with the date.
export function formatDeadline(end: Date, now: Date = new Date()): string {
  const withinWeek = end.getTime() - now.getTime() < 6 * 24 * 60 * 60 * 1000;
  return withinWeek ? formatEasternDay(end, "long") : formatEasternDate(end);
}

// Whether a moment is exactly the normal cutoff hour (8:00 PM ET).
export function isAtCutoffHour(date: Date): boolean {
  const p = zonedParts(date);
  return p.h === POLL_CLOSE_HOUR && p.min === 0;
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
