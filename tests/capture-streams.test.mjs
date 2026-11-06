import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, fresh, json, load, withNow } from "./support/helpers.mjs";
import { installCaptureService } from "./support/stub-capture-service.mjs";

// Captures with two streams: the frog stream (id 'main', slug 'frogs',
// capture_key 'main') and a TEST fish stream (id and slug 'fish'). A capture
// belongs to one stream; the gallery and the admin only see that stream's
// captures. The pause switch, the visitor limits, the storage budget and the
// cleanup are site-wide on purpose. Fake database and stub capture service
// only: no real Supabase, no real VPS.

const lib = await load("lib/data/captures/index.ts");
const publicRoute = await load("app/api/capture/route.ts");
const adminRoute = await load("app/api/admin/captures/route.ts");
const pauseRoute = await load("app/api/admin/captures/pause/route.ts");
const cronRoute = await load("app/api/cron/cleanup-captures/route.ts");

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const T0 = new Date("2026-11-05T15:00:00Z");
const after = (ms) => new Date(T0.getTime() + ms);

const call = (method, url, body, headers = {}) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const at = (date, fn) => withNow(date, async () => json(await fn()));
const q = (stream) => (stream === undefined ? "" : `?stream=${encodeURIComponent(stream)}`);

const clipOn = (stream, date, ip, seconds = 30) =>
  at(date, () => publicRoute.POST(call("POST", `/api/capture${q(stream)}`, { kind: "clip", seconds, behind_live_seconds: 12 }, { "x-forwarded-for": ip })));
const photoOn = (stream, date, ip) =>
  at(date, () => publicRoute.POST(call("POST", `/api/capture${q(stream)}`, { kind: "photo", behind_live_seconds: 12 }, { "x-forwarded-for": ip })));
const enabledOn = (stream) => at(T0, () => publicRoute.GET(call("GET", `/api/capture${q(stream)}`)));
const admin = (method, url, body) => at(T0, () => adminRoute[method](call(method, url, body)));
const cron = (date) =>
  at(date, () => cronRoute.GET(call("GET", "/api/cron/cleanup-captures", undefined, { authorization: "Bearer test-capture-cron-secret" })));

async function setup({ fishKey = "fish", ...fishProps } = {}) {
  const fake = await fresh();
  fake.addStream({ capture_key: fishKey, ...fishProps });
  const vps = installCaptureService();
  return { fake, vps };
}
const captureRequests = (vps) => vps.requests.filter((r) => r.path === "/capture");
const rowOf = (fake, id) => fake.db.captures.find((r) => r.id === id);

test("a capture belongs to the stream asked for, and the service gets that stream's capture_key", async () => {
  const { fake, vps } = await setup();

  const frog = await clipOn(undefined, T0, "10.1.0.1");
  check("no stream: saved", frog.status === 200, JSON.stringify(frog.body));
  check("no stream: a frog capture", rowOf(fake, frog.body.capture.id).stream_id === "main");
  check("no stream: service asked for buffer 'main' (as today)", captureRequests(vps)[0].body.stream === "main");

  const bySlug = await clipOn("frogs", T0, "10.1.0.2");
  check("?stream=frogs: a frog capture, key main", rowOf(fake, bySlug.body.capture.id).stream_id === "main" && captureRequests(vps)[1].body.stream === "main");

  const fish = await clipOn("fish", T0, "10.1.0.3");
  check("?stream=fish: saved", fish.status === 200, JSON.stringify(fish.body));
  check("?stream=fish: a fish capture", rowOf(fake, fish.body.capture.id).stream_id === "fish");
  check("?stream=fish: service asked for buffer 'fish'", captureRequests(vps)[2].body.stream === "fish");

  const viaBody = await at(T0, () =>
    publicRoute.POST(call("POST", "/api/capture", { kind: "photo", behind_live_seconds: 12, stream_id: "fish" }, { "x-forwarded-for": "10.1.0.4" })),
  );
  check("stream_id in the body works too", viaBody.status === 200 && rowOf(fake, viaBody.body.capture.id).stream_id === "fish");

  const adminFish = await admin("POST", "/api/admin/captures?stream=fish", { kind: "clip", seconds: 60 });
  check("admin capture on fish", adminFish.status === 200 && rowOf(fake, adminFish.body.capture.id).stream_id === "fish" && captureRequests(vps).at(-1).body.stream === "fish");
  const adminFrog = await admin("POST", "/api/admin/captures", { kind: "photo" });
  check("admin capture, no stream: frog", adminFrog.status === 200 && rowOf(fake, adminFrog.body.capture.id).stream_id === "main" && captureRequests(vps).at(-1).body.stream === "main");

  const g = await enabledOn("fish");
  check("GET ?stream=fish: enabled", g.status === 200 && g.body.enabled === true);
  check("GET no stream: enabled", (await enabledOn()).body.enabled === true);
});

test("unknown or malformed stream: 404 / 400 everywhere, nothing stored, the VPS never asked", async () => {
  const { fake, vps } = await setup();
  check("GET unknown: 404", (await enabledOn("nope")).status === 404);
  check("GET malformed: 400", (await enabledOn("../x")).status === 400);
  check("POST unknown: 404", (await clipOn("nope", T0, "10.2.0.1")).status === 404);
  check("POST stream_id unknown: 404", (await at(T0, () => publicRoute.POST(call("POST", "/api/capture", { kind: "photo", behind_live_seconds: 1, stream_id: "nope" })))).status === 404);
  check("admin GET unknown: 404", (await admin("GET", "/api/admin/captures?stream=nope")).status === 404);
  check("admin POST unknown: 404", (await admin("POST", "/api/admin/captures?stream=nope", { kind: "photo" })).status === 404);
  const c = fake.addCapture({});
  check("admin PATCH unknown: 404", (await admin("PATCH", "/api/admin/captures", { id: c.id, action: "keep", stream_id: "nope" })).status === 404 && !c.kept);
  check("admin DELETE unknown: 404", (await admin("DELETE", "/api/admin/captures?stream=nope", { id: c.id })).status === 404 && rowOf(fake, c.id));
  check("no rows made", fake.db.captures.length === 1);
  check("capture service never asked to capture", captureRequests(vps).length === 0);
});

test("a stream with no capture_key, or switched off, refuses captures with a clear message", async () => {
  for (const [label, opts] of [["no capture_key", { fishKey: null }], ["switched off", { fishKey: "fish", is_active: false }]]) {
    const { fake, vps } = await setup(opts);
    const g = await enabledOn("fish");
    check(`${label}: GET says not enabled (buttons hidden)`, g.status === 200 && g.body.enabled === false, JSON.stringify(g.body));
    const v = await clipOn("fish", T0, "10.3.0.1");
    check(`${label}: visitor clip refused`, v.status === 409 && /can't be saved on this stream/.test(v.body.error), JSON.stringify(v.body));
    check(`${label}: visitor photo refused`, (await photoOn("fish", T0, "10.3.0.2")).status === 409);
    const a = await admin("POST", "/api/admin/captures?stream=fish", { kind: "clip", seconds: 15 });
    check(`${label}: admin capture refused too`, a.status === 409, JSON.stringify(a.body));
    check(`${label}: nothing stored, VPS not asked`, fake.db.captures.length === 0 && captureRequests(vps).length === 0);
    check(`${label}: the frog stream still works`, (await clipOn(undefined, T0, "10.3.0.3")).status === 200);
  }
});

test("gallery: a stream's featured captures only show on that stream (default frog stream)", async () => {
  const { fake } = await setup();
  const frog = (await clipOn(undefined, T0, "10.4.0.1")).body.capture;
  const fish = (await clipOn("fish", T0, "10.4.0.2")).body.capture;

  check("feature the fish clip on fish", (await admin("PATCH", "/api/admin/captures?stream=fish", { id: fish.id, action: "feature" })).status === 200);
  check("frog gallery: empty", (await lib.loadGallery(fake, "main")).length === 0);
  const fishGallery = await lib.loadGallery(fake, "fish");
  check("fish gallery: the fish clip", fishGallery.length === 1 && fishGallery[0].id === fish.id);

  check("feature the frog clip (no stream)", (await admin("PATCH", "/api/admin/captures", { id: frog.id, action: "feature" })).status === 200);
  const frogGallery = await lib.loadGallery(fake, "main");
  check("frog gallery: only the frog clip", frogGallery.length === 1 && frogGallery[0].id === frog.id);
  check("fish gallery: still only the fish clip", (await lib.loadGallery(fake, "fish")).map((i) => i.id).join() === fish.id);
});

test("admin: lists and acts only on the stream's own captures; another stream's capture is not found", async () => {
  const { fake, vps } = await setup();
  const frog = (await clipOn(undefined, T0, "10.5.0.1")).body.capture;
  const fish = (await clipOn("fish", T0, "10.5.0.2")).body.capture;

  const listFrog = await admin("GET", "/api/admin/captures");
  check("list, no stream: only the frog capture", listFrog.body.captures.map((c) => c.id).join() === frog.id);
  const listFish = await admin("GET", "/api/admin/captures?stream=fish");
  check("list ?stream=fish: only the fish capture", listFish.body.captures.map((c) => c.id).join() === fish.id);
  check("download link only for the stream's own capture", !JSON.stringify(listFrog.body.captures).includes(fish.id) && listFish.body.captures[0].downloadUrl === fish.downloadUrl);
  check("usage totals are site-wide (both clips)", listFrog.body.usage.totalBytes === listFish.body.usage.totalBytes && listFrog.body.usage.totalBytes === 2 * 30 * 560_000);

  const before = JSON.stringify(fake.db.captures);
  for (const action of ["feature", "keep"]) {
    const r = await admin("PATCH", "/api/admin/captures", { id: fish.id, action });
    check(`${action} the fish capture from the frog stream: 404`, r.status === 404, JSON.stringify(r.body));
  }
  const ext = await admin("PATCH", "/api/admin/captures", { id: fish.id, action: "feature", externalUrl: "https://youtu.be/dQw4w9WgXcQ" });
  check("feature-with-link from the frog stream: 404", ext.status === 404);
  const del = await admin("DELETE", "/api/admin/captures", { id: fish.id });
  check("delete the fish capture from the frog stream: 404", del.status === 404);
  check("the fish capture is untouched, its files still on the VPS", JSON.stringify(fake.db.captures) === before && vps.files.has(`${fish.id}.mp4`));
  check("frog capture from the fish stream: 404", (await admin("PATCH", "/api/admin/captures?stream=fish", { id: frog.id, action: "keep" })).status === 404 && !rowOf(fake, frog.id).kept);

  check("keep on its own stream works", (await admin("PATCH", "/api/admin/captures", { id: fish.id, action: "keep", stream_id: "fish" })).status === 200 && rowOf(fake, fish.id).kept);
  check("delete on its own stream works", (await admin("DELETE", "/api/admin/captures?stream=fish", { id: fish.id })).status === 200 && !rowOf(fake, fish.id) && !vps.files.has(`${fish.id}.mp4`));
  check("frog capture still there", !!rowOf(fake, frog.id) && vps.files.has(`${frog.id}.mp4`));
});

test("visitor limits, site-wide limits, the budget and the pause switch count every stream", async () => {
  const { fake } = await setup();

  check("frog clip", (await clipOn(undefined, T0, "10.6.0.1")).status === 200);
  const gap = await clipOn("fish", after(1 * MIN), "10.6.0.1");
  check("same visitor on fish 1 min later: 3-minute gap applies", gap.status === 429 && /You just saved a clip/.test(gap.body.error), JSON.stringify(gap.body));

  // Five clips an hour per visitor, spread over both streams.
  for (let i = 1; i < 5; i++) {
    const stream = i % 2 ? "fish" : undefined;
    check(`visitor clip ${i + 1} (${stream ?? "frogs"})`, (await clipOn(stream, after(i * 4 * MIN), "10.6.0.1")).status === 200);
  }
  const sixth = await clipOn("fish", after(21 * MIN), "10.6.0.1");
  check("6th clip in the hour, across streams: refused", sixth.status === 429 && /5 clips in the last hour/.test(sixth.body.error), JSON.stringify(sixth.body));

  // Site-wide: 15 visitor clips an hour in total, whichever stream.
  for (let i = 0; i < 10; i++) {
    const stream = i % 2 ? "fish" : "frogs";
    check(`other visitor clip ${i + 1}`, (await clipOn(stream, after(22 * MIN), `10.6.1.${i}`)).status === 200);
  }
  check("15 clips so far, on two streams", fake.db.captures.filter((c) => c.kind === "clip").length === 15);
  const full = await clipOn("frogs", after(23 * MIN), "10.6.2.1");
  check("16th clip site-wide: refused on frogs", full.status === 429 && /Lots of people/.test(full.body.error), JSON.stringify(full.body));
  check("and on fish", (await clipOn("fish", after(23 * MIN), "10.6.2.2")).status === 429);
});

test("the 5 GB budget and the pause switch are site-wide", async () => {
  const { fake } = await setup();
  fake.addCapture({ stream_id: "fish", bytes: 5 * 1024 ** 3 + 1, expires_at: after(HOUR).toISOString(), created_at: after(-2 * HOUR).toISOString() });
  const r = await photoOn(undefined, T0, "10.7.0.1");
  check("fish captures fill the budget: the frog stream is refused", r.status === 507, JSON.stringify(r.body));
  fake.db.captures.length = 0;

  check("pause", (await json(await pauseRoute.POST(call("POST", "/api/admin/captures/pause", { paused: true })))).status === 200);
  check("paused: fish refused", (await clipOn("fish", T0, "10.7.0.2")).status === 403);
  check("paused: frogs refused", (await clipOn(undefined, T0, "10.7.0.3")).status === 403);
  check("paused: both GETs say so", (await enabledOn("fish")).body.paused === true && (await enabledOn()).body.paused === true);
  check("paused: the admin can still capture on fish", (await admin("POST", "/api/admin/captures?stream=fish", { kind: "photo" })).status === 200);
});

test("cleanup expires captures on every stream, even one with no capture_key", async () => {
  const { fake, vps } = await setup();
  const frog = (await clipOn(undefined, T0, "10.8.0.1")).body.capture;
  const fish = (await clipOn("fish", T0, "10.8.0.2")).body.capture;
  fake.addStream({ id: "otter", slug: "otter", name: "TEST otter", capture_key: null });
  const otter = fake.addCapture({ stream_id: "otter", expires_at: T0.toISOString(), created_at: T0.toISOString() });
  vps.files.add(otter.file_name);
  vps.files.add(otter.thumb_name);
  const keptFish = (await clipOn("fish", T0, "10.8.0.3")).body.capture;
  check("keep one fish clip", (await admin("PATCH", "/api/admin/captures?stream=fish", { id: keptFish.id, action: "keep" })).status === 200);

  const res = await cron(after(25 * 60 * MIN));
  check("cleanup ran", res.status === 200 && res.body.ok === true, JSON.stringify(res.body));
  check("three expired captures deleted, across three streams", res.body.deleted === 3);
  check("rows gone on every stream", !rowOf(fake, frog.id) && !rowOf(fake, fish.id) && !rowOf(fake, otter.id));
  check("files gone on the VPS", !vps.files.has(`${frog.id}.mp4`) && !vps.files.has(`${fish.id}.mp4`) && !vps.files.has(otter.file_name));
  check("the kept fish clip stays", !!rowOf(fake, keptFish.id) && vps.files.has(`${keptFish.id}.mp4`));
});

test("no file outside src/lib/data/captures/ queries the captures table", () => {
  const src = path.resolve(fileURLToPath(new URL("../src/", import.meta.url)));
  const own = path.join(src, "lib", "data", "captures");
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (p !== own) walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      if (/\.from\(\s*["'`]captures["'`]/.test(fs.readFileSync(p, "utf8"))) offenders.push(path.relative(src, p));
    }
  };
  walk(src);
  check("captures is only touched in the data layer", offenders.length === 0, offenders.join(", "));
});
