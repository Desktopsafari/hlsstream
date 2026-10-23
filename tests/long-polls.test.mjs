import test from "node:test";
import {
  ET, byId, check, closeNow, cronClose, cronOpen, db, emails, fresh, load, openNowRoute, openPolls,
  optionsOf, publicPoll, queue, req, routes, scheduledPolls, setEnd, vote, withNow, json,
} from "./support/helpers.mjs";

const life = await load("lib/pollLifecycle.ts");

function addPollWithOptions(fake, fields, labels = ["a", "b"]) {
  const poll = fake.addPoll(fields);
  labels.forEach((l, i) => fake.addOption(poll.id, l, i));
  return poll;
}

test("a 3-day poll: votes on days 1-3, refused after the end, jobs leave it alone, email once", async () => {
  const fake = await fresh();
  const R = addPollWithOptions(fake, { question: "TEST daily R", status: "open", repeat_daily: true, opens_at: ET(2026, 10, 14, 12, 20).toISOString() });
  const made = await queue(ET(2026, 10, 14, 15), { question: "TEST 3-day L", options: ["Cricket", "Mealworm"], duration: { mode: "days", days: 3 } });
  const L = db().db.polls.find((p) => p.question === "TEST 3-day L");
  check("queued", made.status === 200 && L.duration_days === 3 && L.ends_at === null && L.repeat_daily === false);
  const [cricket] = optionsOf(L.id);

  const c0 = await cronClose(ET(2026, 10, 14, 20, 30));
  check("evening job closes the daily poll and emails it", /closed and results emailed/i.test(c0.body.message) && emails().length === 1);
  check("the poll queued by hand wins: the daily poll is paused, no copy", byId(R.id).repeat_paused === true && scheduledPolls().length === 1);

  const o1 = await cronOpen(ET(2026, 10, 15, 12, 30));
  check("noon job opens it", o1.body.message === "Poll opened." && byId(L.id).status === "open");
  check("end = Sat Oct 17 8:00 PM EDT", byId(L.id).ends_at === "2026-10-18T00:00:00.000Z");
  const pub = await publicPoll(ET(2026, 10, 15, 13));
  check("public API carries the deadline", pub.body.poll.ends_at === "2026-10-18T00:00:00.000Z" && pub.body.poll.open_ended === false && pub.body.poll.status === "open");

  check("day 1 vote accepted", (await vote(ET(2026, 10, 15, 14), L.id, cricket.id, "s1")).status === 200);
  const d1 = await cronClose(ET(2026, 10, 15, 20, 30));
  check("day 1 evening job leaves it open", /still running/.test(d1.body.message) && byId(L.id).status === "open" && emails().length === 1);
  check("day 2: duplicate vote refused", (await vote(ET(2026, 10, 16, 9), L.id, cricket.id, "s1")).status === 409);
  check("day 2: new voter accepted", (await vote(ET(2026, 10, 16, 10), L.id, cricket.id, "s2")).status === 200);

  const Q = addPollWithOptions(fake, { question: "TEST manual Q", created_at: ET(2026, 10, 16, 11).toISOString() });
  const n2 = await cronOpen(ET(2026, 10, 16, 12, 30));
  check("day 2 noon: the queued poll is NOT opened over it", /already open/.test(n2.body.message) && byId(Q.id).status === "scheduled" && openPolls()[0].id === L.id);
  check("day 2 evening job leaves it open; the card still says open past 8 PM", /still running/.test((await cronClose(ET(2026, 10, 16, 20, 30))).body.message) && (await publicPoll(ET(2026, 10, 16, 21))).body.poll.status === "open");

  check("day 3 noon: still waiting", /already open/.test((await cronOpen(ET(2026, 10, 17, 12, 30))).body.message));
  check("day 3 7:59 PM: accepted", (await vote(ET(2026, 10, 17, 19, 59), L.id, cricket.id, "s3")).status === 200);
  const refused = await vote(ET(2026, 10, 17, 20, 0), L.id, cricket.id, "s4");
  check("day 3 8:00 PM: refused though the job hasn't run", refused.status === 400 && byId(L.id).status === "open");
  check("the card reports it closed", (await publicPoll(ET(2026, 10, 17, 20, 1))).body.poll.status === "closed");

  const end = await cronClose(ET(2026, 10, 17, 20, 30));
  check("evening job closes it: one email with 3 votes", /closed and results emailed/i.test(end.body.message) && emails().length === 2 && emails()[1].options.find((o) => o.label === "Cricket").vote_count === 3);
  check("real close time recorded", byId(L.id).closes_at === ET(2026, 10, 17, 20, 30).toISOString());
  await cronClose(ET(2026, 10, 17, 20, 40));
  await cronClose(ET(2026, 10, 18, 20, 30));
  check("later runs never email it again", emails().length === 2);
  check("the queued manual poll kept the slot; the daily poll stays paused", byId(Q.id).status === "scheduled" && byId(R.id).repeat_paused === true && scheduledPolls().length === 1);
  check("next noon the manual poll opens", (await cronOpen(ET(2026, 10, 18, 12, 30))).body.message === "Poll opened." && byId(Q.id).status === "open");
});

test("a paused daily poll resumes when the long poll closes (nothing queued meanwhile)", async () => {
  const fake = await fresh();
  const R = addPollWithOptions(fake, { question: "TEST daily R2", status: "open", repeat_daily: true, opens_at: ET(2026, 10, 14, 12, 20).toISOString() }, ["a", "b"]);
  await queue(ET(2026, 10, 14, 15), { question: "TEST 3-day L2", options: ["x", "y"], duration: { mode: "days", days: 3 } });
  const L = db().db.polls.find((p) => p.question === "TEST 3-day L2");
  await cronClose(ET(2026, 10, 14, 20, 30));
  await cronOpen(ET(2026, 10, 15, 12, 30));
  for (const d of [15, 16, 17]) {
    await cronOpen(ET(2026, 10, d, 12, 40));
    if (d < 17) await cronClose(ET(2026, 10, d, 20, 30));
  }
  check("through days 1-3 the daily poll stayed paused and nothing else opened", byId(R.id).repeat_paused === true && openPolls().length === 1 && scheduledPolls().length === 0);
  const end = await cronClose(ET(2026, 10, 17, 20, 30));
  const copy = scheduledPolls()[0];
  check("closing the long poll queues a copy of the daily poll", !!copy && copy.question === "TEST daily R2" && copy.repeat_daily === true && /resume/i.test(end.body.message));
  check("the paused marker is cleared and the options copied", byId(R.id).repeat_paused === false && optionsOf(copy.id).map((o) => o.label).join() === "a,b");
  check("one email for the long poll", emails().filter((e) => e.question === "TEST 3-day L2").length === 1 && byId(L.id).status === "closed");
  const back = await cronOpen(ET(2026, 10, 18, 12, 30));
  check("next noon the daily poll is back as a normal daily poll", back.body.message === "Poll opened." && byId(copy.id).ends_at === null && !byId(copy.id).open_ended);
  const evening = await cronClose(ET(2026, 10, 18, 20, 30));
  check("and it behaves normally: closed at 8 PM, tomorrow's copy queued", /Queued/.test(evening.body.message));
});

test("an open-ended poll stays open for days; Close now ends it once; the queue waits", async () => {
  const fake = await fresh();
  const R = addPollWithOptions(fake, { question: "TEST daily R3", status: "open", repeat_daily: true, opens_at: ET(2026, 10, 15, 12, 10).toISOString() });
  const info = await withNow(ET(2026, 10, 15, 15), async () =>
    json(await (await routes.openNow()).GET(req("GET", `/api/admin/polls/open-now?duration=${encodeURIComponent(JSON.stringify({ mode: "open" }))}`))),
  );
  check("panel text", info.body.allowed && /stay open until you close it/.test(info.body.message) && info.body.openPoll?.repeatOutcome === "pause_for_long");
  const need = await openNowRoute(ET(2026, 10, 15, 15), { question: "TEST open-ended O", options: ["yes", "no"], duration: { mode: "open" } });
  check("replacing the daily poll needs confirmation, nothing created", need.status === 409 && db().db.polls.length === 1);
  const opened = await openNowRoute(ET(2026, 10, 15, 15), { question: "TEST open-ended O", options: ["yes", "no"], duration: { mode: "open" }, confirmReplace: true });
  const O = db().db.polls.find((p) => p.question === "TEST open-ended O");
  check("opened; the daily poll is closed, emailed once and PAUSED (no copy)", opened.status === 200 && O.open_ended === true && byId(R.id).repeat_paused === true && emails().length === 1 && scheduledPolls().length === 0);
  const [yes] = optionsOf(O.id);
  let ok = true;
  for (let d = 16; d <= 21; d++) {
    await cronOpen(ET(2026, 10, d, 12, 30));
    await cronClose(ET(2026, 10, d, 20, 30));
    const v = await vote(ET(2026, 10, d, 21), O.id, yes.id, `day${d}`);
    if (byId(O.id).status !== "open" || v.status !== 200 || emails().length !== 1) ok = false;
  }
  check("6 days: stays open, every vote (even 9 PM) accepted, no email", ok);
  const Q = addPollWithOptions(fake, { question: "TEST waits Q" });
  await cronOpen(ET(2026, 10, 22, 12, 30));
  check("a queued poll keeps waiting", byId(Q.id).status === "scheduled" && byId(O.id).status === "open");
  const [c1, c2] = await Promise.all([closeNow(ET(2026, 10, 22, 14), O.id), closeNow(ET(2026, 10, 22, 14), O.id)]);
  check("Close now double click: one succeeds", [c1.status, c2.status].sort().join() === "200,409");
  check("one email at close, with 6 votes", emails().length === 2 && emails()[1].options.find((o) => o.label === "yes").vote_count === 6);
  check("the manual queue won: the daily poll stays paused", byId(R.id).repeat_paused === true && byId(Q.id).status === "scheduled");
  check("a vote after Close now is refused", (await vote(ET(2026, 10, 22, 15), O.id, yes.id, "late")).status === 400);
});

test("Close now with nothing queued resumes the paused daily poll", async () => {
  const fake = await fresh();
  const R = addPollWithOptions(fake, { question: "TEST daily R4", status: "open", repeat_daily: true, opens_at: ET(2026, 10, 15, 12, 10).toISOString() });
  await openNowRoute(ET(2026, 10, 15, 15), { question: "TEST open-ended O2", options: ["yes", "no"], duration: { mode: "open" }, confirmReplace: true });
  const O = db().db.polls.find((p) => p.question === "TEST open-ended O2");
  const r = await closeNow(ET(2026, 10, 19, 10), O.id);
  const copy = scheduledPolls()[0];
  check("copy queued, marker cleared", r.status === 200 && /resume/i.test(r.body.message) && copy?.question === "TEST daily R4" && byId(R.id).repeat_paused === false);
});

test("Change end time: extend/shorten, never into the past; the noon job closes an ended poll", async () => {
  const fake = await fresh();
  const L = addPollWithOptions(fake, { question: "TEST until U", status: "open", opens_at: ET(2026, 10, 15, 12, 5).toISOString(), ends_at: ET(2026, 10, 17, 20).toISOString() });
  const a = optionsOf(L.id)[0];
  check("past: refused", (await setEnd(ET(2026, 10, 15, 14), L.id, "2026-10-15T13:00")).status === 400 && byId(L.id).ends_at === ET(2026, 10, 17, 20).toISOString());
  check("garbage refused", (await setEnd(ET(2026, 10, 15, 14), L.id, "not a date")).status === 400);
  const ext = await setEnd(ET(2026, 10, 15, 14), L.id, "2026-10-19T15:15");
  check("extended; off-8PM end carries an email note", ext.status === 200 && byId(L.id).ends_at === ET(2026, 10, 19, 15, 15).toISOString() && !!ext.body.emailNote);
  const dbl = await Promise.all([setEnd(ET(2026, 10, 15, 14), L.id, "2026-10-19T15:15"), setEnd(ET(2026, 10, 15, 14), L.id, "2026-10-19T15:15")]);
  check("double click harmless", dbl.every((r) => r.status === 200));
  check("an 8:00 PM end has no note", (await setEnd(ET(2026, 10, 15, 14), L.id, "2026-10-19T20:00")).body.emailNote === null);
  await setEnd(ET(2026, 10, 15, 14), L.id, "2026-10-19T15:15");
  check("vote on the old end day accepted", (await vote(ET(2026, 10, 18, 11), L.id, a.id, "e1")).status === 200);
  check("old 8 PM end passes; job leaves it open", /still running/.test((await cronClose(ET(2026, 10, 17, 20, 30))).body.message));
  const shorten = await setEnd(ET(2026, 10, 18, 14), L.id, "2026-10-18T18:00");
  check("shortened", shorten.status === 200);
  check("after the shortened end: refused; just before: accepted", (await vote(ET(2026, 10, 18, 18, 1), L.id, a.id, "e2")).status === 400 && (await vote(ET(2026, 10, 18, 17, 59), L.id, a.id, "e3")).status === 200);
  const Q = addPollWithOptions(fake, { question: "TEST next Q" });
  check("noon job before the end: leaves it, queue waits", /already open/.test((await cronOpen(ET(2026, 10, 18, 12, 30))).body.message));
  const eve = await cronClose(ET(2026, 10, 18, 20, 30));
  check("evening job closes it, one email", /closed and results emailed/i.test(eve.body.message) && emails().length === 1);
  await cronClose(ET(2026, 10, 18, 20, 40));
  check("never twice", emails().length === 1);
  check("closed poll: end time can't change", (await setEnd(ET(2026, 10, 18, 21), L.id, "2026-10-20T12:00")).status === 409);
  void Q;
});

test("email timing: an end off the 8 PM cutoff is emailed by the next evening or noon job", async () => {
  const fake = await fresh();
  const M = addPollWithOptions(fake, { question: "TEST ends 9am", status: "open", opens_at: ET(2026, 10, 15, 12, 5).toISOString(), ends_at: ET(2026, 10, 17, 9).toISOString() });
  const Q = addPollWithOptions(fake, { question: "TEST q2" });
  const noon = await cronOpen(ET(2026, 10, 17, 12, 30));
  check("noon job closes the ended poll (email ~3.5 h after the end), then opens the queued poll", byId(M.id).status === "closed" && emails().length === 1 && byId(Q.id).status === "open" && /Closed the ended poll/.test(noon.body.message));
  await cronClose(ET(2026, 10, 17, 20, 30));
  check("the evening job doesn't email it again", emails().filter((e) => e.question === "TEST ends 9am").length === 1);

  await fresh();
  const N = addPollWithOptions(db(), { question: "TEST ends 8:01pm", status: "open", opens_at: ET(2026, 10, 15, 12, 5).toISOString(), ends_at: ET(2026, 10, 16, 20, 1).toISOString() });
  await cronClose(ET(2026, 10, 16, 20, 0));
  check("evening job firing a minute BEFORE the end leaves it open", byId(N.id).status === "open" && emails().length === 0);
  await cronOpen(ET(2026, 10, 17, 12, 59));
  check("the next noon job (about 17 h later) emails it", byId(N.id).status === "closed" && emails().length === 1);
});

test("validation: repeat vs long durations, editing a queued poll, options still lock", async () => {
  const fake = await fresh();
  const n = ET(2026, 10, 15, 11);
  check("repeat + multi-day refused", (await queue(n, { question: "TEST x", options: ["a", "b"], repeatDaily: true, duration: { mode: "days", days: 3 } })).status === 400 && db().db.polls.length === 0);
  check("repeat + open-ended refused", (await queue(n, { question: "TEST x", options: ["a", "b"], repeatDaily: true, duration: { mode: "open" } })).status === 400);
  const u = await queue(n, { question: "TEST until", options: ["a", "b"], duration: { mode: "until", until: "2026-10-17T15:30" } });
  check("'until' stored as the exact instant", u.status === 200 && db().db.polls[0].ends_at === ET(2026, 10, 17, 15, 30).toISOString());
  db().db.polls = []; db().db.poll_options = [];
  check("an end before it opens is refused", (await queue(n, { question: "TEST x", options: ["a", "b"], duration: { mode: "until", until: "2026-10-15T11:45" } })).status === 400);
  const daily = await queue(n, { question: "TEST plain daily", options: ["a", "b"], repeatDaily: true });
  const P = db().db.polls.find((p) => p.question === "TEST plain daily");
  check("no duration chosen: an ordinary repeating daily poll", daily.status === 200 && P.ends_at === null && P.open_ended === false && P.duration_days === null && P.repeat_daily === true);

  db().db.polls = []; db().db.poll_options = [];
  await queue(n, { question: "TEST edit me", options: ["a", "b"] });
  const E = db().db.polls[0];
  const put = (body) => withNow(n, async () => json(await (await routes.polls()).PUT(req("PUT", "/api/admin/polls", { pollId: E.id, question: "TEST edit me", ...body }))));
  check("set 4 days", (await put({ duration: { mode: "days", days: 4 } })).status === 200 && byId(E.id).duration_days === 4);
  check("repeat on while multi-day: refused", (await put({ repeatDaily: true })).status === 400);
  check("back to today only + repeat: ok", (await put({ duration: { mode: "today" }, repeatDaily: true })).status === 200 && byId(E.id).repeat_daily === true);
  byId(E.id).status = "open";
  check("an open poll's duration can't be edited there", (await put({ duration: { mode: "open" } })).status === 409);
  byId(E.id).status = "scheduled";
  const [o1, o2] = optionsOf(E.id);
  fake.addVote(E.id, o1.id, "z");
  const locked = await put({ options: [{ id: o1.id, label: "renamed" }, { id: o2.id, label: "b" }] });
  check("options lock once votes exist", locked.status === 409 && locked.body.code === "options_locked");
});

test("Open now for long polls: allowed after 8 PM; ended end times refused; normal polls still refused", async () => {
  const fake = await fresh();
  const X = addPollWithOptions(fake, { question: "TEST x3", duration_days: 3 });
  const r = await life.openPollNow(fake, { pollId: X.id, confirmReplace: false, now: ET(2026, 10, 15, 21, 30) });
  check("a 3-day poll opens at 9:30 PM, counted from today", r.ok && byId(X.id).ends_at === "2026-10-18T00:00:00.000Z");
  await fresh();
  const Y = addPollWithOptions(db(), { question: "TEST daily after 8" });
  const r2 = await life.openPollNow(db(), { pollId: Y.id, confirmReplace: false, now: ET(2026, 10, 15, 21, 30) });
  check("a normal poll is still refused after 8 PM", !r2.ok && r2.code === "past_cutoff");
  await fresh();
  const Z = addPollWithOptions(db(), { question: "TEST past end", ends_at: ET(2026, 10, 15, 9).toISOString() });
  const r3 = await life.openPollNow(db(), { pollId: Z.id, confirmReplace: false, now: ET(2026, 10, 15, 11) });
  check("an end that has passed: refused", !r3.ok && r3.code === "end_passed" && byId(Z.id).status === "scheduled");
  await fresh();
  const D = addPollWithOptions(db(), { question: "TEST dbl long", open_ended: true });
  const [a, b] = await Promise.all([
    life.openPollNow(db(), { pollId: D.id, confirmReplace: false, now: ET(2026, 10, 15, 11) }),
    life.openPollNow(db(), { pollId: D.id, confirmReplace: false, now: ET(2026, 10, 15, 11) }),
  ]);
  check("double click on a long poll: opens once", [a, b].filter((x) => x.ok).length === 1 && openPolls().length === 1);
  await fresh();
  const Lg = addPollWithOptions(db(), { question: "TEST running long", status: "open", opens_at: ET(2026, 10, 15, 12).toISOString(), ends_at: ET(2026, 10, 18, 20).toISOString() });
  const N = addPollWithOptions(db(), { question: "TEST new daily" });
  const info = await life.getOpenNowInfo(db(), { pollId: N.id, now: ET(2026, 10, 15, 14) });
  check("panel mentions the running poll's end", /voting ends Sunday 8:00 PM ET/.test(info.openPoll?.ends ?? ""));
  const noc = await life.openPollNow(db(), { pollId: N.id, confirmReplace: false, now: ET(2026, 10, 15, 14) });
  check("replacing it needs confirmation", !noc.ok && noc.code === "confirm_replace" && byId(Lg.id).status === "open");
});

test("without the duration columns the site behaves exactly as before", async () => {
  const fake = await fresh({ durationColumns: false });
  const W = addPollWithOptions(fake, { question: "TEST nocols", status: "open", opens_at: ET(2026, 10, 15, 12, 30).toISOString() });
  const [wo] = optionsOf(W.id);
  check("voting works and ends at 8 PM", (await vote(ET(2026, 10, 15, 19, 0), W.id, wo.id, "w1")).status === 200 && (await vote(ET(2026, 10, 15, 20, 1), W.id, wo.id, "w2")).status === 400);
  const adm = await (await routes.polls()).GET();
  check("admin list works, durationsSupported=false", adm.status === 200 && (await adm.json()).durationsSupported === false);
  const mk = await queue(ET(2026, 10, 15, 11), { question: "TEST nocols long", options: ["a", "b"], duration: { mode: "days", days: 3 } });
  check("a multi-day poll is refused with the SQL hint", mk.status === 400 && /poll_duration\.sql/.test(mk.body.error));
  db().db.polls = db().db.polls.filter((p) => p.id === W.id);
  check("a normal repeating poll can still be queued", (await queue(ET(2026, 10, 15, 11), { question: "TEST nocols plain", options: ["a", "b"], duration: { mode: "today" }, repeatDaily: true })).status === 200);
  const endr = await setEnd(ET(2026, 10, 15, 11), W.id, "2026-10-17T12:00");
  check("Change end time points to the SQL", endr.status === 400 && /poll_duration\.sql/.test(endr.body.error));
  check("Close now still works", (await closeNow(ET(2026, 10, 15, 14), W.id)).status === 200 && emails().length === 1);
  check("public API works", (await publicPoll(ET(2026, 10, 15, 21))).status === 200);
});
