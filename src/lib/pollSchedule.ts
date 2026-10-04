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
// y-m-d hour:00. Two passes so it stays right across a DST changeover.
function zonedWallTimeToDate(y: number, m: number, d: number, hour: number): Date {
  const target = Date.UTC(y, m - 1, d, hour);
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
