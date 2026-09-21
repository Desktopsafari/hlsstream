// Central place for site-wide + stream config. Swapping the stream backend,
// renaming the site, or adding another environment override later should
// only ever touch this file, not the components that use them.

export const SITE_NAME = "Desktop Safari Live";

// `||` (not `??`) is deliberate: an env var that's set but left blank in a
// hosting dashboard is an empty string, not undefined/null, so `??` would
// silently accept it and break playback.
export const HLS_STREAM_URL =
  process.env.NEXT_PUBLIC_HLS_STREAM_URL ||
  "https://stream.desktopsafari.com/hls/stream.m3u8";

// How often the player retries after the stream is detected offline.
export const STREAM_RETRY_INTERVAL_MS = 6000;

// The chat service runs on the same VPS as the RTMP/HLS backend, reverse
// proxied through nginx at /chat on the existing domain (reusing the
// existing TLS cert -- no new subdomain/DNS needed).
export const CHAT_SERVER_URL =
  process.env.NEXT_PUBLIC_CHAT_SERVER_URL || "https://stream.desktopsafari.com";
export const CHAT_SOCKET_PATH = "/chat";

// How often the poll widget re-checks whether the poll has opened/closed.
export const POLL_REFRESH_INTERVAL_MS = 30000;

// Donation link (Ko-fi tip page). Donation-only keeps this on the right
// side of Vercel's Hobby-tier fair-use rules -- don't point it at a shop.
export const KOFI_URL = "https://ko-fi.com/desktopsafari";

// The one stream that exists today. Species cards are keyed by stream id so
// the future multi-stream map can add more without restructuring.
export const STREAM_ID = "main";

// Public Supabase Storage bucket holding species photos + range maps.
export const SPECIES_BUCKET = "species-images";

// Where poll results get emailed. Not a secret -- just the site's fixed
// destination address -- so it lives here rather than as an env var.
export const POLL_RESULTS_EMAIL = "desktopsafari@gmail.com";

// Deliberately non-obvious path, not linked from anywhere in the site nav.
// If you ever change this, also update the literal in src/middleware.ts's
// `matcher` (Next.js requires that to be a static literal, it can't import
// this constant) and in robots.ts.
export const ADMIN_PATH = "/ctrl-9k3x7m2q";
