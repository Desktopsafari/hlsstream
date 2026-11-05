// Pure helpers for picking what to capture from the rewind buffer. No I/O, so
// the site's tests (tests/capture.test.mjs) load this file directly.
//
// The buffer is a local HLS playlist written by capture-buffer@<key>: ~2 s
// segments, the last ~150 s. Each segment's wall-clock end is its file's
// mtime (written when ffmpeg closes it), which never drifts the way the
// stream's own timestamps can over days of uptime.

// Seconds of slack kept off both ends of the buffer: the newest segment may
// still be closing, and the oldest may be deleted while a job reads it.
export const EDGE_MARGIN_SECONDS = 2;

// Parse the buffer playlist into [{ name, duration }], oldest first. Lines we
// don't need (tags other than EXTINF) are ignored; anything malformed is
// dropped rather than trusted.
export function parsePlaylist(text) {
  const out = [];
  let duration = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF:")) {
      const d = Number.parseFloat(line.slice(8));
      duration = Number.isFinite(d) && d > 0 && d < 30 ? d : null;
    } else if (line && !line.startsWith("#")) {
      if (duration !== null && /^seg-\d{1,20}\.ts$/.test(line)) out.push({ name: line, duration });
      duration = null;
    }
  }
  return out;
}

// segments: [{ name, duration, endMs }] oldest first (endMs = mtime).
// What the buffer holds right now: from the oldest segment's start to the
// newest one's end.
export function bufferSpan(segments) {
  if (segments.length === 0) return null;
  const first = segments[0];
  const last = segments[segments.length - 1];
  return { startMs: first.endMs - first.duration * 1000, endMs: last.endMs };
}

// The shift actually applied: what the site asked for, clamped to what the
// buffer holds (a viewer who paused or rewound can be far behind; a buffer
// that just restarted holds less than 150 s). `seconds` is the clip length
// (0 for a photo). Never fails: the worst case is "as far back as we can".
export function clampShift(requestedSeconds, seconds, segments) {
  const span = bufferSpan(segments);
  if (!span) return null;
  const held = (span.endMs - span.startMs) / 1000 - 2 * EDGE_MARGIN_SECONDS;
  const max = Math.max(0, held - seconds);
  const wanted = Number.isFinite(requestedSeconds) && requestedSeconds > 0 ? requestedSeconds : 0;
  return { shift: Math.min(wanted, max), clamped: wanted > max };
}

// Segments covering the window that ends `shiftSeconds` before the buffer's
// newest point and lasts `seconds`. -c copy can only cut on keyframes (every
// 2 s), so whole segments are used and a clip can run up to ~2 s long.
export function pickClipSegments(segments, seconds, shiftSeconds) {
  const span = bufferSpan(segments);
  if (!span) return [];
  const endMs = span.endMs - (EDGE_MARGIN_SECONDS + shiftSeconds) * 1000;
  const startMs = endMs - seconds * 1000;
  return segments.filter((s) => s.endMs > startMs && s.endMs - s.duration * 1000 < endMs);
}

// The segment holding the moment `shiftSeconds` before the newest point, and
// how far into it that moment is. Photo timing is only good to about +/- 2-3
// s: the viewer's reported delay is measured against the public playlist,
// which itself trails the RTMP feed by 0-4 s (its 4 s fragments), and the
// site can only add the average of that. Not worth fixing for now.
export function pickPhotoFrame(segments, shiftSeconds) {
  const span = bufferSpan(segments);
  if (!span) return null;
  const atMs = span.endMs - (EDGE_MARGIN_SECONDS + shiftSeconds) * 1000;
  for (const s of segments) {
    const startMs = s.endMs - s.duration * 1000;
    if (atMs >= startMs && atMs < s.endMs) {
      return { segment: s, offsetSeconds: Math.max(0, Math.min(s.duration - 0.05, (atMs - startMs) / 1000)) };
    }
  }
  const last = segments[segments.length - 1];
  return { segment: last, offsetSeconds: 0 };
}
