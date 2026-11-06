// Capture ("Take photo" / "Save clip") limits, labels and helpers shared by
// the server, the public buttons and the admin tab. Nothing here may import
// server-only code: the browser bundle includes this file.

export const HOUR_MS = 60 * 60 * 1000;

// How long files are kept. Visitor captures expire after 24 hours; the
// admin's own captures after 48. Featured and Kept items never expire.
export const VISITOR_TTL_MS = 24 * HOUR_MS;
export const ADMIN_TTL_MS = 48 * HOUR_MS;
export const VISITOR_TTL_LABEL = "24 hours";

export const VISITOR_CLIP_SECONDS = [15, 30];
export const ADMIN_CLIP_SECONDS = [15, 30, 60];
export const DEFAULT_VISITOR_CLIP_SECONDS = 30;

// Per visitor (by IP-derived hash) and site-wide, counted from the captures
// table. Admin captures are exempt.
export const LIMITS = {
  clip: { gapMs: 3 * 60 * 1000, perHour: 5, siteWidePerHour: 15 },
  photo: { gapMs: 20 * 1000, perHour: 20, siteWidePerHour: 300 },
} as const;

// Storage budget: new visitor captures are refused once the unexpired,
// non-featured, non-kept visitor captures add up to more than this.
export const VISITOR_STORAGE_BUDGET_BYTES = 5 * 1024 ** 3;
// The admin tab warns when Featured plus Kept files go over this.
export const KEPT_WARNING_BYTES = 3 * 1024 ** 3;

// The rewind buffer on the VPS holds ~150 s (capture-buffer@<key>).
export const BUFFER_SECONDS = 150;

// The player reports how far it is behind the end of the public playlist
// (hls.js `latency`, or seekable end - currentTime on Safari's own player).
// That playlist trails the RTMP feed the buffer reads by 0-4 s (its 4 s
// fragments), so this average is added. Measured 2026-11-05 on the real
// stream: hls.js sat 12.3 s behind the playlist edge, so a viewer is ~14 s
// behind the buffer's live point; that is the fallback when the player
// reports nothing usable.
export const PLAYLIST_LAG_SECONDS = 2;
export const FALLBACK_DELAY_SECONDS = 14;

export type DelaySource = "reported" | "fallback" | "clamped";

// Seconds back from the buffer's live point to capture. Missing or invalid
// values (older browsers, NaN, negative, absurd) use the fallback; a value
// larger than the buffer allows (paused or rewound player) is clamped to the
// most the buffer can give for this length, never refused. The capture
// service clamps again to what its buffer actually holds right now.
export function resolveDelay(reported: unknown, seconds: number): { delay: number; source: DelaySource } {
  const max = Math.max(0, BUFFER_SECONDS - seconds - 4);
  const valid = typeof reported === "number" && Number.isFinite(reported) && reported >= 0 && reported <= 3600;
  if (!valid) return { delay: Math.min(FALLBACK_DELAY_SECONDS, max), source: "fallback" };
  const wanted = reported + PLAYLIST_LAG_SECONDS;
  if (wanted > max) return { delay: max, source: "clamped" };
  return { delay: Math.round(wanted * 10) / 10, source: "reported" };
}

// ---- external video links on featured items -------------------------------------

export type ExternalEmbed = { provider: "youtube" | "tiktok" | "instagram"; url: string; embedUrl: string };

const YOUTUBE_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"];
const TIKTOK_HOSTS = ["tiktok.com", "www.tiktok.com", "m.tiktok.com"];
const INSTAGRAM_HOSTS = ["instagram.com", "www.instagram.com"];

// YouTube, TikTok or Instagram only, https only, and only links we can turn
// into an embed (short links like vm.tiktok.com can't be, so they're refused).
// The embed URLs are the privacy-friendlier players: youtube-nocookie for
// YouTube; the gallery also loads every embed only when it's clicked.
export function parseExternalVideoUrl(value: unknown): ExternalEmbed | null {
  if (typeof value !== "string" || value.length > 500) return null;
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  if (YOUTUBE_HOSTS.includes(host)) {
    let id: string | null = null;
    if (host === "youtu.be") id = parts[0] ?? null;
    else if (parts[0] === "watch") id = u.searchParams.get("v");
    else if (["shorts", "live", "embed"].includes(parts[0] ?? "")) id = parts[1] ?? null;
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    return { provider: "youtube", url: `https://www.youtube.com/watch?v=${id}`, embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (TIKTOK_HOSTS.includes(host)) {
    const i = parts.indexOf("video");
    const id = i >= 1 && parts[0].startsWith("@") ? parts[i + 1] : null;
    if (!id || !/^\d{8,25}$/.test(id)) return null;
    return { provider: "tiktok", url: `https://www.tiktok.com/${parts[0]}/video/${id}`, embedUrl: `https://www.tiktok.com/player/v1/${id}` };
  }
  if (INSTAGRAM_HOSTS.includes(host)) {
    const kind = parts[0];
    const code = parts[1];
    if (!["p", "reel"].includes(kind ?? "") || !code || !/^[A-Za-z0-9_-]{5,40}$/.test(code)) return null;
    return { provider: "instagram", url: `https://www.instagram.com/${kind}/${code}/`, embedUrl: `https://www.instagram.com/${kind}/${code}/embed` };
  }
  return null;
}

export const PROVIDER_LABELS: Record<ExternalEmbed["provider"], string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
};

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export const CAPTURES_SQL_HINT =
  "Captures need their database table first: run supabase/captures.sql in the Supabase SQL Editor.";
export const CAPTURES_ENV_HINT =
  "Captures need CAPTURE_SECRET, CAPTURE_SERVICE_URL and CAPTURE_CRON_SECRET set in the environment.";
