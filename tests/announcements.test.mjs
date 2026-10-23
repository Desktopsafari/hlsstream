import test from "node:test";
import {
  BUCKET, ET, bigPng, check, fresh, formReq, jpg, json, load, png, req, textAsPng, textFile, withNow,
} from "./support/helpers.mjs";

const lib = await load("lib/announcements.ts");
const links = await load("lib/announcementLinks.ts");
const adminRoute = await load("app/api/admin/announcements/route.ts");
const imageRoute = await load("app/api/admin/announcements/image/route.ts");
const publicRoute = await load("app/api/announcements/route.ts");

const visibleAt = (date) => withNow(date, async () => json(await publicRoute.GET()));
const adminList = (date) => withNow(date, async () => json(await adminRoute.GET()));
const create = (date, body) =>
  withNow(date, async () => json(await adminRoute.POST(req("POST", "/api/admin/announcements", body))));
const update = (date, body) =>
  withNow(date, async () => json(await adminRoute.PUT(req("PUT", "/api/admin/announcements", body))));
const destroy = async (id) => json(await adminRoute.DELETE(req("DELETE", `/api/admin/announcements?id=${id}`)));
const upload = async (file, extra = {}) =>
  json(await imageRoute.POST(formReq("POST", "/api/admin/announcements/image", file, extra)));
const removePic = async (query) =>
  json(await imageRoute.DELETE(req("DELETE", `/api/admin/announcements/image?${query}`)));
const tick = () => new Promise((r) => setTimeout(r, 4));
const titles = (res) => res.body.announcements.map((a) => a.title);

const base = { title: "TEST hello", message: "TEST message", isOn: true, startMode: "now", endMode: "never" };

test("start, end and the switch decide visibility from the clock on every request", async () => {
  await fresh();
  const at = ET(2026, 10, 20, 9);
  const made = await create(at, {
    ...base,
    title: "TEST windowed",
    startMode: "at",
    startsAtLocal: "2026-10-21T12:00",
    endMode: "at",
    endsAtLocal: "2026-10-21T18:30",
  });
  check("created", made.status === 200 && made.body.id);
  check("before the start: hidden", titles(await visibleAt(ET(2026, 10, 21, 11, 59))).length === 0);
  check("at the start: shown", titles(await visibleAt(ET(2026, 10, 21, 12))).includes("TEST windowed"));
  check("one minute before the end: shown", titles(await visibleAt(ET(2026, 10, 21, 18, 29))).length === 1);
  check("at the end: hidden (no cron involved)", titles(await visibleAt(ET(2026, 10, 21, 18, 30))).length === 0);

  const list = await adminList(ET(2026, 10, 20, 9));
  check("admin status before start", /^Scheduled for Wed 12:00 PM ET$/.test(list.body.announcements[0].status.text), list.body.announcements[0].status.text);
  check("admin status while showing", /^Showing now until Wed 6:30 PM ET$/.test((await adminList(ET(2026, 10, 21, 13))).body.announcements[0].status.text));
  check("admin status after end", (await adminList(ET(2026, 10, 22, 9))).body.announcements[0].status.text === "Ended");

  const off = await update(ET(2026, 10, 21, 13), {
    id: made.body.id, ...base, title: "TEST windowed", isOn: false,
    startMode: "at", startsAtLocal: "2026-10-21T12:00", endMode: "at", endsAtLocal: "2026-10-21T18:30",
  });
  check("switching off saves", off.status === 200);
  check("switched off: hidden inside its window", titles(await visibleAt(ET(2026, 10, 21, 13))).length === 0);
  check("admin status: Off", (await adminList(ET(2026, 10, 21, 13))).body.announcements[0].status.text === "Off");

  const json1 = (await visibleAt(ET(2026, 10, 21, 13))).body;
  check("public response carries the server time for the page's clock", typeof json1.serverTime === "string");
});

test("Eastern times are exact across the November clock change", async () => {
  const before = lib.parseAnnouncementInput({ ...base, endMode: "at", endsAtLocal: "2026-10-31T12:00" }, ET(2026, 10, 1, 9));
  const after = lib.parseAnnouncementInput({ ...base, endMode: "at", endsAtLocal: "2026-11-02T12:00" }, ET(2026, 10, 1, 9));
  check("noon EDT = 16:00 UTC", before.ok && before.fields.ends_at === "2026-10-31T16:00:00.000Z");
  check("noon EST = 17:00 UTC", after.ok && after.fields.ends_at === "2026-11-02T17:00:00.000Z");
});

test("several active at once: at most 3 cards, newest first; the rest wait", async () => {
  const fake = await fresh();
  const at = (h) => ET(2026, 10, 20, h).toISOString();
  fake.addAnnouncement({ title: "TEST A", created_at: at(8) });
  fake.addAnnouncement({ title: "TEST B", created_at: at(9) });
  fake.addAnnouncement({ title: "TEST C", created_at: at(10) });
  fake.addAnnouncement({ title: "TEST D", created_at: at(11) });
  fake.addAnnouncement({ title: "TEST off", created_at: at(12), is_on: false });
  const now = ET(2026, 10, 20, 13);
  const shown = await visibleAt(now);
  check("3-card cap, newest first", JSON.stringify(titles(shown)) === JSON.stringify(["TEST D", "TEST C", "TEST B"]), titles(shown).join(","));
  const list = (await adminList(now)).body.announcements;
  const a = list.find((x) => x.title === "TEST A");
  check("the 4th says it's waiting", a.status.kind === "waiting" && /3 newer announcements are already showing/.test(a.status.text));
  fake.db.announcements.find((x) => x.title === "TEST D").is_on = false;
  check("when one goes off, the waiting one shows", titles(await visibleAt(now)).includes("TEST A"));
});

test("the site keeps working before supabase/announcements.sql is run", async () => {
  await fresh({ announcementsTable: false });
  const pub = await visibleAt(ET(2026, 10, 20, 9));
  check("public: empty list, not an error", pub.status === 200 && pub.body.announcements.length === 0);
  const admin = await adminList(ET(2026, 10, 20, 9));
  check("admin: supported=false", admin.status === 200 && admin.body.supported === false);
  const made = await create(ET(2026, 10, 20, 9), base);
  check("admin: saving explains which SQL file to run", made.status === 400 && /announcements\.sql/.test(made.body.error));
  check("the page's server helper also returns nothing", (await lib.getVisibleAnnouncements(globalThis.__fake)).length === 0);
});

test("validation: lengths, plain text, timing", async () => {
  await fresh();
  const now = ET(2026, 10, 20, 9);
  check("title required", (await create(now, { ...base, title: "  " })).status === 400);
  check("title max 80", (await create(now, { ...base, title: "x".repeat(81) })).status === 400);
  check("message max 600", (await create(now, { ...base, message: "x".repeat(601) })).status === 400);
  check("80 / 600 exactly is fine", (await create(now, { ...base, title: "x".repeat(80), message: "y".repeat(600) })).status === 200);
  check("end before start refused", (await create(now, { ...base, startMode: "at", startsAtLocal: "2026-10-22T12:00", endMode: "at", endsAtLocal: "2026-10-22T11:00" })).status === 400);
  check("switching on with an end in the past refused", (await create(now, { ...base, endMode: "at", endsAtLocal: "2026-10-19T12:00" })).status === 400);
  check("bad date refused", (await create(now, { ...base, startMode: "at", startsAtLocal: "next tuesday" })).status === 400);

  const fake = await fresh();
  await create(now, { ...base, message: "Line one\r\nLine two <b>bold</b>\u0007" });
  const row = fake.db.announcements[0];
  check("line breaks kept, control characters dropped, HTML kept as plain text", row.message === "Line one\nLine two <b>bold</b>");
});

test("button links: poll anchor, internal path, https only; javascript: and other schemes refused", async () => {
  const fake = await fresh();
  const now = ET(2026, 10, 20, 9);
  const withButton = (kind, target) => create(now, { ...base, button: { label: "TEST go", kind, target } });

  check("poll anchor accepted", (await withButton("poll", "")).status === 200);
  const pub = (await visibleAt(now)).body.announcements[0];
  check("poll button points at the poll card's id on the home page", pub.button.href === "/#todays-vote" && links.POLL_ANCHOR_ID === "todays-vote" && pub.button.external === false);

  for (const ok of ["/contact", "/support?x=1#top", "/"]) {
    check(`internal ${ok} accepted`, (await withButton("internal", ok)).status === 200);
  }
  check("https accepted", (await withButton("external", "https://example.com/page?a=1")).status === 200);
  const ext = fake.db.announcements.find((a) => a.button_kind === "external");
  check("external stored normalized", ext.button_target === "https://example.com/page?a=1");

  const bad = [
    ["internal", "javascript:alert(1)"],
    ["internal", "//evil.example"],
    ["internal", "/\\evil.example"],
    ["internal", "contact"],
    ["internal", "https://example.com"],
    ["external", "javascript:alert(1)"],
    ["external", "JavaScript:alert(1)"],
    ["external", " javascript:alert(1)"],
    ["external", "http://example.com"],
    ["external", "data:text/html,hi"],
    ["external", "mailto:a@b.c"],
    ["external", "ftp://example.com"],
    ["external", "https://user:pw@example.com"],
    ["external", "https://exa mple.com"],
    ["external", "//example.com"],
  ];
  const before = fake.db.announcements.length;
  for (const [kind, target] of bad) {
    const r = await withButton(kind, target);
    check(`${kind} ${JSON.stringify(target)} refused`, r.status === 400, JSON.stringify(r.body));
  }
  check("unknown kind refused", (await create(now, { ...base, button: { label: "x", kind: "script", target: "/" } })).status === 400);
  check("label max 30", (await create(now, { ...base, button: { label: "x".repeat(31), kind: "poll" } })).status === 400);
  check("nothing saved from refused links", fake.db.announcements.length === before);

  // Even a bad row written straight into the database never becomes a link.
  fake.addAnnouncement({ title: "TEST bad row", button_label: "x", button_kind: "external", button_target: "javascript:alert(1)", created_at: ET(2026, 10, 20, 12).toISOString() });
  const shown = (await visibleAt(now)).body.announcements.find((a) => a.title === "TEST bad row");
  check("bad stored link renders without a button", shown && shown.button === null);
});

test("picture upload validation: text file and 5MB file refused", async () => {
  const fake = await fresh();
  const A = fake.addAnnouncement();
  const t1 = await upload(textFile(), { id: A.id });
  check("text/plain refused", t1.status === 400 && /JPG, PNG, or WebP/.test(t1.body.error));
  const t2 = await upload(textAsPng(), { id: A.id });
  check("text file renamed .png refused", t2.status === 400 && /real JPG, PNG, or WebP/.test(t2.body.error));
  const t3 = await upload(bigPng(), { id: A.id });
  check("5MB refused", t3.status === 400 && /over 4MB/.test(t3.body.error));
  check("pending: text refused too", (await upload(textFile())).status === 400);
  check("pending: 5MB refused too", (await upload(bigPng())).status === 400);
  check("nothing stored", fake.files.size === 0 && A.image_path === null);
  const ok = await upload(png(), { id: A.id });
  check("real PNG accepted with a unique name in the event-images bucket", ok.status === 200 && new RegExp(`^announcements/${A.id}/picture-\\d+-[0-9a-f]{8}\\.png$`).test(A.image_path) && fake.fileExists(BUCKET, A.image_path));
});

test("replace and remove delete the old file; delete removes the picture; shared files are kept", async () => {
  const fake = await fresh();
  const A = fake.addAnnouncement();
  await upload(png(), { id: A.id });
  const p1 = A.image_path;
  await tick();
  await upload(jpg(), { id: A.id });
  const p2 = A.image_path;
  check("replace: new file in, old file gone", p1 !== p2 && !fake.fileExists(BUCKET, p1) && fake.fileExists(BUCKET, p2));
  check("remove: cleared and file gone", (await removePic(`id=${A.id}`)).status === 200 && A.image_path === null && !fake.fileExists(BUCKET, p2));

  // A file another record still points at is never deleted.
  await upload(png(), { id: A.id });
  const shared = A.image_path;
  const B = fake.addAnnouncement({ image_path: shared });
  await removePic(`id=${A.id}`);
  check("still used by B: kept", fake.fileExists(BUCKET, shared) && B.image_path === shared);
  check("deleting B then removes it", (await destroy(B.id)).status === 200 && !fake.fileExists(BUCKET, shared));
  check("B is gone", !fake.db.announcements.some((x) => x.id === B.id));

  // New (unsaved) announcement: pending upload, attached on save.
  const pend = await upload(png());
  check("pending upload", pend.status === 200 && /^announcements\/pending\//.test(pend.body.path));
  await tick();
  const pend2 = await upload(jpg());
  await removePic(`path=${encodeURIComponent(pend.body.path)}`);
  check("replacing a pending picture deletes the first one", !fake.fileExists(BUCKET, pend.body.path) && fake.fileExists(BUCKET, pend2.body.path));
  const made = await create(ET(2026, 10, 20, 9), { ...base, pendingImagePath: pend2.body.path });
  const row = fake.db.announcements.find((x) => x.id === made.body.id);
  check("saved: moved into its own folder", made.status === 200 && row.image_path.startsWith(`announcements/${row.id}/`) && fake.fileExists(BUCKET, row.image_path) && !fake.fileExists(BUCKET, pend2.body.path));
  check("public card gets the picture URL", (await visibleAt(ET(2026, 10, 20, 9))).body.announcements.find((x) => x.id === row.id).imageUrl.endsWith(row.image_path));
  check("a non-pending path can't be attached", (await create(ET(2026, 10, 20, 9), { ...base, pendingImagePath: "polls/x/question-1.png" })).status === 400);
  check("deleting an announcement deletes its picture", (await destroy(row.id)).status === 200 && !fake.fileExists(BUCKET, row.image_path));

  // Pending files never saved are cleaned up after a day when the admin list loads.
  const stale = await upload(png());
  fake.files.get(`${BUCKET}/${stale.body.path}`).created_at = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  await adminList(new Date());
  check("stale pending picture removed", !fake.fileExists(BUCKET, stale.body.path));
});
