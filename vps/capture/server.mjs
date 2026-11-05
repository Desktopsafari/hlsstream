// Desktop Safari Live capture service: makes clips (and admin photos) from
// the rewind buffer that capture-buffer@<key> keeps for each stream. Runs on
// the VPS under systemd (capture-service.service) at 127.0.0.1:3002; nginx
// proxies /capture-api/ to it over TLS and serves the finished files itself
// from /captures/f/ (inline) and /captures/dl/ (download). Only the website's
// server routes call this, with the shared secret: visitors never reach it.
//
// No npm dependencies: node's http, fs and child_process, plus ffmpeg.

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { clampShift, parsePlaylist, pickClipSegments, pickPhotoFrame } from "./window.mjs";

const SECRET = process.env.CAPTURE_SECRET ?? "";
const PORT = Number(process.env.CAPTURE_PORT || 3002);
const STREAMS = (process.env.CAPTURE_STREAMS || "main").split(",").map((s) => s.trim()).filter(Boolean);
const BUFFER_DIR = process.env.CAPTURE_BUFFER_DIR || "/var/lib/capture/buffer";
const FILES_DIR = process.env.CAPTURE_FILES_DIR || "/var/lib/capture/files";
const MIN_FREE_BYTES = Number(process.env.CAPTURE_MIN_FREE_GB || 10) * 1024 ** 3;
const FONT = process.env.CAPTURE_FONT || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const FFMPEG = "/usr/bin/ffmpeg";

const MAX_JOBS = 2;
const MAX_QUEUED = 4;
const JOB_TIMEOUT_MS = 45_000;
const MAX_CLIP_SECONDS = 60;
const MAX_SHIFT_SECONDS = 150;
// The newest buffer segment must be this fresh, or the stream counts as offline.
const LIVE_MAX_AGE_MS = 12_000;

// The website picks the id (22 url-safe characters, 128 random bits) so it
// can always clean up, even if this reply is lost. Files: <id>.mp4 / <id>.jpg
// and the thumbnail <id>-t.jpg. Nothing else is ever read or deleted.
const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const NAME_RE = /^[A-Za-z0-9_-]{22}(-t)?\.(jpg|mp4)$/;

if (SECRET.length < 32) {
  console.error("CAPTURE_SECRET is missing or shorter than 32 characters; refusing to start.");
  process.exit(1);
}
const secretBuf = Buffer.from(SECRET);

function authorized(req) {
  const given = Buffer.from(String(req.headers["x-capture-secret"] ?? ""));
  return given.length === secretBuf.length && timingSafeEqual(given, secretBuf);
}

// ---- jobs -----------------------------------------------------------------------

let running = 0;
const waiting = [];

async function withJobSlot(fn) {
  if (running >= MAX_JOBS) {
    if (waiting.length >= MAX_QUEUED) throw httpError(503, "busy");
    await new Promise((resolve) => waiting.push(resolve));
  }
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

// Fixed program, argument array (no shell), low priority so nginx-rtmp and
// chat keep the CPU, and a hard timeout.
function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/nice",
      ["-n", "10", FFMPEG, "-hide_banner", "-loglevel", "error", "-nostdin", "-n", ...args],
      { timeout: JOB_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 256 * 1024 },
      (err, _stdout, stderr) => (err ? reject(new Error(`ffmpeg failed: ${String(stderr).slice(0, 500)}`)) : resolve()),
    );
  });
}

function httpError(status, code) {
  return Object.assign(new Error(code), { status, code });
}

// ---- buffer -----------------------------------------------------------------------

async function readBuffer(stream) {
  const dir = path.join(BUFFER_DIR, stream);
  const text = await fs.readFile(path.join(dir, "live.m3u8"), "utf8").catch(() => "");
  const segments = [];
  for (const s of parsePlaylist(text)) {
    const st = await fs.stat(path.join(dir, s.name)).catch(() => null);
    if (st) segments.push({ ...s, endMs: st.mtimeMs, file: path.join(dir, s.name) });
  }
  return segments;
}

async function freeBytes() {
  const s = await fs.statfs(FILES_DIR);
  return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
}

async function filesBytes() {
  let total = 0;
  for (const name of await fs.readdir(FILES_DIR).catch(() => [])) {
    if (!NAME_RE.test(name)) continue;
    const st = await fs.stat(path.join(FILES_DIR, name)).catch(() => null);
    if (st) total += st.size;
  }
  return total;
}

// Write to a .part name, then rename, so nginx never serves a half-written file.
async function finish(part, final) {
  // ffmpeg can exit cleanly having written nothing (no frame found).
  if ((await fs.stat(part)).size === 0) throw new Error(`ffmpeg wrote an empty ${path.basename(final)}`);
  await fs.chmod(part, 0o644);
  await fs.rename(part, final);
  return (await fs.stat(final)).size;
}

async function removeQuietly(...files) {
  await Promise.all(files.map((f) => fs.rm(f, { force: true })));
}

// ---- capture -----------------------------------------------------------------------

function parseCaptureBody(body) {
  if (!body || typeof body !== "object") return null;
  const { stream, kind, seconds, behind_live_seconds: behind, id } = body;
  if (typeof stream !== "string" || !STREAMS.includes(stream)) return null;
  if (kind !== "photo" && kind !== "clip") return null;
  if (typeof id !== "string" || !ID_RE.test(id)) return null;
  if (typeof behind !== "number" || !Number.isFinite(behind) || behind < 0 || behind > MAX_SHIFT_SECONDS) return null;
  if (kind === "clip" && (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_CLIP_SECONDS)) return null;
  return { stream, kind, seconds: kind === "clip" ? seconds : 0, behind, id };
}

async function capture(input) {
  const disk = await freeBytes();
  if (disk.free < MIN_FREE_BYTES) throw httpError(507, "disk_full");

  return withJobSlot(async () => {
    const segments = await readBuffer(input.stream);
    const newest = segments[segments.length - 1];
    if (!newest || Date.now() - newest.endMs > LIVE_MAX_AGE_MS) throw httpError(409, "offline");

    const { shift, clamped } = clampShift(input.behind, input.seconds, segments);
    const thumbFinal = path.join(FILES_DIR, `${input.id}-t.jpg`);
    const thumbPart = `${thumbFinal}.part`;

    if (input.kind === "clip") {
      const picked = pickClipSegments(segments, input.seconds, shift);
      if (picked.length === 0) throw httpError(409, "not_enough_buffer");
      const final = path.join(FILES_DIR, `${input.id}.mp4`);
      const part = `${final}.part`;
      try {
        await ffmpeg([
          "-i", `concat:${picked.map((s) => s.file).join("|")}`,
          "-map", "0:v:0", "-map", "0:a:0?",
          "-c", "copy", "-bsf:a", "aac_adtstoasc",
          "-movflags", "+faststart", "-f", "mp4", part,
        ]);
        const bytes = await finish(part, final);
        await ffmpeg(["-ss", "1", "-i", final, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "5", "-f", "mjpeg", thumbPart]);
        const thumbBytes = await finish(thumbPart, thumbFinal);
        const seconds = Math.round(picked.reduce((sum, s) => sum + s.duration, 0));
        return { file: path.basename(final), thumb: path.basename(thumbFinal), bytes: bytes + thumbBytes, seconds, shift, clamped };
      } catch (err) {
        await removeQuietly(part, final, thumbPart, thumbFinal);
        throw err;
      }
    }

    // Photo: the frame at the shifted moment, full size, with a small
    // semi-transparent watermark in the bottom-right corner.
    const frame = pickPhotoFrame(segments, shift);
    const final = path.join(FILES_DIR, `${input.id}.jpg`);
    const part = `${final}.part`;
    const watermark =
      `drawtext=fontfile=${FONT}:text=desktopsafari.com:fontcolor=white@0.6:fontsize=h/32:` +
      "shadowcolor=black@0.5:shadowx=2:shadowy=2:x=w-tw-h/40:y=h-th-h/40";
    try {
      // -ss after -i: decode from the segment's one keyframe and stop at the
      // offset. Seeking on the input finds no frame past ~1 s into a 2 s
      // segment (there's no later keyframe to seek to).
      await ffmpeg(["-i", frame.segment.file, "-ss", frame.offsetSeconds.toFixed(3), "-frames:v", "1", "-vf", watermark, "-q:v", "2", "-f", "mjpeg", part]);
      const bytes = await finish(part, final);
      await ffmpeg(["-i", final, "-vf", "scale=480:-2", "-q:v", "5", "-f", "mjpeg", thumbPart]);
      const thumbBytes = await finish(thumbPart, thumbFinal);
      return { file: path.basename(final), thumb: path.basename(thumbFinal), bytes: bytes + thumbBytes, seconds: 0, shift, clamped };
    } catch (err) {
      await removeQuietly(part, final, thumbPart, thumbFinal);
      throw err;
    }
  });
}

async function deleteFiles(body) {
  const names = body?.names;
  if (!Array.isArray(names) || names.length === 0 || names.length > 500) return null;
  if (!names.every((n) => typeof n === "string" && NAME_RE.test(n))) return null;
  let deleted = 0;
  for (const name of names) {
    const file = path.join(FILES_DIR, name);
    if (await fs.stat(file).catch(() => null)) {
      await fs.rm(file, { force: true });
      deleted++;
    }
  }
  // Already gone counts as done: the website then removes its rows.
  return { ok: true, deleted, missing: names.length - deleted };
}

async function status() {
  const streams = {};
  for (const key of STREAMS) {
    const segments = await readBuffer(key);
    const newest = segments[segments.length - 1];
    const ageMs = newest ? Date.now() - newest.endMs : null;
    streams[key] = {
      live: ageMs !== null && ageMs <= LIVE_MAX_AGE_MS,
      heldSeconds: Math.round(segments.reduce((sum, s) => sum + s.duration, 0)),
    };
  }
  const disk = await freeBytes();
  return { ok: true, streams, disk: { freeBytes: disk.free, totalBytes: disk.total, minFreeBytes: MIN_FREE_BYTES }, filesBytes: await filesBytes(), jobs: { running, queued: waiting.length } };
}

// ---- http -----------------------------------------------------------------------

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), "Cache-Control": "no-store" });
  res.end(text);
}

function readJson(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 16 * 1024) {
        req.destroy();
        resolve(null);
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

const server = createServer(async (req, res) => {
  try {
    if (!authorized(req)) return send(res, 401, { error: "unauthorized" });
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/status") return send(res, 200, await status());

    if (req.method === "POST" && url.pathname === "/capture") {
      const input = parseCaptureBody(await readJson(req));
      if (!input) return send(res, 400, { error: "invalid" });
      const result = await capture(input);
      console.log(`capture ${input.kind} ${input.stream} ${result.seconds}s shift=${result.shift.toFixed(1)}${result.clamped ? " (clamped)" : ""} ${result.bytes}B`);
      return send(res, 200, { ok: true, ...result });
    }

    if (req.method === "DELETE" && url.pathname === "/files") {
      const result = await deleteFiles(await readJson(req));
      return result ? send(res, 200, result) : send(res, 400, { error: "invalid" });
    }

    return send(res, 404, { error: "not_found" });
  } catch (err) {
    if (err.status) return send(res, err.status, { error: err.code });
    console.error(err.message);
    return send(res, 500, { error: "failed" });
  }
});

await fs.mkdir(FILES_DIR, { recursive: true });
// Leftovers from a job cut off by a restart.
for (const name of await fs.readdir(FILES_DIR)) if (name.endsWith(".part")) await fs.rm(path.join(FILES_DIR, name), { force: true });

server.listen(PORT, "127.0.0.1", () => console.log(`capture service on 127.0.0.1:${PORT}, streams: ${STREAMS.join(", ")}`));
