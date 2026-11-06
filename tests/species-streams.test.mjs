import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, formReq, fresh, json, load, png, req } from "./support/helpers.mjs";

// Species cards with two streams: the frog stream (id 'main', slug 'frogs') and
// a TEST fish stream (id and slug 'fish'). One card per stream; a card on one
// stream never shows on, or is changed from, the other.

const SPECIES = "species-images";
const publicRoute = await load("app/api/species/route.ts");
const adminRoute = await load("app/api/admin/species/route.ts");
const imageRoute = await load("app/api/admin/species/image/route.ts");

const cardOn = async (stream) =>
  json(await publicRoute.GET(req("GET", stream === undefined ? "/api/species" : `/api/species?stream=${encodeURIComponent(stream)}`)));
const call = async (route, method, url, body) => json(await route[method](req(method, url, body)));
const save = (url, body) => call(adminRoute, "PUT", url, { infoBlocks: [], ...body });
const card = (fake, streamId) => fake.db.species_cards.find((c) => c.stream_id === streamId);

test("public: each stream shows only its own card; default frog stream; unknown 404", async () => {
  const fake = await fresh();
  fake.addStream();
  fake.addSpeciesCard({ stream_id: "fish", species_name: "TEST clownfish" });

  check("frog page (no ?stream=): no card", (await cardOn()).body.card === null);
  check("?stream=frogs: no card", (await cardOn("frogs")).body.card === null);
  const fish = await cardOn("fish");
  check("?stream=fish: the fish card", fish.status === 200 && fish.body.card?.speciesName === "TEST clownfish", JSON.stringify(fish.body));

  fake.addSpeciesCard({ species_name: "TEST dart frog" });
  check("frog page: the frog card", (await cardOn()).body.card?.speciesName === "TEST dart frog");
  check("?stream=main: the frog card", (await cardOn("main")).body.card?.speciesName === "TEST dart frog");
  check("fish page still the fish card", (await cardOn("fish")).body.card?.speciesName === "TEST clownfish");
  check("unknown stream: 404", (await cardOn("nope")).status === 404);
  check("malformed stream: 400", (await cardOn("../x")).status === 400);
});

test("admin: reads and saves only the stream asked for (default frog stream)", async () => {
  const fake = await fresh();
  fake.addStream();
  const frog = fake.addSpeciesCard({ species_name: "TEST dart frog" });

  const g = await call(adminRoute, "GET", "/api/admin/species");
  check("admin GET, no stream: the frog card", g.status === 200 && g.body.card?.speciesName === "TEST dart frog");
  const gFish = await call(adminRoute, "GET", "/api/admin/species?stream=fish");
  check("admin GET ?stream=fish: no card yet", gFish.status === 200 && gFish.body.card === null);

  const s = await save("/api/admin/species", { speciesName: "TEST frog edited" });
  check("save with no stream edits the frog card", s.status === 200 && frog.species_name === "TEST frog edited" && !card(fake, "fish"));

  const sFish = await save("/api/admin/species", { speciesName: "TEST clownfish", stream_id: "fish", names: "Nemo" });
  check("save with stream_id fish creates the fish card", sFish.status === 200 && card(fake, "fish")?.species_name === "TEST clownfish", JSON.stringify(sFish.body));
  check("and leaves the frog card alone", frog.species_name === "TEST frog edited" && frog.names.length === 0);
  check("still one card per stream", fake.db.species_cards.length === 2);

  const again = await save("/api/admin/species?stream=fish", { speciesName: "TEST clownfish 2" });
  check("saving fish again updates the same card", again.status === 200 && fake.db.species_cards.length === 2 && card(fake, "fish").species_name === "TEST clownfish 2");
  check("the public fish page shows it", (await cardOn("fish")).body.card.speciesName === "TEST clownfish 2");
  check("the frog page doesn't", (await cardOn()).body.card.speciesName === "TEST frog edited");

  const before = JSON.stringify(fake.db.species_cards);
  check("admin GET unknown stream: 404", (await call(adminRoute, "GET", "/api/admin/species?stream=nope")).status === 404);
  check("save on unknown stream: 404", (await save("/api/admin/species", { speciesName: "TEST x", stream_id: "nope" })).status === 404);
  check("nothing changed", JSON.stringify(fake.db.species_cards) === before);
});

test("pictures: only the stream asked for; new files under the stream's folder", async () => {
  const fake = await fresh();
  fake.addStream();
  const frog = fake.addSpeciesCard({ species_name: "TEST dart frog" });
  const fish = fake.addSpeciesCard({ stream_id: "fish", species_name: "TEST clownfish" });

  const up = await json(await imageRoute.POST(formReq("POST", "/api/admin/species/image", png(), { kind: "photo" })));
  check("no stream: frog photo, under main/ as before", up.status === 200 && /^main\/photo-\d+\.png$/.test(frog.photo_path) && fish.photo_path === null);
  const upFish = await json(await imageRoute.POST(formReq("POST", "/api/admin/species/image", png(), { kind: "photo", stream_id: "fish" })));
  check("stream_id fish: fish photo under fish/", upFish.status === 200 && /^fish\/photo-\d+\.png$/.test(fish.photo_path));
  check("frog photo untouched", /^main\//.test(frog.photo_path) && fake.fileExists(SPECIES, frog.photo_path));

  const frogPath = frog.photo_path;
  const rmFish = await call(imageRoute, "DELETE", "/api/admin/species/image?kind=photo&stream=fish");
  check("removing the fish photo leaves the frog one", rmFish.status === 200 && fish.photo_path === null && frog.photo_path === frogPath && fake.fileExists(SPECIES, frogPath));
  const unknown = await json(await imageRoute.POST(formReq("POST", "/api/admin/species/image", png(), { kind: "photo", stream_id: "nope" })));
  check("unknown stream: 404, nothing uploaded", unknown.status === 404 && ![...fake.files.keys()].some((k) => k.includes("nope")));
  check("delete on unknown stream: 404", (await call(imageRoute, "DELETE", "/api/admin/species/image?kind=photo&stream=nope")).status === 404 && frog.photo_path === frogPath);
});

test("no file outside src/lib/data/species/ queries the species table", () => {
  const src = path.resolve(fileURLToPath(new URL("../src/", import.meta.url)));
  const own = path.join(src, "lib", "data", "species");
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (p !== own) walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      const text = fs.readFileSync(p, "utf8");
      if (/\.from\(\s*["']species_cards["']/.test(text) || /\.from\(\s*SPECIES_BUCKET\s*\)/.test(text)) offenders.push(path.relative(src, p));
    }
  };
  walk(src);
  check("species_cards and its pictures are only touched in the data layer", offenders.length === 0, offenders.join(", "));
});
