import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUCKET, check, formReq, fresh, json, load, png, req } from "./support/helpers.mjs";

// Suggestion (naming) events with two streams: the frog stream (id 'main',
// slug 'frogs') and a TEST fish stream (id and slug 'fish'). Each event
// belongs to one stream; its frogs and name ideas follow it. Nothing on one
// stream may show up on, block, or be changed from the other.

const publicRoute = await load("app/api/suggestion-event/route.ts");
const suggestRoute = await load("app/api/suggestion-event/suggest/route.ts");
const adminRoute = await load("app/api/admin/suggestion-events/route.ts");
const frogsRoute = await load("app/api/admin/suggestion-events/frogs/route.ts");
const imageRoute = await load("app/api/admin/suggestion-events/image/route.ts");
const namesRoute = await load("app/api/admin/name-suggestions/route.ts");

const shownOn = async (stream) =>
  json(await publicRoute.GET(req("GET", stream === undefined ? "/api/suggestion-event" : `/api/suggestion-event?stream=${encodeURIComponent(stream)}`)));
const call = async (route, method, url, body) => json(await route[method](req(method, url, body)));
let ip = 0;
const suggest = async (body) =>
  json(await suggestRoute.POST(new Request("http://localhost/api/suggestion-event/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `10.0.0.${++ip}` },
    body: JSON.stringify(body),
  })));

test("public: each stream shows only its own active event", async () => {
  const fake = await fresh();
  fake.addStream();
  const fish = fake.addEvent({ stream_id: "fish", prompt: "TEST fish names" });

  check("frog page (no ?stream=) has no event", (await shownOn()).body.event === null);
  check("?stream=frogs has no event", (await shownOn("frogs")).body.event === null);
  const onFish = await shownOn("fish");
  check("?stream=fish shows the fish event", onFish.status === 200 && onFish.body.event?.id === fish.event.id, JSON.stringify(onFish.body));
  check("with its frogs", onFish.body.event.frogs.map((f) => f.id).join() === fish.frogs.map((f) => f.id).join());

  const frog = fake.addEvent({ prompt: "TEST frog names" });
  check("frog page shows the frog event", (await shownOn()).body.event?.id === frog.event.id);
  check("?stream=main too", (await shownOn("main")).body.event?.id === frog.event.id);
  check("fish page still shows the fish event", (await shownOn("fish")).body.event?.id === fish.event.id);
  check("unknown stream: 404", (await shownOn("nope")).status === 404);
  check("malformed stream: 400", (await shownOn("../x")).status === 400);
});

test("name ideas go to the event's own stream; frogs can't be mixed across events", async () => {
  const fake = await fresh();
  fake.addStream();
  const fish = fake.addEvent({ stream_id: "fish" });
  const frog = fake.addEvent({});

  const toFish = await suggest({ eventId: fish.event.id, frogId: fish.frogs[0].id, text: "Bubbles" });
  check("an idea for the active fish event is saved", toFish.status === 200 && fake.db.name_suggestions.some((n) => n.event_id === fish.event.id && n.text === "Bubbles"), JSON.stringify(toFish.body));
  const toFrog = await suggest({ eventId: frog.event.id, frogId: frog.frogs[1].id, text: "Hopper" });
  check("and for the active frog event", toFrog.status === 200);
  const mixed = await suggest({ eventId: frog.event.id, frogId: fish.frogs[0].id, text: "Mixed" });
  check("a fish frog can't be used on the frog event", mixed.status === 400 && !fake.db.name_suggestions.some((n) => n.text === "Mixed"));

  fish.event.is_on = false;
  const closed = await suggest({ eventId: fish.event.id, frogId: fish.frogs[0].id, text: "Late" });
  check("switched off: closed", closed.status === 409 && closed.body.code === "event_closed");
  check("the frog event is unaffected", (await suggest({ eventId: frog.event.id, frogId: frog.frogs[0].id, text: "Still" })).status === 200);
  check("unknown event: closed", (await suggest({ eventId: "00000000-0000-0000-0000-000000000000", frogId: frog.frogs[0].id, text: "x" })).status === 409);
});

test("admin: list and create per stream; one active event per stream, not across streams", async () => {
  const fake = await fresh();
  fake.addStream();
  const fish = fake.addEvent({ stream_id: "fish", prompt: "TEST fish on" });
  const frogOff = fake.addEvent({ prompt: "TEST frog off", is_on: false });

  const frogList = (await call(adminRoute, "GET", "/api/admin/suggestion-events")).body.events;
  check("frog list: only frog events", frogList.length === 1 && frogList[0].id === frogOff.event.id);
  const fishList = (await call(adminRoute, "GET", "/api/admin/suggestion-events?stream=fish")).body.events;
  check("fish list: only fish events", fishList.length === 1 && fishList[0].id === fish.event.id);

  const made = await call(adminRoute, "POST", "/api/admin/suggestion-events", { prompt: "TEST new" });
  check("create with no stream: the frog stream", made.status === 200 && fake.db.suggestion_events.find((e) => e.id === made.body.eventId).stream_id === "main");
  const madeFish = await call(adminRoute, "POST", "/api/admin/suggestion-events", { prompt: "TEST new fish", stream_id: "fish" });
  check("create with stream_id fish", madeFish.status === 200 && fake.db.suggestion_events.find((e) => e.id === madeFish.body.eventId).stream_id === "fish");
  check("unknown stream refused", (await call(adminRoute, "POST", "/api/admin/suggestion-events", { prompt: "x", stream_id: "nope" })).status === 404);

  const frogOn = await call(adminRoute, "PUT", "/api/admin/suggestion-events", { id: frogOff.event.id, prompt: "TEST frog off", isOn: true });
  check("an active fish event doesn't block switching a frog one on", frogOn.status === 200 && frogOff.event.is_on === true, JSON.stringify(frogOn.body));
  const clash = await call(adminRoute, "PUT", "/api/admin/suggestion-events", { id: madeFish.body.eventId, prompt: "TEST new fish", isOn: true, stream_id: "fish" });
  check("but a second fish one is blocked by the first", clash.status === 409 && /TEST fish on/.test(clash.body.error));
});

test("admin can't edit another stream's event, frogs, pictures or name ideas", async () => {
  const fake = await fresh();
  fake.addStream();
  const fish = fake.addEvent({ stream_id: "fish", prompt: "TEST fish", is_on: false });
  const idea = fake.addNameSuggestion(fish.event.id, fish.frogs[0].id, "Bubbles");

  const edit = await call(adminRoute, "PUT", "/api/admin/suggestion-events", { id: fish.event.id, prompt: "TEST hijacked", isOn: false });
  check("edit from the frog stream: not found", edit.status === 404 && fish.event.prompt === "TEST fish");
  const editOk = await call(adminRoute, "PUT", "/api/admin/suggestion-events?stream=fish", { id: fish.event.id, prompt: "TEST fish edited", isOn: false });
  check("edit from the fish stream works", editOk.status === 200 && fish.event.prompt === "TEST fish edited");

  const add = await call(frogsRoute, "POST", "/api/admin/suggestion-events/frogs", { eventId: fish.event.id });
  check("add a frog from the frog stream: not found", add.status === 404 && fake.db.suggestion_event_frogs.length === 2);
  const addOk = await call(frogsRoute, "POST", "/api/admin/suggestion-events/frogs", { eventId: fish.event.id, stream_id: "fish" });
  check("from the fish stream: added", addOk.status === 200 && fake.db.suggestion_event_frogs.length === 3);
  const rm = await call(frogsRoute, "DELETE", "/api/admin/suggestion-events/frogs", { frogId: addOk.body.frogId });
  check("remove a fish frog from the frog stream: not found", rm.status === 404 && fake.db.suggestion_event_frogs.length === 3);
  const rmOk = await call(frogsRoute, "DELETE", "/api/admin/suggestion-events/frogs", { frogId: addOk.body.frogId, stream_id: "fish" });
  check("from the fish stream: removed", rmOk.status === 200 && fake.db.suggestion_event_frogs.length === 2);

  const pic = await json(await imageRoute.POST(formReq("POST", "/api/admin/suggestion-events/image", png(), { frogId: fish.frogs[1].id })));
  check("frog picture from the frog stream: not found", pic.status === 404 && fish.frogs[1].image_path === null && fake.files.size === 0);
  const picOk = await json(await imageRoute.POST(formReq("POST", "/api/admin/suggestion-events/image", png(), { frogId: fish.frogs[1].id, stream_id: "fish" })));
  check("from the fish stream: set", picOk.status === 200 && fake.fileExists(BUCKET, fish.frogs[1].image_path));
  const unpic = await call(imageRoute, "DELETE", `/api/admin/suggestion-events/image?frogId=${fish.frogs[1].id}`);
  check("clearing it from the frog stream: not found", unpic.status === 404 && fish.frogs[1].image_path);
  const unpicOk = await call(imageRoute, "DELETE", `/api/admin/suggestion-events/image?frogId=${fish.frogs[1].id}&stream=fish`);
  check("from the fish stream: cleared", unpicOk.status === 200 && fish.frogs[1].image_path === null);

  const list = await call(namesRoute, "GET", `/api/admin/name-suggestions?eventId=${fish.event.id}`);
  check("name ideas from the frog stream: not found", list.status === 404);
  const listOk = await call(namesRoute, "GET", `/api/admin/name-suggestions?eventId=${fish.event.id}&stream=fish`);
  check("from the fish stream: listed", listOk.status === 200 && listOk.body.frogs[0].groups[0].text === "Bubbles");
  const key = { eventId: fish.event.id, frogId: fish.frogs[0].id, key: idea.normalized_text };
  const sl = await call(namesRoute, "PUT", "/api/admin/name-suggestions", { ...key, shortlisted: true });
  check("shortlist from the frog stream: not found", sl.status === 404 && idea.is_shortlisted === false);
  const slOk = await call(namesRoute, "PUT", "/api/admin/name-suggestions", { ...key, shortlisted: true, stream_id: "fish" });
  check("from the fish stream: shortlisted", slOk.status === 200 && idea.is_shortlisted === true);
  const del = await call(namesRoute, "DELETE", "/api/admin/name-suggestions", key);
  check("delete from the frog stream: not found", del.status === 404 && fake.db.name_suggestions.length === 1);
  const delOk = await call(namesRoute, "DELETE", "/api/admin/name-suggestions", { ...key, stream_id: "fish" });
  check("from the fish stream: deleted", delOk.status === 200 && fake.db.name_suggestions.length === 0);
});

test("no file outside src/lib/data/events/ queries the event tables", () => {
  const src = path.resolve(fileURLToPath(new URL("../src/", import.meta.url)));
  const own = path.join(src, "lib", "data", "events");
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (p !== own) walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      if (/\.from\(\s*["'](suggestion_events|suggestion_event_frogs|name_suggestions)["']/.test(fs.readFileSync(p, "utf8"))) offenders.push(path.relative(src, p));
    }
  };
  walk(src);
  check("event tables are only queried in the data layer", offenders.length === 0, offenders.join(", "));
});
