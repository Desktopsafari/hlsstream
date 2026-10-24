import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createFake } from "./fake-supabase.mjs";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

// Load a source module by its path under src/ (the loader in hooks.mjs makes
// its "@/..." imports work).
export const load = (p) => import(pathToFileURL(SRC + p).href);

export const BUCKET = "event-images";

// Eastern time for the year 2026: EDT (UTC-4) until Nov 1 at 2 AM, EST after.
export const ET = (y, mo, d, h, m = 0) => {
  const edt = Date.UTC(y, mo - 1, d, h + 4, m);
  const est = Date.UTC(y, mo - 1, d, h + 5, m);
  return new Date(edt < Date.UTC(2026, 10, 1, 6) ? edt : est);
};

// check(name, condition, detail): a readable assertion.
export function check(name, cond, detail = "") {
  assert.ok(cond, `${name}${detail ? ` -- ${detail}` : ""}`);
}

let timingModule;
let visibilityModule;

// A brand-new in-memory database (and empty email log) for the next scenario.
export async function fresh(opts) {
  timingModule ??= await load("lib/pollTiming.ts");
  const fake = createFake(opts);
  globalThis.__fake = fake;
  globalThis.__emails = [];
  timingModule.resetDurationColumnCache();
  visibilityModule ??= await load("lib/pollVisibility.ts");
  visibilityModule.resetHideColumnCache();
  return fake;
}
export const db = () => globalThis.__fake;
export const emails = () => globalThis.__emails;
export const byId = (id) => db().db.polls.find((p) => p.id === id);
export const openPolls = () => db().db.polls.filter((p) => p.status === "open");
export const scheduledPolls = () => db().db.polls.filter((p) => p.status === "scheduled");
export const optionsOf = (pollId) =>
  db().db.poll_options.filter((o) => o.poll_id === pollId).sort((a, b) => a.display_order - b.display_order);

export const req = (method, url, body) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json", authorization: "Bearer test-secret" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
export const formReq = (method, url, file, extra = {}) => {
  const fd = new FormData();
  if (file) fd.append("file", file);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return new Request(`http://localhost${url}`, { method, body: fd });
};
export const json = async (res) => ({ status: res.status, body: await res.json() });

// Run fn with the clock frozen at `date` (new Date() and Date.now()).
export function withNow(date, fn) {
  const RealDate = Date;
  const fixed = date.getTime();
  class MockDate extends RealDate {
    constructor(...a) {
      if (a.length === 0) super(fixed);
      else super(...a);
    }
    static now() {
      return fixed;
    }
  }
  globalThis.Date = MockDate;
  return Promise.resolve(fn()).finally(() => {
    globalThis.Date = RealDate;
  });
}

// ---- tiny image files for upload tests ------------------------------------
export const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], "a.png", { type: "image/png" });
export const jpg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])], "a.jpg", { type: "image/jpeg" });
export const webp = () => new File([new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])], "a.webp", { type: "image/webp" });
export const textAsPng = () => new File([new TextEncoder().encode("this is just text, not an image at all")], "evil.png", { type: "image/png" });
export const textFile = () => new File([new TextEncoder().encode("hello")], "notes.txt", { type: "text/plain" });
export const bigPng = () => {
  const bytes = new Uint8Array(5 * 1024 * 1024);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new File([bytes], "big.png", { type: "image/png" });
};

// ---- calling the real route handlers ---------------------------------------
// Each loads the handler module on first use. They run against whatever fake
// database fresh() last installed.
const cache = new Map();
async function route(path) {
  if (!cache.has(path)) cache.set(path, await load(path));
  return cache.get(path);
}
export const routes = {
  polls: () => route("app/api/admin/polls/route.ts"),
  openNow: () => route("app/api/admin/polls/open-now/route.ts"),
  closeNow: () => route("app/api/admin/polls/close-now/route.ts"),
  endTime: () => route("app/api/admin/polls/end-time/route.ts"),
  image: () => route("app/api/admin/polls/image/route.ts"),
  cronClose: () => route("app/api/cron/close-poll/route.ts"),
  cronOpen: () => route("app/api/cron/open-poll/route.ts"),
  publicPoll: () => route("app/api/poll/route.ts"),
  vote: () => route("app/api/vote/route.ts"),
};

export const vote = (date, pollId, optionId, session) =>
  withNow(date, async () =>
    json(await (await routes.vote()).POST(req("POST", "/api/vote", { pollId, optionId, sessionId: session }))),
  );
export const cronOpen = (date) =>
  withNow(date, async () => json(await (await routes.cronOpen()).GET(req("GET", "/api/cron/open-poll"))));
export const cronClose = (date) =>
  withNow(date, async () => json(await (await routes.cronClose()).GET(req("GET", "/api/cron/close-poll"))));
export const publicPoll = (date, session = "x") =>
  withNow(date, async () => json(await (await routes.publicPoll()).GET(req("GET", `/api/poll?sessionId=${session}`))));
export const queue = (date, body) =>
  withNow(date, async () => json(await (await routes.polls()).POST(req("POST", "/api/admin/polls", body))));
export const closeNow = (date, pollId) =>
  withNow(date, async () => json(await (await routes.closeNow()).POST(req("POST", "/api/admin/polls/close-now", { pollId }))));
export const setEnd = (date, pollId, endsAtLocal) =>
  withNow(date, async () => json(await (await routes.endTime()).POST(req("POST", "/api/admin/polls/end-time", { pollId, endsAtLocal }))));
export const openNowRoute = (date, body) =>
  withNow(date, async () => json(await (await routes.openNow()).POST(req("POST", "/api/admin/polls/open-now", body))));
