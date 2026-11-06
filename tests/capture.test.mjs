import test from "node:test";
import fs from "node:fs";
import { NextRequest } from "next/server.js";
import { check, db, fresh, json, load, withNow } from "./support/helpers.mjs";
import { installCaptureService } from "./support/stub-capture-service.mjs";
import { clampShift, parsePlaylist, pickClipSegments, pickPhotoFrame } from "../vps/capture/window.mjs";

// Capture (clips and photos). Everything runs against the in-memory fake
// database and the stub capture service (tests/support/stub-capture-service.mjs):
// no real Supabase, no real VPS. Visitor photos taken in the browser never
// reach any of this (src/lib/browserPhoto.ts); what's tested here is the
// server path they fall back to, clips, and the admin side.

const shared = await load("lib/data/captures/rules.ts");
const lib = await load("lib/data/captures/index.ts");
const publicRoute = await load("app/api/capture/route.ts");
const adminRoute = await load("app/api/admin/captures/route.ts");
const pauseRoute = await load("app/api/admin/captures/pause/route.ts");
const cronRoute = await load("app/api/cron/cleanup-captures/route.ts");
const proxyModule = await load("proxy.ts");

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

const visitor = (date, body, ip = "203.0.113.7") =>
  at(date, () => publicRoute.POST(call("POST", "/api/capture", body, { "x-forwarded-for": ip })));
const clip = (date, ip, seconds = 30, behind = 12.3) => visitor(date, { kind: "clip", seconds, behind_live_seconds: behind }, ip);
const photo = (date, ip, behind = 12.3) => visitor(date, { kind: "photo", behind_live_seconds: behind }, ip);
const admin = (date, method, body) => at(date, () => adminRoute[method](call(method, "/api/admin/captures", body)));
const cron = (date, secret = "test-capture-cron-secret") =>
  at(date, () => cronRoute.GET(call("GET", "/api/cron/cleanup-captures", undefined, secret ? { authorization: `Bearer ${secret}` } : {})));

async function setup(opts) {
  const fake = await fresh(opts);
  const vps = installCaptureService();
  return { fake, vps };
}
const captureRequests = (vps) => vps.requests.filter((r) => r.path === "/capture");

test("a visitor clip: stored with a hash (never the IP), 24 h expiry, a preview and download link", async () => {
  const { fake, vps } = await setup();
  const res = await clip(T0, "203.0.113.7");
  check("saved", res.status === 200, JSON.stringify(res.body));
  const c = res.body.capture;
  check("id is 22 url-safe chars", /^[A-Za-z0-9_-]{22}$/.test(c.id));
  check("inline link", c.url === `https://capture.test/captures/f/${c.id}.mp4`);
  check("download link", c.downloadUrl === `https://capture.test/captures/dl/${c.id}.mp4`);
  check("thumbnail", c.thumbUrl === `https://capture.test/captures/f/${c.id}-t.jpg`);
  check("expires in 24 hours", c.expiresAt === after(24 * HOUR).toISOString(), c.expiresAt);

  const row = fake.db.captures[0];
  check("one row, ready", fake.db.captures.length === 1 && row.status === "ready");
  check("hash stored", typeof row.requester_hash === "string" && row.requester_hash.length === 64);
  check("raw IP stored nowhere", !JSON.stringify(fake.db).includes("203.0.113.7"));
  check("same IP, same hash", lib.requesterHash("203.0.113.7", process.env.CAPTURE_SECRET) === row.requester_hash);
  check("bytes recorded", row.bytes === 30 * 560_000);

  const sent = captureRequests(vps)[0];
  check("VPS got the secret header", sent.secret === process.env.CAPTURE_SECRET);
  check("VPS got the stream, kind, length and id", sent.body.stream === "main" && sent.body.kind === "clip" && sent.body.seconds === 30 && sent.body.id === c.id);
  check("delay = reported + 2 s playlist lag", sent.body.behind_live_seconds === 14.3, String(sent.body.behind_live_seconds));
});

test("clip limits: 1 per 3 minutes and 5 per hour per visitor, 15 per hour site-wide", async () => {
  await setup();
  check("first clip", (await clip(T0, "198.51.100.1")).status === 200);
  const soon = await clip(after(2 * MIN), "198.51.100.1");
  check("second within 3 min refused", soon.status === 429 && /another in 1 minute/.test(soon.body.error), soon.body.error);
  check("another visitor is not affected", (await clip(after(2 * MIN), "198.51.100.2")).status === 200);
  for (let i = 1; i <= 4; i++) check(`clip ${i + 1}`, (await clip(after(i * 3 * MIN + i), "198.51.100.1")).status === 200);
  const sixth = await clip(after(20 * MIN), "198.51.100.1");
  check("6th in the hour refused", sixth.status === 429 && /5 clips in the last hour/.test(sixth.body.error), sixth.body.error);
  check("allowed again after the hour", (await clip(after(61 * MIN), "198.51.100.1")).status === 200);

  // Site-wide: 15 visitor clips in the last hour from anyone.
  await setup();
  for (let i = 0; i < 15; i++) db().addCapture({ requester_hash: `h${i}`, created_at: after(-i * MIN).toISOString() });
  const busy = await clip(after(MIN), "198.51.100.9");
  check("16th site-wide refused", busy.status === 429 && /Lots of people/.test(busy.body.error), busy.body.error);
  db().addCapture({ created_by: "admin", requester_hash: null });
  check("admin clips don't count toward it, and admin is exempt", (await admin(after(MIN), "POST", { kind: "clip", seconds: 60 })).status === 200);
});

test("photo limits on the server path: 1 per 20 s and 20 per hour per visitor, 300 per hour site-wide", async () => {
  await setup();
  check("first", (await photo(T0, "192.0.2.1")).status === 200);
  const quick = await photo(after(10_000), "192.0.2.1");
  check("within 20 s refused", quick.status === 429 && /another in 10 seconds/.test(quick.body.error), quick.body.error);
  for (let i = 1; i < 20; i++) check(`photo ${i + 1}`, (await photo(after(i * 21_000), "192.0.2.1")).status === 200);
  const over = await photo(after(30 * MIN), "192.0.2.1");
  check("21st in the hour refused", over.status === 429 && /20 photos/.test(over.body.error), over.body.error);

  await setup();
  for (let i = 0; i < 300; i++) db().addCapture({ kind: "photo", requester_hash: `p${i}`, created_at: T0.toISOString() });
  const busy = await photo(after(MIN), "192.0.2.50");
  check("301st site-wide refused", busy.status === 429, JSON.stringify(busy.body));
  check("a clip is still fine (separate budget)", (await clip(after(MIN), "192.0.2.50")).status === 200);
});

test("clip length caps: visitors 15 or 30 s, the admin up to 60 s", async () => {
  await setup();
  check("visitor 15 ok", (await clip(T0, "10.0.0.1", 15)).status === 200);
  check("visitor 30 ok", (await clip(T0, "10.0.0.2", 30)).status === 200);
  for (const s of [60, 45, 0, -5, 31, "30", null]) {
    const r = await clip(T0, "10.0.0.3", s);
    check(`visitor ${JSON.stringify(s)} refused`, r.status === 400 && /15 or 30 seconds/.test(r.body.error), JSON.stringify(r.body));
  }
  check("admin 60 ok", (await admin(T0, "POST", { kind: "clip", seconds: 60 })).status === 200);
  check("admin 90 refused", (await admin(T0, "POST", { kind: "clip", seconds: 90 })).status === 400);
  const junk = await visitor(T0, { kind: "gif" });
  check("unknown kind refused", junk.status === 400);
  const notJson = await at(T0, () => publicRoute.POST(new Request("http://localhost/api/capture", { method: "POST", body: "nope" })));
  check("non-JSON refused", notJson.status === 400);
});

test("admin captures have no limits and keep 48 hours", async () => {
  const { fake } = await setup();
  for (let i = 0; i < 8; i++) check(`admin clip ${i + 1}`, (await admin(after(i), "POST", { kind: "clip", seconds: 15 })).status === 200);
  const row = fake.db.captures[0];
  check("created_by admin, no hash", row.created_by === "admin" && row.requester_hash === null);
  check("48 h expiry", row.expires_at === after(48 * HOUR).toISOString(), row.expires_at);
});

test("the pause switch stops visitor captures (not the admin), and the GET says so", async () => {
  const { fake } = await setup();
  const before = await at(T0, () => publicRoute.GET(call("GET", "/api/capture")));
  check("enabled, not paused", before.body.enabled === true && before.body.paused === false);
  check("paused", (await at(T0, () => pauseRoute.POST(call("POST", "/api/admin/captures/pause", { paused: true })))).status === 200);
  check("setting stored", fake.db.site_settings.find((s) => s.key === "captures_paused")?.value === true);
  const r = await clip(T0, "10.1.1.1");
  check("visitor clip refused, friendly", r.status === 403 && /paused/.test(r.body.error));
  check("visitor server photo refused too", (await photo(T0, "10.1.1.1")).status === 403);
  check("nothing stored", fake.db.captures.length === 0);
  check("admin still can", (await admin(T0, "POST", { kind: "photo" })).status === 200);
  const now = await at(T0, () => publicRoute.GET(call("GET", "/api/capture")));
  check("GET reports paused", now.body.paused === true);
  await at(T0, () => pauseRoute.POST(call("POST", "/api/admin/captures/pause", { paused: false })));
  check("resumed", (await clip(T0, "10.1.1.1")).status === 200);
  check("bad body refused", (await at(T0, () => pauseRoute.POST(call("POST", "/x", { paused: "yes" })))).status === 400);
});

test("storage budget: over 5 GB of live visitor captures refuses new ones; featured, kept and expired don't count", async () => {
  const { fake } = await setup();
  const GB = 1024 ** 3;
  const future = after(10 * HOUR).toISOString();
  fake.addCapture({ bytes: 3 * GB, expires_at: future, requester_hash: "a", created_at: after(-5 * HOUR).toISOString() });
  fake.addCapture({ bytes: 3 * GB, expires_at: future, featured: true, requester_hash: null, created_at: after(-5 * HOUR).toISOString() });
  fake.addCapture({ bytes: 3 * GB, expires_at: null, kept: true, requester_hash: null, created_at: after(-5 * HOUR).toISOString() });
  fake.addCapture({ bytes: 3 * GB, expires_at: after(-1 * HOUR).toISOString(), requester_hash: "b", created_at: after(-25 * HOUR).toISOString() });
  fake.addCapture({ bytes: 3 * GB, expires_at: future, created_by: "admin", requester_hash: null, created_at: after(-5 * HOUR).toISOString() });
  check("3 GB counted: allowed", (await clip(T0, "10.2.2.2")).status === 200);

  fake.addCapture({ bytes: 2.5 * GB, expires_at: future, requester_hash: "c", created_at: after(-5 * HOUR).toISOString() });
  const full = await clip(after(10 * MIN), "10.2.2.3");
  check("over 5 GB: refused with the friendly message", full.status === 507 && full.body.error === "Captures are full right now, try again later.", JSON.stringify(full.body));
  check("server photos too", (await photo(after(10 * MIN), "10.2.2.3")).status === 507);
  check("the admin is not limited by it", (await admin(after(10 * MIN), "POST", { kind: "clip", seconds: 30 })).status === 200);
  check("the budget is a constant you can change", shared.VISITOR_STORAGE_BUDGET_BYTES === 5 * GB);
});

test("latency: reported delay shifted, missing / invalid use 14 s, oversized clamped to the buffer", () => {
  const r = shared.resolveDelay;
  check("reported 12.3 -> 14.3", r(12.3, 30).delay === 14.3 && r(12.3, 30).source === "reported");
  for (const bad of [undefined, null, NaN, Infinity, -1, "12", {}, 99999]) {
    const out = r(bad, 30);
    check(`invalid ${String(bad)} -> fallback 14`, out.delay === 14 && out.source === "fallback", JSON.stringify(out));
  }
  const paused = r(400, 30);
  check("paused/rewound 400 s -> clamped to 150-30-4 = 116", paused.delay === 116 && paused.source === "clamped", JSON.stringify(paused));
  check("a 60 s admin clip clamps lower", r(400, 60).delay === 86);
  check("a photo can go back furthest", r(400, 0).delay === 146);
  check("measured fallback is 14 s", shared.FALLBACK_DELAY_SECONDS === 14);
});

test("latency on the VPS side: clamped to what the buffer holds right now, never refused", () => {
  // 20 segments of 2 s = 40 s buffer (e.g. just restarted), newest ending now.
  const now = 1_000_000;
  const segs = Array.from({ length: 20 }, (_, i) => ({ name: `seg-${i}.ts`, duration: 2, endMs: now - (19 - i) * 2000 }));
  const ok = clampShift(10, 15, segs);
  check("10 s fits", ok.shift === 10 && !ok.clamped);
  const big = clampShift(120, 15, segs);
  check("120 s clamped to what's held (40 - 4 margin - 15 = 21)", big.shift === 21 && big.clamped, JSON.stringify(big));
  const huge = clampShift(120, 60, segs);
  check("longer than the buffer: shift 0, still captures what there is", huge.shift === 0 && huge.clamped);
  check("NaN treated as 0", clampShift(NaN, 15, segs).shift === 0);
  check("empty buffer", clampShift(10, 15, []) === null);

  const picked = pickClipSegments(segs, 15, 10);
  const windowEnd = now - (2 + 10) * 1000;
  check("clip covers about 15 s in whole 2 s segments", picked.length >= 8 && picked.length <= 9, String(picked.length));
  check("clip ends at the shifted point", picked[picked.length - 1].endMs >= windowEnd && picked[picked.length - 1].endMs - 2000 < windowEnd);

  const frame = pickPhotoFrame(segs, 5);
  const target = now - 7000;
  check("photo frame in the right segment", frame.segment.endMs > target && frame.segment.endMs - 2000 <= target);
  check("offset inside it", frame.offsetSeconds >= 0 && frame.offsetSeconds < 2);

  const parsed = parsePlaylist("#EXTM3U\n#EXTINF:2.000000,\nseg-1.ts\n#EXTINF:2.0,\n../etc/passwd\n#EXTINF:x,\nseg-3.ts\n#EXTINF:1.9,\nseg-4.ts\n");
  check("playlist: only well-formed segment names kept", parsed.map((s) => s.name).join() === "seg-1.ts,seg-4.ts", JSON.stringify(parsed));
});

test("the site sends the fallback or clamped delay to the VPS", async () => {
  const { vps } = await setup();
  await visitor(T0, { kind: "clip", seconds: 30 }, "10.3.3.1");
  await clip(T0, "10.3.3.2", 30, "garbage");
  await clip(T0, "10.3.3.3", 30, 900);
  const sent = captureRequests(vps).map((r) => r.body.behind_live_seconds);
  check("missing -> 14, invalid -> 14, oversized -> 116", sent.join() === "14,14,116", sent.join());
  vps.clamped = true;
  const r = await clip(T0, "10.3.3.4", 30, 5);
  check("VPS clamping is reported back", r.body.capture.clamped === true);
});

test("external video links: YouTube, TikTok and Instagram only, https, embeddable", () => {
  const p = shared.parseExternalVideoUrl;
  const yt = p("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10");
  check("youtube watch", yt?.provider === "youtube" && yt.embedUrl === "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  check("youtu.be", p("https://youtu.be/dQw4w9WgXcQ")?.embedUrl === "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  check("shorts", p("https://youtube.com/shorts/dQw4w9WgXcQ")?.provider === "youtube");
  check("m.youtube", p("https://m.youtube.com/watch?v=dQw4w9WgXcQ")?.provider === "youtube");
  const tt = p("https://www.tiktok.com/@desktopsafari/video/7301234567890123456");
  check("tiktok", tt?.embedUrl === "https://www.tiktok.com/player/v1/7301234567890123456");
  const ig = p("https://www.instagram.com/reel/C1aBcDeFgH/");
  check("instagram reel", ig?.embedUrl === "https://www.instagram.com/reel/C1aBcDeFgH/embed");
  check("instagram post", p("https://instagram.com/p/C1aBcDeFgH")?.provider === "instagram");
  for (const bad of [
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
    "https://evil.com/?u=https://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/channel/UC123",
    "https://user:pw@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
    "https://vm.tiktok.com/ZMabc123/",
    "https://www.tiktok.com/@x/photo/7301234567890123456",
    "https://www.instagram.com/desktopsafari/",
    "https://vimeo.com/123456",
    "javascript:alert(1)",
    "data:text/html,hi",
    "",
    42,
  ]) {
    check(`refused: ${String(bad)}`, p(bad) === null);
  }
});

test("featuring clears the hash; plain Feature keeps the file for good, Feature with a link lets it expire", async () => {
  const { fake } = await setup();
  const a = (await clip(T0, "10.4.4.1")).body.capture;
  const b = (await clip(T0, "10.4.4.2")).body.capture;
  const rowA = () => fake.db.captures.find((r) => r.id === a.id);
  const rowB = () => fake.db.captures.find((r) => r.id === b.id);
  check("hash before", !!rowA().requester_hash);

  check("feature", (await admin(T0, "PATCH", { id: a.id, action: "feature" })).status === 200);
  check("featured, hash cleared, never expires", rowA().featured && rowA().requester_hash === null && rowA().expires_at === null && rowA().featured_at);

  const bad = await admin(T0, "PATCH", { id: b.id, action: "feature", externalUrl: "https://vimeo.com/1" });
  check("bad link refused, nothing changed", bad.status === 400 && /YouTube, TikTok or Instagram/.test(bad.body.error) && !rowB().featured);
  const expiresBefore = rowB().expires_at;
  check("feature with link", (await admin(T0, "PATCH", { id: b.id, action: "feature", externalUrl: "https://youtu.be/dQw4w9WgXcQ" })).status === 200);
  check("link stored normalized, hash cleared, file still expires", rowB().external_url === "https://www.youtube.com/watch?v=dQw4w9WgXcQ" && rowB().requester_hash === null && rowB().expires_at === expiresBefore);

  const gallery = await lib.loadGallery(fake, "main");
  check("gallery: both featured", gallery.length === 2);
  const g = gallery.find((i) => i.id === b.id);
  check("linked one embeds, no VPS file link", g.embed?.provider === "youtube" && g.url === null && g.downloadUrl === null);
  check("plain one serves the VPS file", gallery.find((i) => i.id === a.id).downloadUrl === a.downloadUrl);
  check("gallery leaks nothing about the requester", !JSON.stringify(gallery).includes("requester") && !JSON.stringify(gallery).includes("expires"));

  check("unfeature", (await admin(T0, "PATCH", { id: a.id, action: "unfeature" })).status === 200);
  check("unfeatured gets a fresh 24 h", !rowA().featured && rowA().expires_at === after(24 * HOUR).toISOString());
  check("gallery: one left", (await lib.loadGallery(fake, "main")).length === 1);

  const c = (await clip(after(4 * MIN), "10.4.4.1")).body.capture;
  const rowC = () => fake.db.captures.find((r) => r.id === c.id);
  check("keep", (await admin(T0, "PATCH", { id: c.id, action: "keep" })).status === 200);
  check("kept: no expiry, hash cleared, not in gallery", rowC().kept && rowC().expires_at === null && rowC().requester_hash === null);
  check("unknown action", (await admin(T0, "PATCH", { id: c.id, action: "explode" })).status === 400);
  check("unknown id", (await admin(T0, "PATCH", { id: "x".repeat(22), action: "keep" })).status === 404);
  check("bad id", (await admin(T0, "PATCH", { id: "../../etc", action: "keep" })).status === 400);
});

test("expiry cleanup: expired visitor captures deleted on the VPS, then the rows; featured and kept stay", async () => {
  const { fake, vps } = await setup();
  const old = (await clip(T0, "10.5.5.1")).body.capture;
  const featured = (await clip(T0, "10.5.5.2")).body.capture;
  const linked = (await clip(T0, "10.5.5.3")).body.capture;
  const kept = (await clip(T0, "10.5.5.4")).body.capture;
  const adminClip = (await admin(T0, "POST", { kind: "clip", seconds: 15 })).body.capture;
  await admin(T0, "PATCH", { id: featured.id, action: "feature" });
  await admin(T0, "PATCH", { id: linked.id, action: "feature", externalUrl: "https://www.instagram.com/reel/C1aBcDeFgH/" });
  await admin(T0, "PATCH", { id: kept.id, action: "keep" });

  const early = await cron(after(23 * HOUR));
  check("nothing due before 24 h", early.body.deleted === 0 && fake.db.captures.length === 5, JSON.stringify(early.body));

  const run = await cron(after(25 * HOUR));
  check("ran", run.status === 200 && run.body.ok, JSON.stringify(run.body));
  const ids = fake.db.captures.map((r) => r.id);
  check("expired visitor clip gone", !ids.includes(old.id));
  check("its files deleted on the VPS", !vps.files.has(`${old.id}.mp4`) && !vps.files.has(`${old.id}-t.jpg`));
  check("featured stays with its file", ids.includes(featured.id) && vps.files.has(`${featured.id}.mp4`));
  check("kept stays", ids.includes(kept.id) && vps.files.has(`${kept.id}.mp4`));
  const l = fake.db.captures.find((r) => r.id === linked.id);
  check("linked featured: row stays, VPS video removed, thumbnail kept", l && l.file_name === null && !vps.files.has(`${linked.id}.mp4`) && vps.files.has(`${linked.id}-t.jpg`));
  check("admin clip (48 h) not yet", ids.includes(adminClip.id));
  check("still in the gallery via its link", (await lib.loadGallery(fake, "main")).some((g) => g.id === linked.id && g.embed));

  await cron(after(49 * HOUR));
  check("admin clip gone after 48 h", !fake.db.captures.some((r) => r.id === adminClip.id));
});

test("cleanup tolerates the VPS being down: nothing removed, retried next run", async () => {
  const { fake, vps } = await setup();
  const c = (await clip(T0, "10.6.6.1")).body.capture;
  vps.down = true;
  const down = await cron(after(25 * HOUR));
  check("reports the VPS down, no crash", down.status === 200 && down.body.vpsDown === true, JSON.stringify(down.body));
  check("row kept", fake.db.captures.length === 1);
  vps.down = false;
  vps.deleteFails = true;
  check("VPS error also keeps the row", (await cron(after(26 * HOUR))).body.vpsDown === true && fake.db.captures.length === 1);
  vps.deleteFails = false;
  await cron(after(27 * HOUR));
  check("next run cleans up", fake.db.captures.length === 0 && !vps.files.has(`${c.id}.mp4`));
});

test("cleanup also clears failed and stuck attempts (including any files they left)", async () => {
  const { fake, vps } = await setup();
  vps.down = true;
  const r = await clip(T0, "10.7.7.1");
  check("VPS down: friendly 502", r.status === 502 && /isn't responding/.test(r.body.error), JSON.stringify(r.body));
  check("row marked failed", fake.db.captures[0].status === "failed");
  vps.down = false;
  check("a failed attempt doesn't count toward the 3-minute limit", (await clip(after(MIN), "10.7.7.1")).status === 200);
  fake.addCapture({ status: "pending", created_at: T0.toISOString(), expires_at: after(24 * HOUR).toISOString() });
  await cron(after(2 * HOUR));
  check("failed and stuck rows gone, the good one stays", fake.db.captures.length === 1 && fake.db.captures[0].status === "ready");
  const del = vps.requests.find((q) => q.path === "/files");
  check("their file names were sent for deletion", del && del.body.names.length === 4, JSON.stringify(del?.body));
});

test("VPS failures map to friendly messages and don't count as captures", async () => {
  const { fake, vps } = await setup();
  const cases = [
    [{ status: 409, error: "offline" }, 409, /offline/],
    [{ status: 409, error: "not_enough_buffer" }, 409, /just came back/],
    [{ status: 507, error: "disk_full" }, 507, /^Captures are full right now, try again later\.$/],
    [{ status: 503, error: "busy" }, 503, /Try again in a few seconds/],
    [{ status: 500, error: "failed" }, 502, /went wrong/],
  ];
  let n = 0;
  for (const [reply, status, re] of cases) {
    vps.reply = reply;
    const r = await clip(after(n++ * 4 * MIN), "10.8.8.1");
    check(`${reply.status} ${reply.error} -> ${status}`, r.status === status && re.test(r.body.error), JSON.stringify(r.body));
  }
  check("all marked failed", fake.db.captures.every((c) => c.status === "failed"));
  vps.reply = null;
  check("works once the VPS is fine", (await clip(after(n * 4 * MIN), "10.8.8.1")).status === 200);
});

test("admin delete: VPS files first, then the row; VPS down keeps the row", async () => {
  const { fake, vps } = await setup();
  const c = (await admin(T0, "POST", { kind: "photo" })).body.capture;
  check("admin photo made", c && vps.files.has(`${c.id}.jpg`));
  vps.down = true;
  const down = await admin(T0, "DELETE", { id: c.id });
  check("refused while the VPS is down", down.status === 502 && fake.db.captures.length === 1);
  vps.down = false;
  check("deleted", (await admin(T0, "DELETE", { id: c.id })).status === 200);
  check("row and files gone", fake.db.captures.length === 0 && !vps.files.has(`${c.id}.jpg`) && !vps.files.has(`${c.id}-t.jpg`));
});

test("admin overview: usage, budget, kept warning, VPS status (or not responding)", async () => {
  const { fake, vps } = await setup();
  const GB = 1024 ** 3;
  fake.addCapture({ bytes: 2 * GB, featured: true, expires_at: null });
  fake.addCapture({ bytes: 1.5 * GB, kept: true, expires_at: null });
  fake.addCapture({ bytes: 1 * GB, expires_at: after(HOUR).toISOString() });
  const o = await admin(T0, "GET");
  check("supported", o.body.supported === true);
  check("visitor budget usage", o.body.usage.visitorBytes === 1 * GB && o.body.usage.visitorBudgetBytes === 5 * GB);
  check("featured + kept over 3 GB warns", o.body.usage.keptBytes === 3.5 * GB && o.body.usage.keptWarning === true);
  check("total", o.body.usage.totalBytes === 4.5 * GB);
  check("disk from the VPS", o.body.server.disk.freeBytes === 20 * GB);
  check("no hashes in the admin list", !JSON.stringify(o.body).includes("requester"));
  vps.down = true;
  const d = await admin(T0, "GET");
  check("VPS down: still loads, server null", d.body.supported === true && d.body.server === null);
});

test("invisible until set up: no table or no env vars -> buttons hidden, admin says what to do", async () => {
  await setup({ capturesTable: false });
  const g = await at(T0, () => publicRoute.GET(call("GET", "/api/capture")));
  check("no table: not enabled", g.body.enabled === false);
  const a = await admin(T0, "GET");
  check("admin hint names the SQL file", a.body.supported === false && /captures\.sql/.test(a.body.hint));
  const r = await clip(T0, "10.9.9.1");
  check("POST refused politely", r.status === 503 && /aren't available/.test(r.body.error));

  await setup();
  const saved = process.env.CAPTURE_SECRET;
  delete process.env.CAPTURE_SECRET;
  try {
    check("no secret: not enabled", (await at(T0, () => publicRoute.GET(call("GET", "/api/capture")))).body.enabled === false);
    check("no secret: POST refused", (await clip(T0, "10.9.9.2")).status === 503);
    check("admin hint names the env vars", /CAPTURE_SECRET/.test((await admin(T0, "GET")).body.hint));
  } finally {
    process.env.CAPTURE_SECRET = saved;
  }
});

test("the cron route needs its own bearer secret", async () => {
  await setup();
  check("no header", (await cron(T0, null)).status === 401);
  check("wrong secret", (await cron(T0, "nope")).status === 401);
  check("the general CRON_SECRET doesn't work", (await cron(T0, "test-secret")).status === 401);
  check("right secret", (await cron(T0)).status === 200);
  const saved = process.env.CAPTURE_CRON_SECRET;
  delete process.env.CAPTURE_CRON_SECRET;
  try {
    check("unset secret refuses everything", (await cron(T0, "")).status === 401);
  } finally {
    process.env.CAPTURE_CRON_SECRET = saved;
  }
});

test("admin capture routes refuse requests without the admin login", async () => {
  for (const [path, method] of [["/api/admin/captures", "GET"], ["/api/admin/captures", "POST"], ["/api/admin/captures", "PATCH"], ["/api/admin/captures", "DELETE"], ["/api/admin/captures/pause", "POST"]]) {
    const res = await proxyModule.proxy(new NextRequest(`http://localhost${path}`, { method }));
    check(`${method} ${path}: 401 without login`, res.status === 401);
    const forged = await proxyModule.proxy(new NextRequest(`http://localhost${path}`, { method, headers: { cookie: "admin_session=admin:9999999999999.deadbeef" } }));
    check(`${method} ${path}: forged cookie refused`, forged.status === 401);
  }
  check("the public capture route is not behind the login", !proxyModule.config.matcher.some((m) => m.startsWith("/api/capture")));
});

test("the public database key can read nothing: RLS on, no policies, no grants", () => {
  const sql = fs.readFileSync(new URL("../supabase/captures.sql", import.meta.url), "utf8");
  const code = sql.replace(/--.*$/gm, "");
  check("RLS on", code.includes("alter table captures enable row level security;"));
  check("no policies", !/create\s+policy/i.test(code));
  check("anon/authenticated revoked", /revoke all on captures from anon, authenticated;/.test(code));
  check("no grants", !/\bgrant\b/i.test(code));
  check("pause setting seeded", code.includes("'captures_paused'"));
  for (const col of ["stream_id text not null default 'main'", "requester_hash", "external_url", "expires_at", "featured_at", "kept", "thumb_name"]) {
    check(`column ${col}`, code.includes(col));
  }
});
