import test from "node:test";
import { ET, check, byId, cronClose, db, emails, fresh, publicPoll, vote } from "./support/helpers.mjs";

// A normal daily poll, opened at 12:30 PM ET on Oct 15 2026.
async function normalPoll() {
  const fake = await fresh();
  const poll = fake.addPoll({ question: "TEST normal", status: "open", opens_at: ET(2026, 10, 15, 12, 30).toISOString() });
  const a = fake.addOption(poll.id, "a", 0);
  const b = fake.addOption(poll.id, "b", 1);
  return { fake, poll, a, b };
}

test("voting is enforced in code at 8:00 PM ET, even though the stored status is still open", async () => {
  const { poll, a } = await normalPoll();
  check("7:59 PM: accepted", (await vote(ET(2026, 10, 15, 19, 59), poll.id, a.id, "s1")).status === 200);
  const late = await vote(ET(2026, 10, 15, 20, 0), poll.id, a.id, "s2");
  check("8:00 PM: refused", late.status === 400 && /closed/i.test(late.body.error), JSON.stringify(late));
  check("the cron hasn't run, so the stored status is still open", byId(poll.id).status === "open");
  const pub = await publicPoll(ET(2026, 10, 15, 20, 5));
  check("the public API already reports it closed", pub.body.poll.status === "closed");
  check("a normal poll has no deadline fields", !pub.body.poll.ends_at && !pub.body.poll.open_ended);
});

test("one vote per browser per poll", async () => {
  const { poll, a, b } = await normalPoll();
  const when = ET(2026, 10, 15, 14);
  check("first vote accepted", (await vote(when, poll.id, a.id, "browser-1")).status === 200);
  const again = await vote(when, poll.id, b.id, "browser-1");
  check("same browser voting again (even for the other option) is refused with 409", again.status === 409, JSON.stringify(again));
  check("a different browser can vote", (await vote(when, poll.id, b.id, "browser-2")).status === 200);
  check("exactly two votes were stored", db().db.votes.length === 2);
  const mine = await publicPoll(when, "browser-1");
  check("the voter is told they voted, and for what", mine.body.hasVoted === true && mine.body.votedOptionId === a.id);
  const other = await publicPoll(when, "browser-9");
  check("someone who hasn't voted is not", other.body.hasVoted === false);
});

test("votes are refused for polls that aren't open, and for options of another poll", async () => {
  const { fake, poll, a } = await normalPoll();
  const queued = fake.addPoll({ question: "TEST queued" });
  const qa = fake.addOption(queued.id, "q", 0);
  const closed = fake.addPoll({ question: "TEST closed", status: "closed" });
  const ca = fake.addOption(closed.id, "c", 0);
  const when = ET(2026, 10, 15, 14);
  check("queued poll: refused", (await vote(when, queued.id, qa.id, "s")).status === 400);
  check("closed poll: refused", (await vote(when, closed.id, ca.id, "s")).status === 400);
  check("an option from a different poll: refused", (await vote(when, poll.id, qa.id, "s")).status === 400);
  check("missing fields: refused", (await vote(when, poll.id, undefined, "s")).status === 400);
  check("nothing was stored", db().db.votes.length === 0);
  void a;
});

test("a closed poll is reported closed with its tallies", async () => {
  const { poll, a } = await normalPoll();
  await vote(ET(2026, 10, 15, 14), poll.id, a.id, "s1");
  await cronClose(ET(2026, 10, 15, 20, 30));
  check("one results email", emails().length === 1);
  const pub = await publicPoll(ET(2026, 10, 16, 9));
  check("after the close, the most recent closed poll is shown with its tallies", pub.body.poll.status === "closed" && pub.body.options.find((o) => o.label === "a").vote_count === 1);
});
