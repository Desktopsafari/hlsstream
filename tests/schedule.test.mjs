import test from "node:test";
import { ET, check, load } from "./support/helpers.mjs";

const sched = await load("lib/pollSchedule.ts");
const dur = await load("lib/pollDuration.ts");

test("the 8:00 PM ET cutoff: the first 8 PM after a poll opened", () => {
  const end = (opens) => sched.getPollEnd({ opens_at: opens.toISOString() });
  check("opened at noon -> that evening 8 PM EDT (00:00Z next day)", end(ET(2026, 10, 15, 12, 30)).toISOString() === "2026-10-16T00:00:00.000Z");
  check("opened at 8:30 PM -> the NEXT day's 8 PM", end(ET(2026, 10, 15, 20, 30)).toISOString() === "2026-10-17T00:00:00.000Z");
  const poll = { opens_at: ET(2026, 10, 15, 12, 30).toISOString() };
  check("7:59:59 PM: still open", sched.isPollPastEnd(poll, new Date(ET(2026, 10, 15, 20).getTime() - 1000)) === false);
  check("8:00:00 PM: past the end", sched.isPollPastEnd(poll, ET(2026, 10, 15, 20)) === true);
});

test("the cutoff stays 8 PM local across the November clock change", () => {
  // A poll opened at noon on Nov 1 (EST) ends at 8 PM EST = 01:00Z.
  const poll = { opens_at: ET(2026, 11, 1, 12).toISOString() };
  check("Nov 1 poll ends 01:00Z", sched.getPollEnd(poll).toISOString() === "2026-11-02T01:00:00.000Z");
  // A poll opened Oct 31 (EDT) ends 00:00Z.
  check("Oct 31 poll ends 00:00Z", sched.getPollEnd({ opens_at: ET(2026, 10, 31, 12).toISOString() }).toISOString() === "2026-11-01T00:00:00.000Z");
});

test("Open now window: allowed until 8 PM ET, refused after", () => {
  const at = (h, m) => sched.getOpenNowWindow(ET(2026, 10, 15, h, m));
  check("11:00 AM allowed", at(11, 0).allowed === true);
  check("11:00 AM -> 9 hours", sched.formatDuration(at(11, 0).msLeft) === "9 hours");
  check("3:11 PM -> 4 hours 49 minutes", sched.formatDuration(at(15, 11).msLeft) === "4 hours 49 minutes");
  check("7:59 PM allowed, 1 minute", at(19, 59).allowed && sched.formatDuration(at(19, 59).msLeft) === "1 minute");
  check("8:00 PM refused", at(20, 0).allowed === false);
  check("11:30 PM refused", at(23, 30).allowed === false);
  check("12:15 AM allowed", at(0, 15).allowed === true);
  check("cutoff is 8 PM ET today", at(15, 0).cutoff.toISOString() === "2026-10-16T00:00:00.000Z");
});

test("duration rules: 2-30 days, specific end, open-ended; invalid choices refused", () => {
  const now = ET(2026, 10, 15, 11, 0);
  const noon = sched.getNextNoon(now);
  const d = (x) => dur.resolveDuration(x, noon, now);
  check("next noon from 11 AM is today noon", noon.toISOString() === ET(2026, 10, 15, 12).toISOString());
  check("next noon from 1 PM is tomorrow noon", sched.getNextNoon(ET(2026, 10, 15, 13)).toISOString() === ET(2026, 10, 16, 12).toISOString());
  check("no duration = normal daily poll", dur.isDailyColumns(d(undefined).columns) && dur.isDailyColumns(d({ mode: "today" }).columns));
  check("1 and 31 days refused", !d({ mode: "days", days: 1 }).ok && !d({ mode: "days", days: 31 }).ok);
  check("2 and 30 days accepted", d({ mode: "days", days: 2 }).ok && d({ mode: "days", days: 30 }).ok);
  check("fractional days refused", !d({ mode: "days", days: 2.5 }).ok);
  check("end in the past refused", !d({ mode: "until", until: "2026-10-15T09:00" }).ok);
  check("end before the poll opens refused", !d({ mode: "until", until: "2026-10-15T11:30" }).ok);
  check("a valid end is stored as the exact UTC instant", d({ mode: "until", until: "2026-10-17T15:30" }).columns?.ends_at === "2026-10-17T19:30:00.000Z");
  check("open-ended accepted", d({ mode: "open" }).columns?.open_ended === true);
  check("garbage refused", !d({ mode: "weekly" }).ok);
});

test("end times are exact across daylight saving", () => {
  check("3 days from Oct 15 noon ends Oct 17 8 PM EDT", sched.getDaysPollEnd(ET(2026, 10, 15, 12), 3).toISOString() === "2026-10-18T00:00:00.000Z");
  check("3 days from Oct 31 noon ends Nov 2 8 PM EST", sched.getDaysPollEnd(ET(2026, 10, 31, 12), 3).toISOString() === "2026-11-03T01:00:00.000Z");
  check("'Nov 1 8:00 PM' typed in Eastern is 01:00Z", sched.parseEasternDateTime("2026-11-01T20:00").toISOString() === "2026-11-02T01:00:00.000Z");
  check("'Oct 31 8:00 PM' typed in Eastern is 00:00Z", sched.parseEasternDateTime("2026-10-31T20:00").toISOString() === "2026-11-01T00:00:00.000Z");
  const p = { opens_at: "2026-10-31T16:00:00Z", ends_at: "2026-11-02T01:00:00Z" };
  check("one second before the end: open; at the end: past", sched.isPollPastEnd(p, new Date("2026-11-02T00:59:59Z")) === false && sched.isPollPastEnd(p, new Date("2026-11-02T01:00:00Z")) === true);
  check("open-ended never ends", sched.isPollPastEnd({ opens_at: "2020-01-01T00:00:00Z", open_ended: true }, new Date("2030-01-01T00:00:00Z")) === false);
});

test("admin summary, public wording and the email note", () => {
  const now = ET(2026, 10, 15, 11, 0);
  const col = (x) => dur.resolveDuration(x, sched.getNextNoon(now), now).columns;
  check("3 days", dur.describeSchedule(col({ mode: "days", days: 3 }), { now }) === "Opens Thu 12:00 PM ET, voting ends Sat 8:00 PM ET (about 3 days).");
  check("today only", dur.describeSchedule(col({ mode: "today" }), { now }) === "Opens Thu 12:00 PM ET, voting ends Thu 8:00 PM ET (about 8 hours).");
  check("open-ended", /stays open until you close it/.test(dur.describeSchedule(col({ mode: "open" }), { now })));
  check("Open now", dur.describeSchedule(col({ mode: "days", days: 3 }), { now, openNow: true }).startsWith("Opens now, voting ends Sat 8:00 PM ET"));
  check("deadline wording", dur.publicDeadline({ ends_at: "2026-10-18T00:00:00Z" }, now) === "Voting open until Saturday 8:00 PM ET");
  check("open-ended wording", dur.publicDeadline({ open_ended: true }) === "Voting open until we close it");
  check("normal poll: no deadline line", dur.publicDeadline({ ends_at: null, open_ended: false }) === null);
  check("email note only off the 8 PM cutoff", dur.emailNoteFor(ET(2026, 10, 17, 20)) === null && !!dur.emailNoteFor(ET(2026, 10, 17, 15, 30)) && dur.emailNoteFor(null) === null);
});
