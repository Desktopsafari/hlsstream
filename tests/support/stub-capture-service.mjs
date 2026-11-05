// Stands in for the VPS capture service (vps/capture/server.mjs) during the
// tests. register.mjs routes fetch() calls to https://capture.test here and
// refuses every other host, so no test can reach the real VPS.
//
// install() returns the stub's state: set `down` (no answer at all) or
// `reply` ({ status, error }) to make the next requests fail, and read
// `requests` / `files` to see what the site asked for.

const SECRET = "test-capture-secret-that-is-long-enough";

export function installCaptureService() {
  const state = {
    down: false,
    reply: null, // e.g. { status: 507, error: "disk_full" } for POST /capture
    deleteFails: false,
    requests: [],
    files: new Set(),
    clamped: false,
  };

  globalThis.__captureService = async (url, init = {}) => {
    await new Promise((r) => setImmediate(r));
    if (state.down) throw new TypeError("fetch failed");
    const headers = new Headers(init.headers);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const path = url.pathname.replace(/^\/capture-api/, "");
    state.requests.push({ method: init.method ?? "GET", path, body, secret: headers.get("x-capture-secret") });
    const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

    if (headers.get("x-capture-secret") !== SECRET) return json(401, { error: "unauthorized" });

    if (path === "/capture" && init.method === "POST") {
      if (state.reply) return json(state.reply.status, { error: state.reply.error });
      const ext = body.kind === "clip" ? "mp4" : "jpg";
      state.files.add(`${body.id}.${ext}`);
      state.files.add(`${body.id}-t.jpg`);
      return json(200, {
        ok: true,
        file: `${body.id}.${ext}`,
        thumb: `${body.id}-t.jpg`,
        bytes: body.kind === "clip" ? body.seconds * 560_000 : 300_000,
        seconds: body.kind === "clip" ? body.seconds : 0,
        shift: body.behind_live_seconds,
        clamped: state.clamped,
      });
    }
    if (path === "/files" && init.method === "DELETE") {
      if (state.deleteFails) return json(500, { error: "failed" });
      let deleted = 0;
      for (const n of body.names) if (state.files.delete(n)) deleted++;
      return json(200, { ok: true, deleted, missing: body.names.length - deleted });
    }
    if (path === "/status") {
      return json(200, {
        ok: true,
        streams: { main: { live: true, heldSeconds: 150 } },
        disk: { freeBytes: 20 * 1024 ** 3, totalBytes: 24 * 1024 ** 3, minFreeBytes: 10 * 1024 ** 3 },
        filesBytes: 0,
      });
    }
    return json(404, { error: "not_found" });
  };
  return state;
}
