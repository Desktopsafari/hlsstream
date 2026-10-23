import test from "node:test";
import { ET, byId, check, closeNow, cronClose, db, fresh, load, withNow } from "./support/helpers.mjs";

const unlink = await load("lib/voteUnlink.ts");

const unlinkAt = (date) => withNow(date, () => unlink.unlinkOldVotes());
const linked = () => db().db.votes.filter((v) => !v.session_id.startsWith("anon-")).length;
const allUnlinked = () => db().db.votes.every((v) => v.session_id.startsWith("anon-"));

test("votes are unlinked from browser ids about 7 days after a poll closes (counted from the real close)", async () => {
  const fake = await fresh();
  const P = fake.addPoll({ question: "TEST unlink", status: "open", opens_at: ET(2026, 10, 15, 12, 30).toISOString() });
  const a = fake.addOption(P.id, "a", 0);
  fake.addOption(P.id, "b", 1);
  for (const s of ["u1", "u2", "u3"]) fake.addVote(P.id, a.id, s);

  await unlinkAt(ET(2026, 10, 17, 6));
  check("while the poll is open: nothing unlinked", linked() === 3);
  await cronClose(ET(2026, 10, 15, 20, 30));
  await unlinkAt(ET(2026, 10, 22, 6));
  check("6.4 days after the close: still linked", linked() === 3);
  const first = await unlinkAt(ET(2026, 10, 23, 6));
  check("7.4 days after the close: unlinked", first.unlinked === 3 && allUnlinked());
  check("the votes themselves are all still there, tallies unchanged", db().db.votes.filter((v) => v.poll_id === P.id).length === 3);
  const again = await unlinkAt(ET(2026, 10, 30, 6));
  check("running it again changes nothing", again.unlinked === 0);
  const ids = new Set(db().db.votes.map((v) => v.session_id));
  check("each vote got its own unrelated id", ids.size === 3);
  void byId;
});

test("a long poll counts from when it actually closed, not from its end time", async () => {
  const fake = await fresh();
  const L = fake.addPoll({ question: "TEST long unlink", status: "open", opens_at: ET(2026, 10, 15, 12, 5).toISOString(), ends_at: ET(2026, 10, 17, 20).toISOString() });
  const a = fake.addOption(L.id, "a", 0);
  fake.addOption(L.id, "b", 1);
  for (const s of ["u1", "u2", "u3"]) fake.addVote(L.id, a.id, s);
  await unlinkAt(ET(2026, 10, 19, 6));
  check("ended but not closed (status open): stays linked", linked() === 3);
  await cronClose(ET(2026, 10, 20, 20, 30));
  check("closed for real on Oct 20", byId(L.id).closes_at === ET(2026, 10, 20, 20, 30).toISOString());
  await unlinkAt(ET(2026, 10, 27, 6));
  check("6.4 days after the real close (more than 7 after the end): still linked", linked() === 3);
  await unlinkAt(ET(2026, 10, 28, 6));
  check("7.4 days after the real close: unlinked", allUnlinked());
});

test("an open-ended poll is never unlinked while open; counts from Close now", async () => {
  const fake = await fresh();
  const O = fake.addPoll({ question: "TEST open-ended unlink", status: "open", opens_at: ET(2026, 10, 1, 12).toISOString(), open_ended: true });
  const a = fake.addOption(O.id, "a", 0);
  fake.addOption(O.id, "b", 1);
  fake.addVote(O.id, a.id, "o1");
  await unlinkAt(ET(2026, 11, 20, 6));
  check("open for 50 days: still linked", linked() === 1);
  await closeNow(ET(2026, 11, 20, 12), O.id);
  await unlinkAt(ET(2026, 11, 26, 6));
  check("6 days after Close now: linked", linked() === 1);
  await unlinkAt(ET(2026, 11, 28, 6));
  check("8 days after Close now: unlinked", allUnlinked());
});
