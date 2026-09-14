// Central place for site-wide + stream config. Swapping the stream backend,
// renaming the site, or adding another environment override later should
// only ever touch this file, not the components that use them.

export const SITE_NAME = "Desktop Safari Live";

export const HLS_STREAM_URL =
  process.env.NEXT_PUBLIC_HLS_STREAM_URL ??
  "https://stream.desktopsafari.com/hls/stream.m3u8";

// How often the player retries after the stream is detected offline.
export const STREAM_RETRY_INTERVAL_MS = 6000;
