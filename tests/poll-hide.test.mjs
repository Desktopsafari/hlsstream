import test from "node:test";
import {
  ET, byId, check, closeNow, cronClose, cronOpen, emails, fresh, json, load, publicPoll, queue, req, withNow,
} from "./support/helpers.mjs";

const visibilityRoute = await load("app/api/admin/polls/visibility/route.ts");
const autoHideRoute = await load("app/api/admin/polls/auto-hide/route.ts");
const adminPolls = await load("app/api/admin/polls/route.ts");

const H = 60 * 60 * 1000;
const setVisibility = (date, pollId, action) =>
  withNow(date, async () => json(await visibilityRoute.POST(req("POST", "/api/admin/polls/visibility", { pollId, action }))));
const setAutoHide = async (hours) =>
  json(await autoHideRoute.PUT(req("PUT", "/api/admin/polls/auto-hide", { hours })));
const adminList = (date) => withNow(date, async () => json(await adminPolls.GET()));
const shown = async (date) => (await publicPoll(date)).body.poll;

// A daily poll that opened at noon on Oct 15 and was closed by the 8 PM job.
function closedDaily(fake, question = "TEST closed", closedAt = ET(2026, 10, 15, 20, 30)) {
  const p = fake.addPoll({ question, status: "closed", opens_at: ET(2026, 10, 15, 12, 5).toISOString(), closes_at: closedAt.toISOString() });
  fake.addOption(p.id, "TEST a", 0);
  fake.addOption(p.id, "TEST b", 1);
  return p;
}

test("manual hide and show; double clicks; nothing deleted", async () => {
  const fake = await fresh();
  const X = closedDaily(fake);
  fake.addVote(X.id, fake.db.poll_options[0].id);
  const t = ET(2026, 10, 16, 9);
  check("closed poll shows by default", (await shown(t))?.id === X.id);

  const hide = await setVisibility(t, X.id, "hide");
  check("hide ok, timestamp stored", hide.status === 200 && byId(X.id).hidden_at === t.toISOString());
  const second = await setVisibility(ET(2026, 10, 16, 9, 1), X.id, "hide");
  check("double click: harmless, first timestamp kept", second.status === 200 && byId(X.id).hidden_at === t.toISOString());
  const pub = await publicPoll(t);
  check("public API: no poll", pub.status === 200 && pub.body.poll === null);
  check("public API doesn't leak the hidden poll", !JSON.stringify(pub.body).includes("TEST"));
  check("nothing deleted", fake.db.polls.length === 1 && fake.db.poll_options.length === 2 && fake.db.votes.length === 1);

  const show = await setVisibility(t, X.id, "show");
  check("show ok", show.status === 200 && byId(X.id).hidden_at === null && byId(X.id).force_shown === true);
  check("shows again", (await shown(t))?.id === X.id);
  check("show twice: harmless", (await setVisibility(t, X.id, "show")).status === 200 && (await shown(t))?.id === X.id);

  check("hide fields are not sent to visitors", !("hidden_at" in (await shown(t))) && !("force_shown" in (await shown(t))));
});

test("open, scheduled and queued polls can't be hidden; open polls always show", async () => {
  const fake = await fresh();
  const O = fake.addPoll({ question: "TEST open", status: "open", opens_at: ET(2026, 10, 15, 12, 5).toISOString() });
  const S = fake.addPoll({ question: "TEST queued", status: "scheduled" });
  const t = ET(2026, 10, 15, 14);
  for (const p of [O, S]) {
    const r = await setVisibility(t, p.id, "hide");
    check(`${p.status} poll: refused`, r.status === 409 && r.body.code === "not_closed" && byId(p.id).hidden_at === null);
  }
  check("unknown poll: 404", (await setVisibility(t, "00000000-0000-0000-0000-000000000000", "hide")).status === 404);
  check("bad action: 400", (await setVisibility(t, O.id, "delete")).status === 400);

  // Even with a stray hidden_at and the shortest timer, an open poll shows.
  byId(O.id).hidden_at = t.toISOString();
  await setAutoHide(6);
  check("open poll shows regardless", (await shown(ET(2026, 10, 15, 19)))?.id === O.id);
  const list = (await adminList(t)).body.polls;
  check("admin: open poll not marked hidden", list.find((p) => p.id === O.id).visibility.hidden === false);
});

test("auto-hide at each threshold, from the real close time, on a simulated clock", async () => {
  for (const hours of [6, 12, 24, 48, 72, 168]) {
    const fake = await fresh();
    // Closed by the 8 PM job at 8:30, but voting really ended at 8:00 PM.
    const X = closedDaily(fake, `TEST auto ${hours}`);
    const realClose = ET(2026, 10, 15, 20).getTime();
    check(`${hours}h: saved`, (await setAutoHide(hours)).status === 200);
    const before = new Date(realClose + hours * H - 60 * 1000);
    const vis = await publicPoll(before);
    check(`${hours}h: one minute before, still shown`, vis.body.poll?.id === X.id);
    check(`${hours}h: hideAt counted from 8:00 PM, not the 8:30 flip`, vis.body.hideAt === new Date(realClose + hours * H).toISOString(), vis.body.hideAt);
    check(`${hours}h: at the threshold, hidden`, (await shown(new Date(realClose + hours * H))) === null);
    const row = (await adminList(new Date(realClose + hours * H))).body.polls[0];
    check(`${hours}h: admin marks it auto-hidden`, row.visibility.hidden && row.visibility.reason === "auto" && row.visibility.hours === hours);
  }

  const fake = await fresh();
  closedDaily(fake);
  check("never (default): no setting row", fake.db.site_settings.length === 0);
  check("never: still shown 30 days later", (await shown(ET(2026, 11, 15, 12))) !== null);
  await setAutoHide(24);
  check("switching back to never", (await setAutoHide(null)).status === 200 && (await shown(ET(2026, 11, 15, 12))) !== null);
  check("other values refused", (await setAutoHide(5)).status === 400 && (await setAutoHide("1 day")).status === 400);
});

test("manual show overrides the timer; manual hide beats everything", async () => {
  const fake = await fresh();
  const X = closedDaily(fake);
  await setAutoHide(6);
  const late = ET(2026, 10, 16, 3);
  check("timer hid it", (await shown(late)) === null);
  await setVisibility(late, X.id, "show");
  check("Show on site: visible again", (await shown(late))?.id === X.id);
  const pub = await publicPoll(ET(2026, 11, 20, 12));
  check("...and stays visible, timer ignored (no hideAt)", pub.body.poll?.id === X.id && pub.body.hideAt === null);
  const row = (await adminList(late)).body.polls[0];
  check("admin shows it as shown with the timer ignored", row.visibility.hidden === false && row.force_shown === true);

  await setVisibility(late, X.id, "hide");
  check("hide again: hidden, override cleared", (await shown(late)) === null && byId(X.id).force_shown === false);
  await setAutoHide(null);
  check("manual hide stays with the timer off", (await shown(late)) === null);
  check("admin marks it manual", (await adminList(late)).body.polls[0].visibility.reason === "manual");

  // Show before the timer has fired keeps it up for good.
  const fake2 = await fresh();
  const Y = closedDaily(fake2);
  await setAutoHide(6);
  await setVisibility(ET(2026, 10, 15, 21), Y.id, "show");
  check("shown early: never auto-hides", (await shown(ET(2026, 10, 20, 9)))?.id === Y.id);
});

test("long polls count from their real close time", async () => {
  // 3-day poll: opens Oct 15 noon, voting ends Sat Oct 17 8:00 PM.
  let fake = await fresh();
  const made = await queue(ET(2026, 10, 14, 15), { question: "TEST 3-day", options: ["x", "y"], duration: { mode: "days", days: 3 } });
  await cronOpen(ET(2026, 10, 15, 12, 30));
  const L = fake.db.polls.find((p) => p.question === "TEST 3-day");
  check("queued and opened", made.status === 200 && L.status === "open");
  await setAutoHide(6);
  check("not hidden while open (day 2)", (await shown(ET(2026, 10, 16, 23)))?.id === L.id);
  // Voting ended at 8 PM but no job has flipped it yet: still counts from 8 PM.
  const ended = await publicPoll(ET(2026, 10, 17, 21));
  check("ended, not yet flipped: shown as closed with hideAt 2:00 AM", ended.body.poll?.status === "closed" && ended.body.hideAt === ET(2026, 10, 18, 2).toISOString(), ended.body.hideAt);
  check("ended, not yet flipped: hidden at 2:00 AM", (await shown(ET(2026, 10, 18, 2))) === null);
  await cronClose(ET(2026, 10, 17, 20, 40));
  check("after the job flips it at 8:40: still 2:00 AM, not 2:40", (await shown(ET(2026, 10, 18, 1, 59)))?.id === L.id && (await shown(ET(2026, 10, 18, 2))) === null);

  // Close now ends it early: the timer counts from that moment.
  fake = await fresh();
  const O = fake.addPoll({ question: "TEST closed early", status: "open", opens_at: ET(2026, 10, 15, 12, 5).toISOString(), ends_at: ET(2026, 10, 20, 20).toISOString() });
  fake.addOption(O.id, "x", 0);
  fake.addOption(O.id, "y", 1);
  await setAutoHide(12);
  await closeNow(ET(2026, 10, 16, 10), O.id);
  check("Close now at 10 AM: shown at 9:59 PM", (await shown(ET(2026, 10, 16, 21, 59)))?.id === O.id);
  check("...hidden at 10 PM", (await shown(ET(2026, 10, 16, 22))) === null);
});

test("the next poll shows after one is hidden; the results email is sent exactly once", async () => {
  const fake = await fresh();
  const O = fake.addPoll({ question: "TEST today", status: "open", opens_at: ET(2026, 10, 15, 12, 5).toISOString() });
  fake.addOption(O.id, "x", 0);
  fake.addOption(O.id, "y", 1);
  await cronClose(ET(2026, 10, 15, 20, 30));
  check("closed with one email", byId(O.id).status === "closed" && emails().length === 1);
  await setVisibility(ET(2026, 10, 15, 21), O.id, "hide");
  await setVisibility(ET(2026, 10, 15, 21), O.id, "show");
  await setVisibility(ET(2026, 10, 15, 21), O.id, "hide");
  await cronClose(ET(2026, 10, 15, 20, 45));
  check("hiding/showing sends nothing; still exactly one email", emails().length === 1);
  check("hidden: no poll card", (await shown(ET(2026, 10, 16, 9))) === null);

  await queue(ET(2026, 10, 16, 9), { question: "TEST tomorrow", options: ["a", "b"] });
  await cronOpen(ET(2026, 10, 16, 12, 30));
  const next = await shown(ET(2026, 10, 16, 13));
  check("the next poll shows normally", next?.question === "TEST tomorrow" && next.status === "open");
  check("the hidden one stays hidden in admin", byId(O.id).hidden_at !== null);
});

test("before supabase/poll_hide.sql is run nothing hides and admin says so", async () => {
  const fake = await fresh({ hideColumns: false });
  const X = closedDaily(fake);
  check("closed poll shows", (await shown(ET(2026, 11, 20, 9)))?.id === X.id);
  const admin = await adminList(ET(2026, 10, 16, 9));
  check("admin: hideSupported false, poll not hidden", admin.status === 200 && admin.body.hideSupported === false && admin.body.polls[0].visibility.hidden === false);
  const hide = await setVisibility(ET(2026, 10, 16, 9), X.id, "hide");
  check("hide explains which SQL to run", hide.status === 400 && /poll_hide\.sql/.test(hide.body.error));
  const auto = await setAutoHide(6);
  check("setting explains which SQL to run", auto.status === 400 && /poll_hide\.sql/.test(auto.body.error));
});
