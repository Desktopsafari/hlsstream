import test from "node:test";
import fs from "node:fs";
import { NextRequest } from "next/server.js";
import { ET, check, fresh, json, load, publicPoll, withNow } from "./support/helpers.mjs";

// Push notifications. Everything runs against the in-memory fake database and
// the stub web-push package (tests/support/stub-web-push.mjs): no real
// Supabase, no real push service. All data is "TEST ...".

const lib = await load("lib/push.ts");
const pushInfo = await load("app/api/push/route.ts");
const subRoute = await load("app/api/push/subscription/route.ts");
const statusRoute = await load("app/api/push/subscription/status/route.ts");
const adminRoute = await load("app/api/admin/push/route.ts");
const sendRoute = await load("app/api/admin/push/send/route.ts");
const repeatingRoute = await load("app/api/admin/push/repeating/route.ts");
const scheduledRoute = await load("app/api/admin/push/scheduled/route.ts");
const pauseRoute = await load("app/api/admin/push/pause/route.ts");
const cronRoute = await load("app/api/cron/send-due-push/route.ts");
const proxyModule = await load("proxy.ts");
const adminAuth = await load("lib/adminAuth.ts");

const call = (method, url, body, headers = {}) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const at = (date, fn) => withNow(date, async () => json(await fn()));

const endpoint = (n) => `https://fcm.googleapis.com/fcm/send/TEST-device-${n}-${"x".repeat(40)}`;
const subscription = (n) => ({ endpoint: endpoint(n), keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } });

const subscribe = (body, ip = "203.0.113.1") =>
  subRoute.POST(call("POST", "/api/push/subscription", body, { "x-forwarded-for": ip }));
const cron = (date, secret = "test-push-secret") =>
  at(date, () => cronRoute.GET(call("GET", "/api/cron/send-due-push", undefined, { authorization: `Bearer ${secret}` })));
const send = (date, body) => at(date, () => sendRoute.POST(call("POST", "/api/admin/push/send", body)));
const overview = (date) => at(date, () => adminRoute.GET());
const repeating = (date, method, body) => at(date, () => repeatingRoute[method](call(method, "/api/admin/push/repeating", body)));
const pause = (paused) => at(new Date(), () => pauseRoute.POST(call("POST", "/api/admin/push/pause", { paused })));

// A fresh database with the two seeded categories (like the SQL file does).
async function setup(opts) {
  const fake = await fresh(opts);
  globalThis.__pushes = [];
  globalThis.__pushFail = new Map();
  if (opts?.pushTables === false) return { fake };
  const announcements = fake.addPushCategory("Announcements & events");
  const feeding = fake.addPushCategory("Feeding time");
  return { fake, announcements, feeding };
}
const pushes = () => globalThis.__pushes;
const note = (categoryId, extra = {}) => ({ title: "TEST title", message: "TEST message", url: "", categoryId, ...extra });

test("subscribe, change categories and unsubscribe store only the endpoint, keys and categories", async () => {
  const { fake, announcements, feeding } = await setup();

  const info = await json(await pushInfo.GET());
  check("push offered", info.body.supported === true && info.body.publicKey === "test-public-key");
  check("both categories listed", info.body.categories.map((c) => c.name).join("|") === "Announcements & events|Feeding time");

  const made = await json(await subscribe({ subscription: subscription(1), categoryIds: [announcements.id, feeding.id] }));
  check("subscribed", made.status === 200, JSON.stringify(made.body));
  const row = fake.db.push_subscriptions[0];
  check("one row", fake.db.push_subscriptions.length === 1);
  check("categories stored", row.category_ids.length === 2);
  const stored = Object.keys(row).sort().join(",");
  check(
    "no name, email or browser id stored",
    stored === "auth,category_ids,created_at,endpoint,failure_count,id,last_success_at,p256dh,stream_id",
    stored,
  );

  const again = await json(await subscribe({ subscription: subscription(1), categoryIds: [feeding.id] }));
  check("re-subscribing the same device updates, never duplicates", again.status === 200 && fake.db.push_subscriptions.length === 1);

  const status = await json(await statusRoute.POST(call("POST", "/api/push/subscription/status", { endpoint: endpoint(1) })));
  check("status: on, with its categories", status.body.subscribed === true && status.body.categoryIds.join() === feeding.id);

  const changed = await json(
    await subRoute.PUT(call("PUT", "/api/push/subscription", { endpoint: endpoint(1), categoryIds: [announcements.id] })),
  );
  check("categories changed", changed.status === 200 && fake.db.push_subscriptions[0].category_ids.join() === announcements.id);

  const none = await json(await subRoute.PUT(call("PUT", "/api/push/subscription", { endpoint: endpoint(1), categoryIds: [] })));
  check("changing to no categories refused", none.status === 400);

  const unknown = await json(
    await subRoute.PUT(call("PUT", "/api/push/subscription", { endpoint: endpoint(9), categoryIds: [announcements.id] })),
  );
  check("changing a device that isn't subscribed: 404", unknown.status === 404);

  const off = await json(await subRoute.DELETE(call("DELETE", "/api/push/subscription", { endpoint: endpoint(1) })));
  check("unsubscribed", off.status === 200 && fake.db.push_subscriptions.length === 0);
  const after = await json(await statusRoute.POST(call("POST", "/api/push/subscription/status", { endpoint: endpoint(1) })));
  check("status: off", after.body.subscribed === false);
});

test("bad endpoints, keys and categories are rejected", async () => {
  const { fake, feeding } = await setup();
  const bad = [
    { ...subscription(1), endpoint: "http://fcm.googleapis.com/fcm/send/TEST-plain-http-xxxxxxxx" },
    { ...subscription(1), endpoint: "javascript:alert(1)//xxxxxxxxxxxxxxxxxxxxx" },
    { ...subscription(1), endpoint: `https://fcm.googleapis.com/${"x".repeat(1100)}` },
    { ...subscription(1), endpoint: "https://localhost/push/TEST-xxxxxxxxxxxxxxxx" },
    { ...subscription(1), endpoint: "https://127.0.0.1/push/TEST-xxxxxxxxxxxxxxxx" },
    { ...subscription(1), endpoint: "https://short.io/x" },
    { ...subscription(1), endpoint: "https://fcm.googleapis.com/fcm/<script>TEST</script>" },
    { endpoint: endpoint(1), keys: { p256dh: "not base64 !!!!!!!!!!!!!!!!!!!!!!", auth: "A".repeat(22) } },
    { endpoint: endpoint(1), keys: { p256dh: "B".repeat(87) } },
    { endpoint: endpoint(1) },
    "junk",
    null,
  ];
  for (const [i, s] of bad.entries()) {
    const res = await json(await subscribe({ subscription: s, categoryIds: [feeding.id] }, `198.51.100.${i}`));
    check(`bad subscription #${i} rejected`, res.status === 400, JSON.stringify(res.body));
  }
  const noCats = await json(await subscribe({ subscription: subscription(1) }));
  check("no categories rejected", noCats.status === 400);
  const unknownCat = await json(await subscribe({ subscription: subscription(1), categoryIds: ["not-a-category"] }));
  check("unknown category rejected", unknownCat.status === 400);
  const junkBody = await json(await subRoute.POST(new Request("http://localhost/api/push/subscription", { method: "POST", body: "{nope" })));
  check("junk body rejected", junkBody.status === 400);
  check("nothing stored", fake.db.push_subscriptions.length === 0);
});

test("the public push routes share their own 'push' rate limit", async () => {
  const { fake, feeding } = await setup();
  const ip = "192.0.2.77";
  for (let i = 0; i < lib.PUSH_RATE_LIMIT_MAX; i++) {
    const res = await subscribe({ subscription: subscription(i), categoryIds: [feeding.id] }, ip);
    check(`attempt ${i + 1} allowed`, res.status === 200);
  }
  const blocked = await json(await subscribe({ subscription: subscription(99), categoryIds: [feeding.id] }, ip));
  check("over the limit: 429", blocked.status === 429);
  const off = await subRoute.DELETE(call("DELETE", "/api/push/subscription", { endpoint: endpoint(1) }, { "x-forwarded-for": ip }));
  check("unsubscribe counts toward the same limit", off.status === 429);
  check("recorded under the 'push' label", fake.db.contact_form_attempts.every((a) => a.form === "push"));
  const other = await subscribe({ subscription: subscription(99), categoryIds: [feeding.id] }, "192.0.2.78");
  check("another connection is unaffected", other.status === 200);
});

test("send now: right category only, 2-hour TTL, dead subscription deleted on 410, failures counted then deleted after 5", async () => {
  const { fake, announcements, feeding } = await setup();
  fake.addPushSubscription(endpoint(1), [feeding.id]);
  fake.addPushSubscription(endpoint(2), [feeding.id, announcements.id]);
  fake.addPushSubscription(endpoint(3), [announcements.id]);
  const dead = fake.addPushSubscription(endpoint(4), [feeding.id]);
  const flaky = fake.addPushSubscription(endpoint(5), [feeding.id], { failure_count: 3 });
  globalThis.__pushFail.set(dead.endpoint, 410);
  globalThis.__pushFail.set(flaky.endpoint, 500);

  const list = await overview(new Date());
  check("subscriber count per category", list.body.categories.find((c) => c.id === feeding.id).subscribers === 4);

  const res = await send(new Date(), { ...note(feeding.id, { url: "/contact" }), mode: "now" });
  check("sent", res.status === 200, JSON.stringify(res.body));
  check("counts", res.body.recipients === 4 && res.body.sent === 2 && res.body.failed === 2, JSON.stringify(res.body));
  check("only Feeding time subscribers got it", pushes().map((p) => p.endpoint).sort().join() === [endpoint(1), endpoint(2)].join());
  check("TTL is 2 hours", pushes().every((p) => p.options.TTL === 7200));
  check("payload has title, body, link, icon", pushes()[0].payload.title === "TEST title" && pushes()[0].payload.body === "TEST message" && pushes()[0].payload.url === "/contact" && pushes()[0].payload.icon === "/icon-192.png");
  check("410: deleted at once", !fake.db.push_subscriptions.some((s) => s.id === dead.id));
  check("500: kept, failure counted", fake.db.push_subscriptions.find((s) => s.id === flaky.id).failure_count === 4);
  check("success recorded", fake.db.push_subscriptions.find((s) => s.endpoint === endpoint(1)).last_success_at);

  await send(new Date(), { ...note(feeding.id), mode: "now" });
  check("5th failure in a row: deleted", !fake.db.push_subscriptions.some((s) => s.id === flaky.id));

  const log = fake.db.push_sends;
  check("both sends logged", log.length === 2 && log.every((l) => l.source === "now" && l.category_name === "Feeding time"));
  check("log counts", log[0].recipients === 4 && log[0].sent === 2 && log[0].failed === 2);
});

test("a success resets the failure count; 404 also deletes", async () => {
  const { fake, feeding } = await setup();
  const sub = fake.addPushSubscription(endpoint(1), [feeding.id], { failure_count: 4 });
  await send(new Date(), { ...note(feeding.id), mode: "now" });
  check("reset to 0", fake.db.push_subscriptions.find((s) => s.id === sub.id).failure_count === 0);
  globalThis.__pushFail.set(sub.endpoint, 404);
  await send(new Date(), { ...note(feeding.id), mode: "now" });
  check("404: deleted", fake.db.push_subscriptions.length === 0);
});

test("limits: title 60, message 140, link same-origin only", async () => {
  const { feeding } = await setup();
  const t = (extra) => send(new Date(), { ...note(feeding.id, extra), mode: "now" });
  check("61-char title refused", (await t({ title: "x".repeat(61) })).status === 400);
  check("60-char title ok", (await t({ title: "x".repeat(60) })).status === 200);
  check("141-char message refused", (await t({ message: "x".repeat(141) })).status === 400);
  check("empty message refused", (await t({ message: "" })).status === 400);
  for (const url of ["https://evil.example.com/", "//evil.example.com", "javascript:alert(1)", "data:text/html,x", "mailto:x@y.z"]) {
    check(`link ${url} refused`, (await t({ url })).status === 400);
  }
  check("missing category refused", (await t({ categoryId: "" })).status === 400);
  check("same-host full URL kept as its path", lib.cleanPushLink("https://www.desktopsafari.com/contact?x=1", "www.desktopsafari.com") === "/contact?x=1");
  check("blank link = home", lib.cleanPushLink("") === "/");
});

test("send test to this device only", async () => {
  const { fake, feeding } = await setup();
  fake.addPushSubscription(endpoint(1), [feeding.id]);
  fake.addPushSubscription(endpoint(2), [feeding.id]);
  const res = await send(new Date(), { ...note(""), mode: "test", endpoint: endpoint(2) });
  check("sent to this device only", res.status === 200 && pushes().length === 1 && pushes()[0].endpoint === endpoint(2));
  check("logged as a test", fake.db.push_sends[0].source === "test");
  const notSubscribed = await send(new Date(), { ...note(""), mode: "test", endpoint: endpoint(7) });
  check("needs this browser to be subscribed", notSubscribed.status === 400 && pushes().length === 1);
});

test("scheduled send: sent once at its time; missed after the 30-minute grace window; cancel", async () => {
  const { fake, feeding } = await setup();
  fake.addPushSubscription(endpoint(1), [feeding.id]);

  const made = await send(ET(2026, 11, 4, 9), { ...note(feeding.id), mode: "at", sendAtLocal: "2026-11-04T10:30" });
  check("scheduled", made.status === 200);
  const past = await send(ET(2026, 11, 4, 9), { ...note(feeding.id), mode: "at", sendAtLocal: "2026-11-04T08:00" });
  check("a time that has passed is refused", past.status === 400);
  check("send_at is 10:30 Eastern", fake.db.push_scheduled[0].send_at === ET(2026, 11, 4, 10, 30).toISOString());
  const list = await overview(ET(2026, 11, 4, 9));
  check("listed with its time", list.body.scheduled[0].when === "today 10:30 AM", list.body.scheduled[0].when);
  check("Live now: next send", list.body.next === "“TEST title” today 10:30 AM", list.body.next);

  check("not before its time", (await cron(ET(2026, 11, 4, 10, 29))).body.idle === true && pushes().length === 0);
  const ran = await cron(ET(2026, 11, 4, 10, 31));
  check("sent at its time", ran.body.sent === 1 && pushes().length === 1, JSON.stringify(ran.body));
  check("marked sent", fake.db.push_scheduled[0].status === "sent");
  check("logged as scheduled", fake.db.push_sends[0].source === "scheduled" && fake.db.push_sends[0].sent === 1);
  await cron(ET(2026, 11, 4, 10, 32));
  check("never twice", pushes().length === 1);

  // Missed: the server was down until 31 minutes after.
  await send(ET(2026, 11, 4, 11), { ...note(feeding.id, { title: "TEST late" }), mode: "at", sendAtLocal: "2026-11-04T12:00" });
  const late = await cron(ET(2026, 11, 4, 12, 31));
  check("missed, not sent", late.body.missed === 1 && pushes().length === 1, JSON.stringify(late.body));
  check("marked missed", fake.db.push_scheduled[1].status === "missed");
  check("missed is logged", fake.db.push_sends.some((l) => l.title === "TEST late" && l.status === "missed" && l.sent === 0));

  // Cancel.
  await send(ET(2026, 11, 4, 13), { ...note(feeding.id, { title: "TEST cancel" }), mode: "at", sendAtLocal: "2026-11-04T14:00" });
  const id = fake.db.push_scheduled[2].id;
  const cancelled = await json(await scheduledRoute.DELETE(call("DELETE", `/api/admin/push/scheduled?id=${id}`)));
  check("cancelled", cancelled.status === 200 && fake.db.push_scheduled[2].status === "cancelled");
  await cron(ET(2026, 11, 4, 14, 1));
  check("a cancelled send never goes out", pushes().length === 1);
  const again = await json(await scheduledRoute.DELETE(call("DELETE", `/api/admin/push/scheduled?id=${id}`)));
  check("cancelling twice: 409", again.status === 409);
});

test("repeating: status lines, Skip today with undo, Active toggle, once a day, days of week", async () => {
  const { fake, feeding } = await setup();
  fake.addPushSubscription(endpoint(1), [feeding.id]);
  const morning = ET(2026, 11, 4, 9); // Wednesday

  const made = await repeating(morning, "POST", { ...note(feeding.id, { title: "TEST feeding" }), timeOfDay: "18:00" });
  check("created", made.status === 200, JSON.stringify(made.body));
  const row = () => fake.db.push_repeating[0];
  check("days default to all", row().days_of_week.length === 7);
  const status = async (date) => (await overview(date)).body.repeating[0].status;
  check("status: next today", (await status(morning)) === "Next: today 6:00 PM", await status(morning));

  await repeating(morning, "PATCH", { id: row().id, action: "skip" });
  check("status: skipped", (await status(morning)) === "Skipped today, resumes tomorrow 6:00 PM", await status(morning));
  await cron(ET(2026, 11, 4, 18, 1));
  check("skipped day: nothing sent", pushes().length === 0);
  await repeating(ET(2026, 11, 4, 17), "PATCH", { id: row().id, action: "unskip" });
  check("undo: back to today", (await status(ET(2026, 11, 4, 17))) === "Next: today 6:00 PM");

  check("not before 6:00", (await cron(ET(2026, 11, 4, 17, 59))).body.idle === true);
  await cron(ET(2026, 11, 4, 18, 0));
  check("sent at 6:00", pushes().length === 1 && pushes()[0].payload.title === "TEST feeding");
  await cron(ET(2026, 11, 4, 18, 1));
  await cron(ET(2026, 11, 4, 18, 15));
  check("only once that day", pushes().length === 1);
  check("logged as repeating", fake.db.push_sends[0].source === "repeating");
  check("status: tomorrow", (await status(ET(2026, 11, 4, 18, 5))) === "Next: tomorrow 6:00 PM");

  await repeating(ET(2026, 11, 4, 19), "PATCH", { id: row().id, action: "active", isActive: false });
  check("status: Off", (await status(ET(2026, 11, 4, 19))) === "Off");
  await cron(ET(2026, 11, 5, 18, 1));
  check("inactive: nothing sent", pushes().length === 1);
  await repeating(ET(2026, 11, 5, 19), "PATCH", { id: row().id, action: "active", isActive: true });
  check("back on: next is tomorrow (today's time passed)", (await status(ET(2026, 11, 5, 19))) === "Next: tomorrow 6:00 PM");
  await cron(ET(2026, 11, 6, 18, 0));
  check("sends again the next day", pushes().length === 2);

  // Weekdays only, edited on a Friday evening: next is Monday.
  const edited = await repeating(ET(2026, 11, 6, 19), "PUT", {
    id: row().id, ...note(feeding.id, { title: "TEST feeding" }), timeOfDay: "18:00", daysOfWeek: [1, 2, 3, 4, 5],
  });
  check("edited", edited.status === 200);
  check("next is Monday", (await status(ET(2026, 11, 6, 19))) === "Next: Mon 6:00 PM", await status(ET(2026, 11, 6, 19)));
  await cron(ET(2026, 11, 7, 18, 0));
  check("not on Saturday", pushes().length === 2);

  const noDays = await repeating(morning, "POST", { ...note(feeding.id), timeOfDay: "18:00", daysOfWeek: [] });
  check("no days refused", noDays.status === 400);
  const badTime = await repeating(morning, "POST", { ...note(feeding.id), timeOfDay: "25:00" });
  check("bad time refused", badTime.status === 400);

  const del = await json(await repeatingRoute.DELETE(call("DELETE", `/api/admin/push/repeating?id=${row().id}`)));
  check("deleted", del.status === 200 && fake.db.push_repeating.length === 0);
});

test("repeating: a missed window is logged and skipped, then it carries on", async () => {
  const { fake, feeding } = await setup();
  fake.addPushSubscription(endpoint(1), [feeding.id]);
  await repeating(ET(2026, 11, 4, 9), "POST", { ...note(feeding.id), timeOfDay: "18:00" });
  const late = await cron(ET(2026, 11, 4, 18, 31));
  check("missed", late.body.missed === 1 && pushes().length === 0, JSON.stringify(late.body));
  check("missed logged", fake.db.push_sends[0].status === "missed" && fake.db.push_sends[0].source === "repeating");
  check("next is tomorrow", fake.db.push_repeating[0].next_send_at === ET(2026, 11, 5, 18).toISOString());
  await cron(ET(2026, 11, 5, 18, 0));
  check("sends the next day", pushes().length === 1);
});

test("repeating times stay at 6:00 PM Eastern across the clock change", async () => {
  const rule = { time_of_day: "18:00", days_of_week: [0, 1, 2, 3, 4, 5, 6], is_active: true, skip_date: null, last_sent_date: null };
  const before = lib.nextOccurrence(rule, ET(2026, 10, 31, 19));
  check("Nov 1 6:00 PM EST", before.toISOString() === "2026-11-01T23:00:00.000Z", before.toISOString());
  const summer = lib.nextOccurrence(rule, ET(2026, 10, 30, 9));
  check("Oct 30 6:00 PM EDT", summer.toISOString() === "2026-10-30T22:00:00.000Z", summer.toISOString());
});

test("two overlapping pings send exactly once", async () => {
  const { fake, feeding } = await setup();
  for (let i = 1; i <= 5; i++) fake.addPushSubscription(endpoint(i), [feeding.id]);
  await send(ET(2026, 11, 4, 9), { ...note(feeding.id, { title: "TEST once" }), mode: "at", sendAtLocal: "2026-11-04T10:00" });
  await repeating(ET(2026, 11, 4, 9), "POST", { ...note(feeding.id, { title: "TEST daily" }), timeOfDay: "10:00" });

  const moment = new Date(ET(2026, 11, 4, 10).getTime() + 30000);
  const [a, b] = await Promise.all([cron(moment), cron(moment)]);
  check("both pings answered", a.status === 200 && b.status === 200);
  check("each device got each notification once", pushes().length === 10, String(pushes().length));
  for (let i = 1; i <= 5; i++) {
    const mine = pushes().filter((p) => p.endpoint === endpoint(i)).map((p) => p.payload.title).sort();
    check(`device ${i}`, mine.join() === "TEST daily,TEST once", mine.join());
  }
  check("logged once each", fake.db.push_sends.length === 2);
  check("total sent across pings", a.body.sent + b.body.sent === 2);
});

test("kill switch: nothing sends while paused; resumes within the window, missed after it", async () => {
  const { fake, feeding } = await setup();
  fake.addPushSubscription(endpoint(1), [feeding.id]);
  await pause(true);
  check("paused shown", (await overview(new Date())).body.paused === true);
  const now = await send(new Date(), { ...note(feeding.id), mode: "now" });
  check("send now refused while paused", now.status === 409 && pushes().length === 0);
  const t = await send(new Date(), { ...note(""), mode: "test", endpoint: endpoint(1) });
  check("test refused while paused", t.status === 409 && pushes().length === 0);

  await send(ET(2026, 11, 4, 9), { ...note(feeding.id, { title: "TEST a" }), mode: "at", sendAtLocal: "2026-11-04T10:00" });
  await send(ET(2026, 11, 4, 9), { ...note(feeding.id, { title: "TEST b" }), mode: "at", sendAtLocal: "2026-11-04T11:00" });
  await cron(ET(2026, 11, 4, 10, 1));
  check("due but paused: not sent, still pending", pushes().length === 0 && fake.db.push_scheduled[0].status === "pending");

  await pause(false);
  await cron(ET(2026, 11, 4, 10, 20));
  check("resumed within 30 minutes: sent", pushes().length === 1 && fake.db.push_scheduled[0].status === "sent");

  await pause(true);
  await cron(ET(2026, 11, 4, 11, 1));
  await cron(ET(2026, 11, 4, 11, 31));
  check("paused past the window: missed, never sent", pushes().length === 1 && fake.db.push_scheduled[1].status === "missed");
  await pause(false);
  await cron(ET(2026, 11, 4, 11, 32));
  check("resuming later doesn't send it stale", pushes().length === 1);
});

test("the cron route needs PUSH_CRON_SECRET (not CRON_SECRET) and is one small query when idle", async () => {
  const { fake } = await setup();
  check("no secret: 401", (await at(new Date(), () => cronRoute.GET(call("GET", "/api/cron/send-due-push")))).status === 401);
  check("CRON_SECRET: 401", (await cron(new Date(), "test-secret")).status === 401);
  check("wrong secret: 401", (await cron(new Date(), "nope")).status === 401);
  fake.queries.length = 0;
  const idle = await cron(new Date());
  check("idle", idle.status === 200 && idle.body.idle === true);
  check("exactly one query when nothing is due", fake.queries.join() === "push_due", fake.queries.join());
});

test("admin push routes refuse requests without the admin login", async () => {
  await setup();
  const paths = ["/api/admin/push", "/api/admin/push/send", "/api/admin/push/repeating", "/api/admin/push/scheduled", "/api/admin/push/pause"];
  for (const path of paths) {
    const res = await proxyModule.proxy(new NextRequest(`http://localhost${path}`, { method: "POST" }));
    check(`${path}: 401 without login`, res.status === 401);
    const forged = await proxyModule.proxy(
      new NextRequest(`http://localhost${path}`, { headers: { cookie: "admin_session=admin:9999999999999.deadbeef" } }),
    );
    check(`${path}: 401 with a forged cookie`, forged.status === 401);
  }
  const token = await adminAuth.createSessionToken();
  const ok = await proxyModule.proxy(new NextRequest("http://localhost/api/admin/push", { headers: { cookie: `admin_session=${token}` } }));
  check("with the admin login: allowed through", ok.status === 200 && ok.headers.get("x-middleware-next") === "1");
  check("the matcher covers /api/admin/push", proxyModule.config.matcher.includes("/api/admin/:path*"));
});

test("the public database key can read nothing: RLS on, no policies, no grants", () => {
  const sql = fs.readFileSync(new URL("../supabase/push_notifications.sql", import.meta.url), "utf8");
  const code = sql.replace(/--.*$/gm, "");
  const tables = [...code.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);
  check("six tables", tables.join() === "push_categories,push_subscriptions,push_sends,push_scheduled,push_repeating,push_settings", tables.join());
  for (const t of tables) {
    check(`${t}: RLS on`, code.includes(`alter table ${t} enable row level security;`));
    check(`${t}: revoked from anon`, new RegExp(`revoke all on[^;]*\\b${t}\\b[^;]*from anon, authenticated;`).test(code));
  }
  check("no policies at all", !/create policy/i.test(code));
  check("no grants at all", !/\bgrant\b/i.test(code));
  check("the view runs as the caller and is revoked too", /security_invoker = true/.test(code) && /revoke all on[^;]*push_due[^;]*from anon/.test(code));
  for (const t of ["push_categories", "push_subscriptions", "push_scheduled", "push_repeating"]) {
    check(`${t}: stream_id default 'main'`, new RegExp(`create table if not exists ${t} \\([^;]*stream_id text not null default 'main'`).test(code));
  }
  check("seeds both categories", code.includes("'Announcements & events'") && code.includes("'Feeding time'"));
});

test("the site keeps working before the SQL is run (and without the keys)", async () => {
  const { fake } = await setup({ pushTables: false });
  check("push not offered", (await json(await pushInfo.GET())).body.supported === false);
  const sub = await json(await subscribe({ subscription: subscription(1), categoryIds: ["x"] }));
  check("subscribe: unavailable, not a crash", sub.status === 503, JSON.stringify(sub.body));
  const admin = await overview(new Date());
  check("admin says to run the SQL", admin.body.supported === false && /push_notifications\.sql/.test(admin.body.hint));
  const idle = await cron(new Date());
  check("cron: idle", idle.status === 200 && idle.body.idle === true);
  const poll = fake.addPoll({ status: "open", question: "TEST still works" });
  fake.addOption(poll.id, "TEST a", 0);
  fake.addOption(poll.id, "TEST b", 1);
  check("the rest of the site is unaffected", (await publicPoll(new Date())).status === 200);

  await setup();
  const saved = process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  try {
    check("no keys: push not offered", (await json(await pushInfo.GET())).body.supported === false);
    check("no keys: subscribe unavailable", (await subscribe({ subscription: subscription(1), categoryIds: ["x"] })).status === 503);
  } finally {
    process.env.VAPID_PRIVATE_KEY = saved;
  }
});
