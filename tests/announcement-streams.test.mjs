import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUCKET, ET, check, formReq, fresh, json, load, png, req, withNow } from "./support/helpers.mjs";

// Announcements with two streams: the frog stream (id 'main', slug 'frogs') and
// a TEST fish stream (id and slug 'fish'). stream_id null = site-wide: shown on
// every stream page. A stream's own announcements never show on, or can be
// changed from, another stream.

const lib = await load("lib/data/announcements/index.ts");
const adminRoute = await load("app/api/admin/announcements/route.ts");
const imageRoute = await load("app/api/admin/announcements/image/route.ts");
const publicRoute = await load("app/api/announcements/route.ts");

const NOW = ET(2026, 11, 10, 13);
const at = (h) => ET(2026, 11, 10, h).toISOString();
const base = { title: "TEST hello", message: "", isOn: true, startMode: "now", endMode: "never" };

const shownOn = (stream) =>
  withNow(NOW, async () =>
    json(await publicRoute.GET(req("GET", stream === undefined ? "/api/announcements" : `/api/announcements?stream=${encodeURIComponent(stream)}`))),
  );
const titlesOn = async (stream) => (await shownOn(stream)).body.announcements.map((a) => a.title);
const admin = (method, url, body) => withNow(NOW, async () => json(await adminRoute[method](req(method, url, body))));

test("public: site-wide plus the stream's own; never another stream's", async () => {
  const fake = await fresh();
  fake.addStream();
  fake.addAnnouncement({ title: "TEST frog", stream_id: "main", created_at: at(8) });
  fake.addAnnouncement({ title: "TEST fish", stream_id: "fish", created_at: at(9) });
  fake.addAnnouncement({ title: "TEST everyone", stream_id: null, created_at: at(7) });

  check("no ?stream= = the frog stream (what the site shows today)", JSON.stringify(await titlesOn()) === JSON.stringify(["TEST everyone", "TEST frog"]), (await titlesOn()).join());
  check("?stream=frogs", JSON.stringify(await titlesOn("frogs")) === JSON.stringify(["TEST everyone", "TEST frog"]));
  check("?stream=main", JSON.stringify(await titlesOn("main")) === JSON.stringify(["TEST everyone", "TEST frog"]));
  check("?stream=fish: site-wide above the fish one", JSON.stringify(await titlesOn("fish")) === JSON.stringify(["TEST everyone", "TEST fish"]), (await titlesOn("fish")).join());
  check("unknown stream: 404", (await shownOn("nope")).status === 404);
  check("malformed stream: 400", (await shownOn("../x")).status === 400);

  const server = await lib.getVisibleAnnouncements(fake, "fish", NOW);
  check("the page's server helper agrees", server.map((a) => a.title).join() === "TEST everyone,TEST fish");
});

test("the 3-card cap counts site-wide and the stream's own together, newest first", async () => {
  const fake = await fresh();
  fake.addStream();
  fake.addAnnouncement({ title: "TEST frog old", created_at: at(6) });
  fake.addAnnouncement({ title: "TEST site old", stream_id: null, created_at: at(7) });
  fake.addAnnouncement({ title: "TEST frog new", created_at: at(9) });
  fake.addAnnouncement({ title: "TEST site new", stream_id: null, created_at: at(10) });
  fake.addAnnouncement({ title: "TEST fish x", stream_id: "fish", created_at: at(11) });

  check(
    "newest 3 of the frog page's 4, site-wide shown first",
    JSON.stringify(await titlesOn()) === JSON.stringify(["TEST site new", "TEST site old", "TEST frog new"]),
    (await titlesOn()).join(),
  );
  const list = (await admin("GET", "/api/admin/announcements")).body.announcements;
  check("admin list: own + site-wide, not the fish one", list.length === 4 && !list.some((a) => a.title === "TEST fish x"));
  check("admin list says which are site-wide", list.filter((a) => a.scope === "site-wide").length === 2 && list.filter((a) => a.scope === "stream").length === 2);
  check("the one left out is waiting", list.find((a) => a.title === "TEST frog old").status.kind === "waiting");
  const fishList = (await admin("GET", "/api/admin/announcements?stream=fish")).body.announcements;
  check("fish admin list: fish + site-wide", fishList.map((a) => a.title).join() === "TEST fish x,TEST site new,TEST site old");
});

test("create: scope site-wide, stream, or nothing (= the stream asked for, the frog stream by default)", async () => {
  const fake = await fresh();
  fake.addStream();
  const row = (id) => fake.db.announcements.find((a) => a.id === id);

  const plain = await admin("POST", "/api/admin/announcements", { ...base, title: "TEST plain" });
  check("no stream, no scope: the frog stream", plain.status === 200 && row(plain.body.id).stream_id === "main");
  const site = await admin("POST", "/api/admin/announcements", { ...base, title: "TEST site", scope: "site-wide" });
  check("scope site-wide: stream_id null", site.status === 200 && row(site.body.id).stream_id === null);
  const fish = await admin("POST", "/api/admin/announcements", { ...base, title: "TEST fish", stream_id: "fish", scope: "stream" });
  check("scope stream + stream_id fish", fish.status === 200 && row(fish.body.id).stream_id === "fish");
  const fishQ = await admin("POST", "/api/admin/announcements?stream=fish", { ...base, title: "TEST fish q" });
  check("?stream=fish, no scope: fish", fishQ.status === 200 && row(fishQ.body.id).stream_id === "fish");

  const before = fake.db.announcements.length;
  const bad = await admin("POST", "/api/admin/announcements", { ...base, scope: "fish" });
  check("any other scope refused", bad.status === 400 && /site-wide/.test(bad.body.error));
  check("unknown stream refused", (await admin("POST", "/api/admin/announcements", { ...base, stream_id: "nope" })).status === 404);
  check("nothing saved from refused requests", fake.db.announcements.length === before);

  check("site-wide shows on both pages", (await titlesOn("frogs")).includes("TEST site") && (await titlesOn("fish")).includes("TEST site"));
});

test("edit and delete: site-wide or the stream's own only, never another stream's", async () => {
  const fake = await fresh();
  fake.addStream();
  const F = fake.addAnnouncement({ title: "TEST fish", stream_id: "fish" });
  const S = fake.addAnnouncement({ title: "TEST site", stream_id: null });
  const M = fake.addAnnouncement({ title: "TEST frog" });

  const fromFrog = await admin("PUT", "/api/admin/announcements", { ...base, id: F.id, title: "TEST hijacked" });
  check("the frog admin can't edit a fish one", fromFrog.status === 404 && F.title === "TEST fish");
  const delFrog = await admin("DELETE", `/api/admin/announcements?id=${F.id}`);
  check("or delete it", delFrog.status === 404 && fake.db.announcements.some((a) => a.id === F.id));
  const fromFish = await admin("PUT", "/api/admin/announcements", { ...base, id: M.id, stream_id: "fish", title: "TEST hijacked" });
  check("and the other way round", fromFish.status === 404 && M.title === "TEST frog");

  const editSite = await admin("PUT", "/api/admin/announcements", { ...base, id: S.id, title: "TEST site edited" });
  check("a site-wide one can be edited from the frog stream", editSite.status === 200 && S.title === "TEST site edited");
  check("editing without scope keeps it site-wide", S.stream_id === null);
  const editSiteFish = await admin("PUT", "/api/admin/announcements?stream=fish", { ...base, id: S.id, title: "TEST site again" });
  check("and from the fish stream", editSiteFish.status === 200 && S.title === "TEST site again" && S.stream_id === null);

  const editFish = await admin("PUT", "/api/admin/announcements", { ...base, id: F.id, stream_id: "fish", title: "TEST fish edited" });
  check("the fish admin can edit the fish one; it stays on fish", editFish.status === 200 && F.title === "TEST fish edited" && F.stream_id === "fish");

  const toSite = await admin("PUT", "/api/admin/announcements", { ...base, id: M.id, scope: "site-wide" });
  check("scope site-wide on edit: becomes site-wide", toSite.status === 200 && M.stream_id === null);
  const toFish = await admin("PUT", "/api/admin/announcements?stream=fish", { ...base, id: M.id, scope: "stream" });
  check("scope stream on edit: moves to the stream asked for", toFish.status === 200 && M.stream_id === "fish");
  check("bad scope on edit refused", (await admin("PUT", "/api/admin/announcements", { ...base, id: S.id, scope: "x" })).status === 400 && S.stream_id === null);

  check("delete a site-wide one from the fish stream", (await admin("DELETE", `/api/admin/announcements?id=${S.id}&stream=fish`)).status === 200 && !fake.db.announcements.some((a) => a.id === S.id));
  check("deleting one that's already gone is fine", (await admin("DELETE", `/api/admin/announcements?id=${S.id}`)).status === 200);
});

test("pictures: only on an announcement the stream may change", async () => {
  const fake = await fresh();
  fake.addStream();
  const F = fake.addAnnouncement({ stream_id: "fish" });
  const S = fake.addAnnouncement({ stream_id: null });

  const up = await json(await imageRoute.POST(formReq("POST", "/api/admin/announcements/image", png(), { id: F.id })));
  check("frog admin can't set a fish picture", up.status === 404 && F.image_path === null && fake.files.size === 0);
  const upFish = await json(await imageRoute.POST(formReq("POST", "/api/admin/announcements/image", png(), { id: F.id, stream_id: "fish" })));
  check("fish admin can", upFish.status === 200 && F.image_path && fake.fileExists(BUCKET, F.image_path));
  const rm = await json(await imageRoute.DELETE(req("DELETE", `/api/admin/announcements/image?id=${F.id}`)));
  check("frog admin can't remove it", rm.status === 404 && fake.fileExists(BUCKET, F.image_path));
  const upSite = await json(await imageRoute.POST(formReq("POST", "/api/admin/announcements/image", png(), { id: S.id })));
  check("site-wide picture from the frog stream", upSite.status === 200 && S.image_path);
  const rmFish = await json(await imageRoute.DELETE(req("DELETE", `/api/admin/announcements/image?id=${F.id}&stream=fish`)));
  check("fish admin removes the fish picture", rmFish.status === 200 && F.image_path === null);
});

test("no file outside src/lib/data/announcements/ queries the announcements table", () => {
  const src = path.resolve(fileURLToPath(new URL("../src/", import.meta.url)));
  const own = path.join(src, "lib", "data", "announcements");
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (p !== own) walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      if (/\.from\(\s*["']announcements["']/.test(fs.readFileSync(p, "utf8"))) offenders.push(path.relative(src, p));
    }
  };
  walk(src);
  check("announcements is only queried in the data layer", offenders.length === 0, offenders.join(", "));
});
