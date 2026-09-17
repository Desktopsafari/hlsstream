"use client";

import { useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import { HLS_STREAM_URL, STREAM_RETRY_INTERVAL_MS } from "@/config/constants";

type PlayerStatus = "loading" | "playing" | "offline" | "unsupported";

export default function HlsPlayer() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<PlayerStatus>("loading");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let hls: Hls | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRetry = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const scheduleRetry = (fn: () => void) => {
      clearRetry();
      retryTimer = setTimeout(() => {
        if (!cancelled) fn();
      }, STREAM_RETRY_INTERVAL_MS);
    };

    // Shared across both playback paths: catches mid-stream rebuffering,
    // not just the initial connect.
    const onWaiting = () =>
      setStatus((prev) => (prev === "offline" ? prev : "loading"));
    const onPlaying = () => setStatus("playing");
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);

    function setupNative() {
      setStatus("loading");
      video!.src = HLS_STREAM_URL;

      const onLoaded = () => {
        setStatus("playing");
        video!.play().catch(() => {});
      };
      const onError = () => {
        setStatus("offline");
        scheduleRetry(setupNative);
      };

      video!.addEventListener("loadedmetadata", onLoaded, { once: true });
      video!.addEventListener("error", onError, { once: true });
    }

    async function setupHlsJs() {
      setStatus("loading");

      const { default: HlsCtor } = await import("hls.js");
      if (cancelled) return;

      if (!HlsCtor.isSupported()) {
        setStatus("unsupported");
        return;
      }

      hls = new HlsCtor({ enableWorker: true });

      hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
        setStatus("playing");
        video!.play().catch(() => {});
      });

      hls.on(HlsCtor.Events.ERROR, (_evt: unknown, data: { fatal: boolean; type: string }) => {
        if (!data.fatal) return;

        setStatus("offline");

        if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
          hls?.recoverMediaError();
          return;
        }

        // Network errors (including a 404 on the .m3u8 when the source is
        // offline) and anything else unrecoverable: tear down and retry.
        hls?.destroy();
        hls = null;
        scheduleRetry(setupHlsJs);
      });

      hls.loadSource(HLS_STREAM_URL);
      hls.attachMedia(video!);
    }

    const supportsNativeHls =
      video.canPlayType("application/vnd.apple.mpegurl") !== "";

    if (supportsNativeHls) {
      setupNative();
    } else {
      setupHlsJs();
    }

    return () => {
      cancelled = true;
      clearRetry();
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      hls?.destroy();
    };
  }, []);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-moss bg-black shadow-sm">
      <video
        ref={videoRef}
        className="h-full w-full"
        controls
        playsInline
        muted
        autoPlay
      />
      {status !== "playing" && (
        <div className="absolute inset-0 flex items-center justify-center bg-forest-dark/85">
          {status === "loading" && <LoadingIndicator />}
          {status === "offline" && <OfflineMessage />}
          {status === "unsupported" && <UnsupportedMessage />}
        </div>
      )}
    </div>
  );
}

function LoadingIndicator() {
  return (
    <div className="flex flex-col items-center gap-3 text-parchment">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-parchment/30 border-t-amber" />
      <span className="text-sm">Connecting to stream…</span>
    </div>
  );
}

function OfflineMessage() {
  return (
    <div className="flex flex-col items-center gap-2 px-4 text-center text-parchment">
      <span className="text-base font-medium">Stream is currently offline</span>
      <span className="text-sm text-parchment/70">
        We&apos;ll reconnect automatically as soon as it&apos;s back.
      </span>
    </div>
  );
}

function UnsupportedMessage() {
  return (
    <div className="flex flex-col items-center gap-2 px-4 text-center text-parchment">
      <span className="text-base font-medium">
        Your browser can&apos;t play this stream
      </span>
      <span className="text-sm text-parchment/70">
        Try a recent version of Chrome, Firefox, Edge, or Safari.
      </span>
    </div>
  );
}
