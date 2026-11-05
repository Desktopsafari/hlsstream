"use client";

import { useSyncExternalStore } from "react";

// A tiny shared handle on the one stream player, so the capture buttons can
// read the video element and how far behind live it is without being inside
// HlsPlayer. Nothing here re-renders the player: it only publishes.

export type PlayerStatus = "loading" | "playing" | "offline" | "unsupported";

type Handle = { video: HTMLVideoElement; latency: () => number | null };

let handle: Handle | null = null;
let status: PlayerStatus = "loading";
const listeners = new Set<() => void>();

export function setPlayer(h: Handle | null) {
  handle = h;
}

export function setPlayerStatus(s: PlayerStatus) {
  if (s === status) return;
  status = s;
  for (const l of listeners) l();
}

export function getPlayerVideo(): HTMLVideoElement | null {
  return handle?.video ?? null;
}

// Seconds behind the end of the public playlist, or null when the player
// can't say (older browsers, not playing yet). The server then assumes the
// typical delay (captureShared.ts FALLBACK_DELAY_SECONDS).
export function behindLiveSeconds(): number | null {
  try {
    const v = handle?.latency() ?? null;
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : null;
  } catch {
    return null;
  }
}

export function usePlayerStatus(): PlayerStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
    () => "loading",
  );
}
