import test from "node:test";
import {
  BUCKET, ET, bigPng, byId, check, cronClose, db, emails, fresh, formReq, jpg, json, load, openNowRoute,
  png, publicPoll, queue, req, routes, scheduledPolls, textAsPng, textFile, webp, withNow,
} from "./support/helpers.mjs";

const imgs = await load("lib/pollImages.ts");
const admin = await load("lib/pollAdmin.ts");

const upload = async (file, extra = {}) =>
  json(await (await routes.image()).POST(formReq("POST", "/api/admin/polls/image", file, extra)));
const remove = async (query) => json(await (await routes.image()).DELETE(req("DELETE", `/api/admin/polls/image?${query}`)));
const tick = () => new Promise((r) => setTimeout(r, 4));

test("upload validation: text files and over-4MB files are refused, real images accepted", async () => {
  const fake = await fresh();
  const X = fake.addPoll();
  fake.addOption(X.id, "a", 0);
  fake.addOption(X.id, "b", 1);
  const up = (f) => upload(f, { pollId: X.id });
  const t1 = await up(textFile());
  check("text/plain refused", t1.status === 400 && /JPG, PNG, or WebP/.test(t1.body.error));
  const t2 = await up(textAsPng());
  check("a text file renamed .png refused (first bytes checked)", t2.status === 400 && /real JPG, PNG, or WebP/.test(t2.body.error));
  const t3 = await up(bigPng());
  check("5MB refused with the 4MB message", t3.status === 400 && /over 4MB/.test(t3.body.error));
  check("nothing stored", fake.files.size === 0 && byId(X.id).image_path === null);
  for (const mk of [png, jpg, webp]) {
    await tick();
    check("PNG/JPEG/WebP accepted", (await up(mk())).status === 200);
  }
  check("three uploads left exactly one file", fake.files.size === 1);
  check("stored under polls/<pollId>/question-<timestamp>.<ext>", new RegExp(`^polls/${X.id}/question-\\d+\\.webp$`).test(byId(X.id).image_path));
});

test("Replace and Remove delete the old file; the picture follows the question's edit rule", async () => {
  const fake = await fresh();
  const X = fake.addPoll();
  const a = fake.addOption(X.id, "a", 0);
  fake.addOption(X.id, "b", 1);
  await upload(png(), { pollId: X.id });
  const path1 = byId(X.id).image_path;
  await tick();
  await upload(jpg(), { pollId: X.id });
  const path2 = byId(X.id).image_path;
  check("replace: new file in, old file gone", path1 !== path2 && !fake.fileExists(BUCKET, path1) && fake.fileExists(BUCKET, path2));
  const del = await remove(`pollId=${X.id}`);
  check("remove: column cleared, file gone", del.status === 200 && byId(X.id).image_path === null && !fake.fileExists(BUCKET, path2));
  check("removing when there is none is harmless", (await remove(`pollId=${X.id}`)).status === 200);

  await upload(png(), { pollId: X.id });
  byId(X.id).status = "open";
  fake.addVote(X.id, a.id);
  const q = await withNow(ET(2026, 10, 15, 11), async () => json(await (await routes.polls()).PUT(req("PUT", "/api/admin/polls", { pollId: X.id, question: "TEST fixed" }))));
  check("open poll WITH votes: question editable", q.status === 200);
  await tick();
  check("...and so is the picture", (await upload(jpg(), { pollId: X.id })).status === 200 && (await remove(`pollId=${X.id}`)).status === 200);
  await upload(png(), { pollId: X.id });
  const before = byId(X.id).image_path;
  byId(X.id).status = "closed";
  check("closed poll: question edit refused", (await withNow(ET(2026, 10, 15, 11), async () => json(await (await routes.polls()).PUT(req("PUT", "/api/admin/polls", { pollId: X.id, question: "TEST x" }))))).status === 409);
  const cu = await upload(jpg(), { pollId: X.id });
  check("closed poll: picture replace refused", cu.status === 409 && cu.body.code === "poll_closed");
  check("closed poll: picture remove refused, nothing changed", (await remove(`pollId=${X.id}`)).status === 409 && byId(X.id).image_path === before && fake.fileExists(BUCKET, before));
  check("unknown poll: 404", (await upload(png(), { pollId: "00000000-0000-0000-0000-000000000000" })).status === 404);
});

test("repeating polls carry the picture forward; files shared by two polls are never deleted early", async () => {
  const fake = await fresh();
  const O = fake.addPoll({ question: "TEST pics", status: "open", repeat_daily: true, opens_at: ET(2026, 10, 15, 12, 5).toISOString() });
  fake.addOption(O.id, "Cricket", 0);
  fake.addOption(O.id, "Mealworm", 1);
  await upload(png(), { pollId: O.id });
  const pathO = byId(O.id).image_path;
  await cronClose(ET(2026, 10, 15, 20, 30));
  const C = scheduledPolls().find((p) => p.question === "TEST pics");
  check("tomorrow's copy shares the SAME file", !!C && C.image_path === pathO && fake.fileExists(BUCKET, pathO));

  await tick();
  const rep = await upload(webp(), { pollId: C.id });
  const pathC = byId(C.id).image_path;
  check("replace on the copy: its own new file; the original's file survives", rep.status === 200 && pathC !== pathO && fake.fileExists(BUCKET, pathO) && byId(O.id).image_path === pathO);

  const C2 = fake.addPoll({ question: "TEST pics", repeat_daily: true, image_path: pathO });
  const rem = await remove(`pollId=${C2.id}`);
  check("remove on a copy sharing the file: the shared file is NOT deleted", rem.status === 200 && byId(C2.id).image_path === null && fake.fileExists(BUCKET, pathO));

  await tick();
  await upload(png(), { pollId: C.id });
  check("replacing an unshared file deletes it", !fake.fileExists(BUCKET, pathC));
  const pathC3 = byId(C.id).image_path;
  await remove(`pollId=${C.id}`);
  check("removing an unshared file deletes it", !fake.fileExists(BUCKET, pathC3));

  await imgs.removeFileIfUnreferenced(fake, pathO);
  check("helper keeps a file a poll still uses", fake.fileExists(BUCKET, pathO));
  byId(O.id).image_path = null;
  await imgs.removeFileIfUnreferenced(fake, pathO);
  check("...and deletes it once nothing does", !fake.fileExists(BUCKET, pathO));

  await fresh();
  const A = db().addPoll({ question: "TEST A", image_path: "polls/shared/question-1.png" });
  const B = db().addPoll({ question: "TEST B", image_path: "polls/shared/question-1.png" });
  db().addOption(B.id, "x", 0);
  await admin.deletePollWithFiles(db(), B.id);
  check("deleting poll B keeps the file poll A uses", db().fileExists(BUCKET, "polls/shared/question-1.png"));
  await admin.deletePollWithFiles(db(), A.id);
  check("deleting the last user removes it", !db().fileExists(BUCKET, "polls/shared/question-1.png"));
});

test("a picture picked in the form is a pending upload, moved into the poll on save", async () => {
  const fake = await fresh();
  const pend = await upload(png());
  check("pending path under polls/pending/", pend.status === 200 && /^polls\/pending\/[\w.-]+\.png$/.test(pend.body.path));
  const created = await queue(ET(2026, 10, 15, 11), { question: "TEST with pic", options: ["A", "B"], repeatDaily: true, imagePath: pend.body.path });
  const P = db().db.polls.find((p) => p.question === "TEST with pic");
  check("create ok; file moved into polls/<pollId>/", created.status === 200 && !fake.fileExists(BUCKET, pend.body.path) && new RegExp(`^polls/${P.id}/question-\\d+\\.png$`).test(P.image_path) && fake.fileExists(BUCKET, P.image_path));
  check("second queued poll still refused", (await queue(ET(2026, 10, 15, 11), { question: "TEST strings", options: ["x", "y"] })).status === 409);

  await fresh();
  const bad = await queue(ET(2026, 10, 15, 11), { question: "TEST bad", options: ["A", "B"], imagePath: "polls/pending/does-not-exist.png" });
  check("a missing pending file: refused, nothing left behind", bad.status === 400 && db().db.polls.length === 0 && db().db.poll_options.length === 0);
  check("a non-pending path: refused", (await queue(ET(2026, 10, 15, 11), { question: "TEST evil", options: ["A", "B"], imagePath: "../../etc/passwd" })).status === 400);

  await fresh();
  const pend2 = await upload(jpg());
  const opened = await openNowRoute(ET(2026, 10, 15, 15), { question: "TEST open pic", options: ["a", "b"], imagePath: pend2.body.path });
  const OP = db().db.polls.find((p) => p.question === "TEST open pic");
  check("form Open now keeps the picture", opened.status === 200 && OP.status === "open" && db().fileExists(BUCKET, OP.image_path));
  const late = await upload(png());
  const count = db().db.polls.length;
  const refused = await openNowRoute(ET(2026, 10, 15, 21), { question: "TEST late pic", options: ["a", "b"], imagePath: late.body.path });
  check("after 8 PM: refused, nothing created, the pending picture untouched", refused.status === 409 && db().db.polls.length === count && db().fileExists(BUCKET, late.body.path));

  await fresh();
  db().files.set(`${BUCKET}/polls/pending/old.png`, { created_at: new Date(Date.now() - 30 * 3600e3).toISOString(), size: 1 });
  db().files.set(`${BUCKET}/polls/pending/new.png`, { created_at: new Date().toISOString(), size: 1 });
  db().files.set(`${BUCKET}/polls/abc/keep.png`, { created_at: new Date(Date.now() - 90 * 3600e3).toISOString(), size: 1 });
  const cl = await imgs.cleanupPendingPollImages(db());
  check("cleanup removes only pending files older than a day", cl.removed === 1 && !db().fileExists(BUCKET, "polls/pending/old.png") && db().fileExists(BUCKET, "polls/pending/new.png") && db().fileExists(BUCKET, "polls/abc/keep.png"));
  check("the delete endpoint refuses paths outside polls/pending", (await remove("path=polls/abc/keep.png")).status === 400 && db().fileExists(BUCKET, "polls/abc/keep.png"));
});

test("public and admin APIs: the poll's picture URL; everything works without the column", async () => {
  await fresh();
  const P = db().addPoll({ question: "TEST public", status: "open", opens_at: new Date().toISOString(), image_path: "polls/pub/question-1.png" });
  db().addOption(P.id, "A", 0);
  db().addOption(P.id, "B", 1);
  const pub = await publicPoll(new Date());
  check("poll gets its URL; options have no picture fields", pub.body.poll.image_url === "https://example.supabase.co/storage/v1/object/public/event-images/polls/pub/question-1.png" && pub.body.options.every((o) => !("image_url" in o)));
  const adm = await json(await (await routes.polls()).GET());
  check("admin list: imagesSupported and image_url", adm.body.imagesSupported === true && adm.body.polls[0].image_url.endsWith("polls/pub/question-1.png"));

  await fresh({ imageColumn: false });
  const P2 = db().addPoll({ question: "TEST nocol", status: "open", opens_at: new Date().toISOString() });
  db().addOption(P2.id, "A", 0);
  db().addOption(P2.id, "B", 1);
  const pub2 = await publicPoll(new Date());
  check("WITHOUT the column: the public API works, no picture", pub2.status === 200 && pub2.body.options.length === 2 && pub2.body.poll.image_url === null);
  const adm2 = await json(await (await routes.polls()).GET());
  check("WITHOUT the column: admin list works, imagesSupported=false", adm2.status === 200 && adm2.body.imagesSupported === false);
  const up = await upload(png());
  check("WITHOUT the column: an upload says to run the SQL", up.status === 400 && /poll_question_image\.sql/.test(up.body.error));
  db().db.polls = [];
  db().db.poll_options = [];
  check("WITHOUT the column: a normal poll can be queued", (await queue(ET(2026, 10, 15, 11), { question: "TEST plain", options: ["x", "y"] })).status === 200);
  db().db.polls = [];
  db().db.poll_options = [];
  const withPic = await queue(ET(2026, 10, 15, 11), { question: "TEST pic", options: ["x", "y"], imagePath: "polls/pending/a.png" });
  check("WITHOUT the column: a poll with a picture is refused clearly, nothing created", withPic.status === 400 && /poll_question_image\.sql/.test(withPic.body.error) && db().db.polls.length === 0);
  const R = db().addPoll({ question: "TEST rep nocol", status: "open", repeat_daily: true });
  db().addOption(R.id, "a", 0);
  db().addOption(R.id, "b", 1);
  await cronClose(ET(2026, 10, 15, 20, 30));
  const copy = scheduledPolls().find((p) => p.question === "TEST rep nocol");
  check("WITHOUT the column: a repeating poll still carries forward", !!copy && db().db.poll_options.filter((o) => o.poll_id === copy.id).length === 2 && emails().length === 1);
});
