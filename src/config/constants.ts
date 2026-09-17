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
