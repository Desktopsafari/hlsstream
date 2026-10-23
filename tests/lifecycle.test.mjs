import test from "node:test";
import {
  ET, byId, check, closeNow, cronClose, cronOpen, db, emails, fresh, load, openNowRoute, openPolls,
  optionsOf, publicPoll, queue, routes, scheduledPolls,
} from "./support/helpers.mjs";

const life = { ...(await load("lib/pollClose.ts")), ...(await load("lib/pollOpen.ts")) };

function addPollWithOptions(fake, fields, labels = ["a", "b"]) {
  const poll = fake.addPoll(fields);
  labels.forEach((l, i) => fake.addOption(poll.id, l, i));
  return poll;
}

test("closing a poll: results email exactly once, and the close is atomic", async () => {
  const fake = await fresh();
  const P = addPollWithOptions(fake, { question: "TEST once", status: "open", opens_at: ET(2026, 10, 15, 12, 30).toISOString() });
  fake.addVote(P.id, optionsOf(P.id)[0].id, "s1");
  const t = ET(2026, 10, 15, 20, 30);
  const first = await cronClose(t);
  check("8 PM job closes it and says so", first.body.message === "Poll closed and results emailed.", JSON.stringify(first));
  check("one email, with the tallies", emails().length === 1 && emails()[0].question === "TEST once" && emails()[0].options.find((o) => o.label === "a").vote_count === 1);
  check("closes_at records the real close time", byId(P.id).status === "closed" && byId(P.id).closes_at === t.toISOString());
  const second = await cronClose(ET(2026, 10, 15, 20, 40));
  check("running the job again does nothing", /No open poll/.test(second.body.message) && emails().length === 1);
  // Two things closing it at the same instant: one wins.
  const Q = addPollWithOptions(fake, { question: "TEST race", status: "open", opens_at: ET(2026, 10, 16, 12, 30).toISOString() });
  const outcomes = await Promise.all([
    life.closePollAndFinish(fake, { id: Q.id, question: "TEST race", repeat_daily: false }),
    life.closePollAndFinish(fake, { id: Q.id, question: "TEST race", repeat_daily: false }),
  ]);
  check("two simultaneous closes: exactly one closes it", outcomes.filter((o) => o.state === "closed").length === 1 && outcomes.filter((o) => o.state === "already_closed").length === 1);
  check("...and only one more email", emails().length === 2);
});

test("repeat-daily: closing a repeating poll queues tomorrow's copy", async () => {
  const fake = await fresh();
  const R = addPollWithOptions(fake, { question: "TEST repeat", status: "open", repeat_daily: true, opens_at: ET(2026, 10, 15, 12, 30).toISOString() }, ["Cricket", "Mealworm"]);
  const out = await cronClose(ET(2026, 10, 15, 20, 30));
  const copy = scheduledPolls()[0];
  check("job says it queued tomorrow's repeat", /Queued as tomorrow's repeat/.test(out.body.message), JSON.stringify(out));
  check("the copy is a queued repeating poll with the same question", copy.question === "TEST repeat" && copy.repeat_daily === true);
  check("with the same options", optionsOf(copy.id).map((o) => o.label).join() === "Cricket,Mealworm");
  check("the original is not paused", byId(R.id).repeat_paused === false);
  const noon = await cronOpen(ET(2026, 10, 16, 12, 30));
  check("next noon the copy opens", noon.body.message === "Poll opened." && byId(copy.id).status === "open");
});

test("a poll queued by hand beats a repeating poll (the repeat is paused)", async () => {
  const fake = await fresh();
  const R = addPollWithOptions(fake, { question: "TEST repeat R", status: "open", repeat_daily: true, opens_at: ET(2026, 10, 15, 12, 30).toISOString() });
  const Q = addPollWithOptions(fake, { question: "TEST manual Q" });
  const out = await cronClose(ET(2026, 10, 15, 20, 30));
  check("the job reports the pause", /repeat was paused/.test(out.body.message), JSON.stringify(out));
  check("R is marked paused and no copy was queued", byId(R.id).repeat_paused === true && scheduledPolls().length === 1 && scheduledPolls()[0].id === Q.id);
  const noon = await cronOpen(ET(2026, 10, 16, 12, 30));
  check("the manual poll opens next", byId(Q.id).status === "open" && noon.body.message === "Poll opened.");
});

test("the queue only holds one poll: a second 'Queue poll' is refused", async () => {
  const fake = await fresh();
  addPollWithOptions(fake, { question: "TEST already queued" });
  const res = await queue(ET(2026, 10, 15, 11), { question: "TEST second", options: ["a", "b"] });
  check("409 with the explanation", res.status === 409 && /already a scheduled poll/.test(res.body.error), JSON.stringify(res));
  check("nothing was created", scheduledPolls().length === 1);
});

test("noon job: opens the queued poll; never on top of a poll still taking votes", async () => {
  const fake = await fresh();
  const Q = addPollWithOptions(fake, { question: "TEST queued for noon" });
  const open = await cronOpen(ET(2026, 10, 15, 12, 30));
  check("opens the queued poll", open.body.message === "Poll opened." && byId(Q.id).status === "open" && byId(Q.id).opens_at === ET(2026, 10, 15, 12, 30).toISOString());
  const Q2 = addPollWithOptions(fake, { question: "TEST second queued" });
  const skip = await cronOpen(ET(2026, 10, 15, 12, 45));
  check("a poll is already open: the queued one waits", /already open/.test(skip.body.message) && byId(Q2.id).status === "scheduled");
  const none = await fresh();
  const empty = await cronOpen(ET(2026, 10, 15, 12, 30));
  check("nothing queued: says so", empty.body.message === "No scheduled poll to open.");
  void none;
});

test("jobs refuse requests without the secret", async () => {
  await fresh();
  const open = await (await routes.cronOpen()).GET(new Request("http://localhost/api/cron/open-poll"));
  const close = await (await routes.cronClose()).GET(new Request("http://localhost/api/cron/close-poll"));
  check("401 for both", open.status === 401 && close.status === 401);
});

test("legacy behaviour kept: the close job closes a normal poll whenever it runs; the noon job leaves a stale normal poll alone", async () => {
  const fake = await fresh();
  const P = addPollWithOptions(fake, { question: "TEST early", status: "open", opens_at: ET(2026, 10, 15, 12, 30).toISOString() });
  const early = await cronClose(ET(2026, 10, 15, 19, 10));
  check("closed even though it is only 7:10 PM", early.body.message === "Poll closed and results emailed." && byId(P.id).status === "closed");

  await fresh();
  const stale = addPollWithOptions(db(), { question: "TEST stale", status: "open", opens_at: ET(2026, 10, 14, 12, 30).toISOString() });
  const Q = addPollWithOptions(db(), { question: "TEST q" });
  const noon = await cronOpen(ET(2026, 10, 15, 12, 30));
  check("opens the queued poll without closing or emailing the stale normal one", noon.body.message === "Poll opened." && byId(Q.id).status === "open" && byId(stale.id).status === "open" && emails().length === 0);
});

test("Open now: allowed before 8 PM, refused after, opens at the current moment", async () => {
  const fake = await fresh();
  const X = addPollWithOptions(fake, { question: "TEST X" });
  const late = await life.openPollNow(fake, { pollId: X.id, confirmReplace: false, now: ET(2026, 10, 15, 21) });
  check("after 8 PM: refused, poll untouched", !late.ok && late.code === "past_cutoff" && byId(X.id).status === "scheduled");
  const ok = await life.openPollNow(fake, { pollId: X.id, confirmReplace: false, now: ET(2026, 10, 15, 11) });
  check("before 8 PM: opens, opens_at = now, cutoff = today 8 PM", ok.ok && byId(X.id).status === "open" && byId(X.id).opens_at === ET(2026, 10, 15, 11).toISOString());
  check("no email for a plain open", emails().length === 0);
  const again = await life.openPollNow(fake, { pollId: X.id, confirmReplace: false, now: ET(2026, 10, 15, 11) });
  check("an already-open poll can't be opened again", !again.ok && again.code === "not_scheduled");
  const info = await life.getOpenNowInfo(fake, { now: ET(2026, 10, 15, 15, 11) });
  check("the panel's duration line", info.message === "Voting will be open for 4 hours 49 minutes today (until 8:00 PM ET).", info.message);
});

test("Open now replacing an open poll: confirmation needed, one email, repeat carried forward", async () => {
  const fake = await fresh();
  const O = addPollWithOptions(fake, { question: "TEST O", status: "open", repeat_daily: true, opens_at: ET(2026, 10, 15, 12, 10).toISOString() }, ["Cricket", "Mealworm"]);
  fake.addVote(O.id, optionsOf(O.id)[0].id, "s1");
  fake.addVote(O.id, optionsOf(O.id)[0].id, "s2");
  const X = addPollWithOptions(fake, { question: "TEST X" });
  const now = ET(2026, 10, 15, 15);
  const info = await life.getOpenNowInfo(fake, { pollId: X.id, now });
  check("the panel names the open poll, its votes and what happens to its repeat", info.openPoll?.votes === 2 && info.openPoll.repeatOutcome === "queue_copy");
  const noConfirm = await life.openPollNow(fake, { pollId: X.id, confirmReplace: false, now });
  check("without confirmation: refused, nothing changed", !noConfirm.ok && noConfirm.code === "confirm_replace" && byId(O.id).status === "open" && emails().length === 0);
  const res = await life.openPollNow(fake, { pollId: X.id, confirmReplace: true, now });
  check("with confirmation: replaced", res.ok && byId(X.id).status === "open" && byId(O.id).status === "closed" && openPolls().length === 1);
  check("the old poll's votes are kept", db().db.votes.filter((v) => v.poll_id === O.id).length === 2);
  check("its results email went out once, with its tallies", emails().length === 1 && emails()[0].options.find((o) => o.label === "Cricket").vote_count === 2);
  const copy = scheduledPolls().find((p) => p.question === "TEST O");
  check("tomorrow's copy of the repeating poll is queued", !!copy && copy.repeat_daily === true);
  const cronAgain = await life.closePollAndFinish(fake, { id: O.id, question: "TEST O", repeat_daily: true });
  check("the 8 PM job later finds it already closed: no second email or copy", cronAgain.state === "already_closed" && emails().length === 1 && scheduledPolls().length === 1);
});

test("Open now when a different poll is queued: repeat pauses behind it; stale open polls are closed without a prompt", async () => {
  const fake = await fresh();
  const O = addPollWithOptions(fake, { question: "TEST R2", status: "open", repeat_daily: true, opens_at: ET(2026, 10, 15, 12, 5).toISOString() });
  const X = addPollWithOptions(fake, { question: "TEST X2" });
  const Q = addPollWithOptions(fake, { question: "TEST queued Q2", created_at: new Date(Date.now() + 1000).toISOString() });
  const info = await life.getOpenNowInfo(fake, { pollId: X.id, now: ET(2026, 10, 15, 15) });
  check("info predicts the pause", info.openPoll?.repeatOutcome === "pause" && info.queued?.id === Q.id);
  const r = await life.openPollNow(fake, { pollId: X.id, confirmReplace: true, now: ET(2026, 10, 15, 15) });
  check("repeat paused, no extra copy", r.ok && byId(O.id).repeat_paused === true && scheduledPolls().length === 1);

  await fresh();
  const stale = addPollWithOptions(db(), { question: "TEST stale", status: "open", opens_at: ET(2026, 10, 14, 12, 5).toISOString() });
  const Y = addPollWithOptions(db(), { question: "TEST Y" });
  const r2 = await life.openPollNow(db(), { pollId: Y.id, confirmReplace: false, now: ET(2026, 10, 15, 11) });
  check("a stale open poll needs no confirmation; it is closed and emailed once", r2.ok && byId(stale.id).status === "closed" && emails().length === 1 && openPolls().length === 1);
});

test("Open now is safe against double clicks and simultaneous opens", async () => {
  const fake = await fresh();
  const X = addPollWithOptions(fake, { question: "TEST dbl" });
  const now = ET(2026, 10, 15, 11);
  const [a, b] = await Promise.all([
    life.openPollNow(fake, { pollId: X.id, confirmReplace: false, now }),
    life.openPollNow(fake, { pollId: X.id, confirmReplace: false, now }),
  ]);
  check("two clicks on one poll: exactly one opens it", [a, b].filter((r) => r.ok).length === 1 && openPolls().length === 1);

  let worst = 0;
  for (let i = 0; i < 10; i++) {
    const f = await fresh();
    const A = addPollWithOptions(f, { question: "TEST A" });
    const B = addPollWithOptions(f, { question: "TEST B" });
    await Promise.all([
      life.openPollNow(f, { pollId: A.id, confirmReplace: true, now }),
      life.openPollNow(f, { pollId: B.id, confirmReplace: true, now }),
    ]);
    worst = Math.max(worst, openPolls().length);
    check("no emails from a collision", emails().length === 0);
  }
  check("two different polls opened at once: never more than one open", worst <= 1, `worst=${worst}`);

  const f2 = await fresh();
  const A = addPollWithOptions(f2, { question: "TEST A2" });
  const B = addPollWithOptions(f2, { question: "TEST B2" });
  await life.openPollNow(f2, { pollId: A.id, confirmReplace: true, now });
  const second = await life.openPollNow(f2, { pollId: B.id, confirmReplace: true, now: new Date(now.getTime() + 3000) });
  check("a second open within seconds is refused", !second.ok && second.code === "just_opened" && openPolls().length === 1);
});

test("Open now through the admin route: form polls, confirmation, past-8-PM refusal creates nothing", async () => {
  const fake = await fresh();
  const past = await openNowRoute(ET(2026, 10, 15, 21), { question: "TEST late", options: ["a", "b"] });
  check("after 8 PM: 409, nothing created", past.status === 409 && past.body.code === "past_cutoff" && db().db.polls.length === 0);

  const O = addPollWithOptions(fake, { question: "TEST live", status: "open", opens_at: ET(2026, 10, 15, 12, 5).toISOString() });
  const need = await openNowRoute(ET(2026, 10, 15, 15), { question: "TEST form", options: ["a", "b"] });
  check("over an open poll: 409 confirm_replace, nothing created", need.status === 409 && need.body.code === "confirm_replace" && db().db.polls.length === 1);
  const done = await openNowRoute(ET(2026, 10, 15, 15), { question: "TEST form", options: ["a", "b"], confirmReplace: true });
  check("confirmed: the new poll is open, the old one closed and emailed once", done.status === 200 && openPolls().length === 1 && openPolls()[0].question === "TEST form" && byId(O.id).status === "closed" && emails().length === 1);
  const closeJob = await cronClose(ET(2026, 10, 15, 20, 30));
  check("the 8 PM job then closes the early-opened poll", /closed and results emailed/i.test(closeJob.body.message) && emails().length === 2);
  const pub = await publicPoll(ET(2026, 10, 15, 21));
  check("the public card shows the latest closed poll", pub.body.poll.question === "TEST form" && pub.body.poll.status === "closed");
});

test("Close now: closes once, emails once; a second click is refused", async () => {
  const fake = await fresh();
  const P = addPollWithOptions(fake, { question: "TEST close now", status: "open", opens_at: ET(2026, 10, 15, 12, 5).toISOString() });
  const [a, b] = await Promise.all([closeNow(ET(2026, 10, 15, 14), P.id), closeNow(ET(2026, 10, 15, 14), P.id)]);
  const statuses = [a.status, b.status].sort();
  check("one 200 and one 409", statuses[0] === 200 && statuses[1] === 409, JSON.stringify([a, b]));
  check("one email", emails().length === 1);
  check("closes_at is the click time", byId(P.id).closes_at === ET(2026, 10, 15, 14).toISOString());
  check("closing a closed poll is refused", (await closeNow(ET(2026, 10, 15, 14, 5), P.id)).status === 409);
});
