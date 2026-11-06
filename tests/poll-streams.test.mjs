import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ET, byId, check, cronClose, cronOpen, emails, formReq, fresh, json, load, optionsOf, png, publicPoll, queue, req, routes,
  vote, withNow,
} from "./support/helpers.mjs";

// Polls with two streams: the frog stream (id 'main', slug 'frogs') and a
// TEST fish stream (id and slug 'fish'). Nothing on one stream may show up on,
// block, or be changed from the other.

function addPollWithOptions(fake, fields, labels = ["TEST a", "TEST b"]) {
  const poll = fake.addPoll(fields);
  labels.forEach((l, i) => fake.addOption(poll.id, l, i));
  return poll;
}

const publicFor = (date, stream, session = "x") =>
  withNow(date, async () =>
    json(await (await routes.publicPoll()).GET(req("GET", `/api/poll?sessionId=${session}&stream=${encodeURIComponent(stream)}`))),
  );
const call = (date, route, method, url, body) =>
  withNow(date, async () => json(await (await routes[route]())[method](req(method, url, body))));

const NOON = ET(2026, 10, 15, 12, 5);
const AFTERNOON = ET(2026, 10, 15, 14);

test("a poll on one stream never appears on another (public API, votes)", async () => {
  const fake = await fresh();
  fake.addStream();
  const F = addPollWithOptions(fake, { question: "TEST fish poll", status: "open", stream_id: "fish", opens_at: NOON.toISOString() });

  check("frog page (no ?stream=) shows no poll", (await publicPoll(AFTERNOON)).body.poll === null);
  check("?stream=frogs shows no poll", (await publicFor(AFTERNOON, "frogs")).body.poll === null);
  check("?stream=main shows no poll", (await publicFor(AFTERNOON, "main")).body.poll === null);
  const fish = await publicFor(AFTERNOON, "fish");
  check("?stream=fish shows the fish poll", fish.status === 200 && fish.body.poll?.id === F.id, JSON.stringify(fish.body));

  const M = addPollWithOptions(fake, { question: "TEST frog poll", status: "open", opens_at: NOON.toISOString() });
  const frog = await publicPoll(AFTERNOON);
  check("frog page shows only the frog poll", frog.body.poll?.id === M.id);
  check("with only the frog poll's options", frog.body.options.every((o) => optionsOf(M.id).some((m) => m.id === o.option_id)));
  check("fish page still shows the fish poll", (await publicFor(AFTERNOON, "fish")).body.poll?.id === F.id);

  check("unknown stream: 404", (await publicFor(AFTERNOON, "nope")).status === 404);
  check("malformed stream: 400", (await publicFor(AFTERNOON, "../x")).status === 400);

  // One browser can vote once on each stream's poll; counts stay per poll.
  check("vote on the fish poll", (await vote(AFTERNOON, F.id, optionsOf(F.id)[0].id, "s1")).status === 200);
  check("same browser can still vote on the frog poll", (await vote(AFTERNOON, M.id, optionsOf(M.id)[1].id, "s1")).status === 200);
  check("but not twice on the fish poll", (await vote(AFTERNOON, F.id, optionsOf(F.id)[1].id, "s1")).status === 409);
  check("a fish option can't be used on the frog poll", (await vote(AFTERNOON, M.id, optionsOf(F.id)[0].id, "s2")).status === 400);
  const frogCounts = (await publicPoll(AFTERNOON, "s1")).body;
  const fishCounts = (await publicFor(AFTERNOON, "fish", "s1")).body;
  check("frog counts only frog votes", frogCounts.options.map((o) => o.vote_count).join() === "0,1", JSON.stringify(frogCounts.options));
  check("fish counts only fish votes", fishCounts.options.map((o) => o.vote_count).join() === "1,0");
  check("hasVoted is per poll", frogCounts.votedOptionId === optionsOf(M.id)[1].id && fishCounts.votedOptionId === optionsOf(F.id)[0].id);
});

test("one open poll and one queued poll per stream, not across streams", async () => {
  const fake = await fresh();
  fake.addStream();
  const F = addPollWithOptions(fake, { question: "TEST fish open", status: "open", stream_id: "fish", opens_at: ET(2026, 10, 15, 12, 0).toISOString() });
  const Q = addPollWithOptions(fake, { question: "TEST frog queued" });

  const noon = await cronOpen(ET(2026, 10, 15, 12, 10));
  check("the noon job opens the frog poll although a fish poll is open", byId(Q.id).status === "open", JSON.stringify(noon.body));
  check("and leaves the fish poll as it was", byId(F.id).status === "open" && byId(F.id).opens_at === ET(2026, 10, 15, 12, 0).toISOString());
  check("the response reports each stream", noon.status === 200 && noon.body.streams?.length === 2 && /\[frogs\] Poll opened\./.test(noon.body.message) && /\[fish\] A poll is already open/.test(noon.body.message), JSON.stringify(noon.body));

  // Queue: one per stream.
  const frogQueue = await queue(AFTERNOON, { question: "TEST frog next", options: ["a", "b"] });
  const fishQueue = await queue(AFTERNOON, { question: "TEST fish next", options: ["a", "b"], stream_id: "fish" });
  check("frog queue accepted", frogQueue.status === 200);
  check("fish queue accepted although frog already has one queued", fishQueue.status === 200 && byId(fishQueue.body.pollId).stream_id === "fish", JSON.stringify(fishQueue.body));
  const fishAgain = await queue(AFTERNOON, { question: "TEST fish again", options: ["a", "b"], stream_id: "fish" });
  check("a second fish queue is refused", fishAgain.status === 409);

  // Open now on fish: only the fish poll counts as "already open".
  const fresh2 = await fresh();
  fresh2.addStream();
  const M = addPollWithOptions(fresh2, { question: "TEST frog open", status: "open", opens_at: NOON.toISOString() });
  const info = await call(AFTERNOON, "openNow", "GET", `/api/admin/polls/open-now?stream=fish`);
  check("Open now preview on fish sees no open poll", info.status === 200 && info.body.openPoll === null, JSON.stringify(info.body));
  const opened = await call(AFTERNOON, "openNow", "POST", "/api/admin/polls/open-now", { question: "TEST fish now", options: ["a", "b"], stream_id: "fish" });
  check("Open now on fish needs no confirmation and works", opened.status === 200 && byId(opened.body.pollId).stream_id === "fish" && byId(opened.body.pollId).status === "open", JSON.stringify(opened.body));
  check("the frog poll stays open and no email was sent", byId(M.id).status === "open" && emails().length === 0);
  const frogPreview = await call(AFTERNOON, "openNow", "GET", "/api/admin/polls/open-now");
  check("Open now preview on frogs still sees only the frog poll", frogPreview.body.openPoll?.id === M.id);
});

test("the 8 PM job closes each stream's poll; a repeat copy stays on its stream", async () => {
  const fake = await fresh();
  fake.addStream();
  const R = addPollWithOptions(fake, { question: "TEST fish repeat", status: "open", repeat_daily: true, stream_id: "fish", opens_at: NOON.toISOString() }, ["Guppy", "Tetra"]);
  const M = addPollWithOptions(fake, { question: "TEST frog daily", status: "open", opens_at: NOON.toISOString() });

  const eve = await cronClose(ET(2026, 10, 15, 20, 30));
  check("both polls closed", byId(R.id).status === "closed" && byId(M.id).status === "closed", JSON.stringify(eve.body));
  check("one results email each", emails().length === 2);
  const copies = fake.db.polls.filter((p) => p.status === "scheduled");
  check("exactly one copy, on the fish stream", copies.length === 1 && copies[0].stream_id === "fish" && copies[0].question === "TEST fish repeat");
  check("with the fish options", optionsOf(copies[0].id).map((o) => o.label).join() === "Guppy,Tetra");

  // A frog poll queued by hand doesn't pause the fish repeat (the "manual
  // queue wins" rule is per stream).
  const frogQ = await queue(ET(2026, 10, 16, 9), { question: "TEST frog manual", options: ["a", "b"] });
  const noon = await cronOpen(ET(2026, 10, 16, 12, 10));
  check("next noon the fish copy opens on fish", byId(copies[0].id).status === "open" && byId(copies[0].id).stream_id === "fish", JSON.stringify(noon.body));
  check("and the frog poll opens on frogs", byId(frogQ.body.pollId).status === "open" && byId(frogQ.body.pollId).stream_id === "main");

  // Close now on the fish copy queues the next copy on fish too.
  const closed = await call(ET(2026, 10, 16, 15), "closeNow", "POST", "/api/admin/polls/close-now", { pollId: copies[0].id, stream_id: "fish" });
  check("Close now on fish works", closed.status === 200, JSON.stringify(closed.body));
  const next = fake.db.polls.filter((p) => p.status === "scheduled");
  check("the next copy is on fish", next.length === 1 && next[0].stream_id === "fish" && byId(copies[0].id).repeat_paused === false);
});

test("the admin can't act on another stream's poll", async () => {
  const fake = await fresh();
  fake.addStream();
  const F = addPollWithOptions(fake, { question: "TEST fish open", status: "open", stream_id: "fish", opens_at: NOON.toISOString() });
  const C = addPollWithOptions(fake, { question: "TEST fish closed", status: "closed", stream_id: "fish", opens_at: ET(2026, 10, 14, 12).toISOString(), closes_at: ET(2026, 10, 14, 20, 30).toISOString() });
  const S = addPollWithOptions(fake, { question: "TEST fish queued", stream_id: "fish" });
  const before = JSON.stringify(fake.db.polls);

  for (const stream of [undefined, "main", "frogs"]) {
    const extra = stream ? { stream_id: stream } : {};
    const label = stream ?? "(none)";
    check(`close-now ${label}: 404`, (await call(AFTERNOON, "closeNow", "POST", "/api/admin/polls/close-now", { pollId: F.id, ...extra })).status === 404);
    check(`end-time ${label}: 404`, (await call(AFTERNOON, "endTime", "POST", "/api/admin/polls/end-time", { pollId: F.id, endsAtLocal: "2026-10-17T18:00", ...extra })).status === 404);
    check(`edit ${label}: 404`, (await call(AFTERNOON, "polls", "PUT", "/api/admin/polls", { pollId: S.id, question: "TEST changed", ...extra })).status === 404);
    check(`open-now ${label}: 404`, (await call(AFTERNOON, "openNow", "POST", "/api/admin/polls/open-now", { pollId: S.id, ...extra })).status === 404);
    check(`open-now preview ${label}: 404`, (await call(AFTERNOON, "openNow", "GET", `/api/admin/polls/open-now?pollId=${S.id}${stream ? `&stream=${stream}` : ""}`)).status === 404);
  }
  const visibility = await load("app/api/admin/polls/visibility/route.ts");
  const hide = await withNow(AFTERNOON, async () => json(await visibility.POST(req("POST", "/api/admin/polls/visibility", { pollId: C.id, action: "hide" }))));
  check("hide from frogs: 404", hide.status === 404);
  const img = await withNow(AFTERNOON, async () => json(await (await routes.image()).POST(formReq("POST", "/api/admin/polls/image", png(), { pollId: S.id }))));
  check("picture upload from frogs: 404", img.status === 404, JSON.stringify(img.body));
  const imgDel = await call(AFTERNOON, "image", "DELETE", `/api/admin/polls/image?pollId=${S.id}`);
  check("picture remove from frogs: 404", imgDel.status === 404);

  check("nothing on fish changed and no email was sent", JSON.stringify(fake.db.polls) === before && emails().length === 0);

  const frogList = await call(AFTERNOON, "polls", "GET", "/api/admin/polls");
  check("frog history lists no fish polls", frogList.status === 200 && frogList.body.polls.length === 0);
  const fishList = await call(AFTERNOON, "polls", "GET", "/api/admin/polls?stream=fish");
  check("fish history lists the three fish polls", fishList.body.polls.length === 3 && fishList.body.polls.every((p) => [F.id, C.id, S.id].includes(p.id)));

  check("unknown stream_id: 404", (await call(AFTERNOON, "closeNow", "POST", "/api/admin/polls/close-now", { pollId: F.id, stream_id: "nope" })).status === 404);
  check("unknown ?stream= on the list: 404", (await call(AFTERNOON, "polls", "GET", "/api/admin/polls?stream=nope")).status === 404);

  const fishClose = await call(AFTERNOON, "closeNow", "POST", "/api/admin/polls/close-now", { pollId: F.id, stream_id: "fish" });
  check("with stream_id fish, Close now works", fishClose.status === 200 && byId(F.id).status === "closed" && emails().length === 1);
  const fishImg = await withNow(AFTERNOON, async () => json(await (await routes.image()).POST(formReq("POST", "/api/admin/polls/image", png(), { pollId: S.id, stream_id: "fish" }))));
  check("with stream_id fish in the form, the picture is set", fishImg.status === 200 && byId(S.id).image_path === fishImg.body.path, JSON.stringify(fishImg.body));
});

test("a stream with polls turned off: no public poll, no new polls, skipped by the jobs", async () => {
  const fake = await fresh();
  fake.addStream({ polls_enabled: false });
  const F = addPollWithOptions(fake, { question: "TEST fish open", status: "open", stream_id: "fish", opens_at: NOON.toISOString() });
  const S = addPollWithOptions(fake, { question: "TEST fish queued", stream_id: "fish" });

  const pub = await publicFor(AFTERNOON, "fish");
  check("public API returns no poll", pub.status === 200 && pub.body.poll === null && !("options" in pub.body), JSON.stringify(pub.body));
  const q = await queue(AFTERNOON, { question: "TEST fish new", options: ["a", "b"], stream_id: "fish" });
  check("Queue poll refused", q.status === 409 && /turned off/.test(q.body.error));
  const now = await call(AFTERNOON, "openNow", "POST", "/api/admin/polls/open-now", { question: "TEST fish now", options: ["a", "b"], stream_id: "fish" });
  check("Open now (new poll) refused", now.status === 409 && /turned off/.test(now.body.error));
  const nowQueued = await call(AFTERNOON, "openNow", "POST", "/api/admin/polls/open-now", { pollId: S.id, stream_id: "fish" });
  check("Open now (queued poll) refused", nowQueued.status === 409 && byId(S.id).status === "scheduled");
  check("no fish poll was created", fake.db.polls.filter((p) => p.stream_id === "fish").length === 2);

  const noon = await cronOpen(ET(2026, 10, 16, 12, 10));
  check("the noon job only runs for frogs (single-stream response)", noon.body.message === "No scheduled poll to open." && !("streams" in noon.body), JSON.stringify(noon.body));
  check("and doesn't open the fish poll", byId(S.id).status === "scheduled");
  check("frog page unaffected", (await publicPoll(AFTERNOON)).status === 200 && byId(F.id).status === "open");
});

test("no file outside src/lib/data/polls/ queries the poll tables", () => {
  const src = path.resolve(fileURLToPath(new URL("../src/", import.meta.url)));
  const own = path.join(src, "lib", "data", "polls");
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (p !== own) walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      if (/\.from\(\s*["'](polls|poll_options|votes|poll_results)["']/.test(fs.readFileSync(p, "utf8"))) offenders.push(path.relative(src, p));
    }
  };
  walk(src);
  check("poll tables are only queried in the data layer", offenders.length === 0, offenders.join(", "));
});
