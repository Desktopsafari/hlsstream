"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { behindLiveSeconds, getPlayerVideo, usePlayerStatus } from "@/lib/playerRegistry";
import { takeBrowserPhoto } from "@/lib/browserPhoto";
import { DEFAULT_VISITOR_CLIP_SECONDS } from "@/lib/captureShared";
import CaptureModal, { type ModalState } from "./CaptureModal";

type Availability = { enabled: boolean; paused?: boolean };

// "Photo" and "Clip" under the video. They sit in the fixed-height row beside
// Notify me, so they never shift the page, and they only read the player
// through playerRegistry, so pressing them never re-renders the video.
// Hidden entirely until captures are set up (GET /api/capture).
export default function CaptureButtons() {
  const [available, setAvailable] = useState<Availability | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const status = usePlayerStatus();
  const lastButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/capture")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d: Availability) => !cancelled && setAvailable(d))
      .catch(() => !cancelled && setAvailable({ enabled: false }));
    return () => {
      cancelled = true;
    };
  }, []);

  const close = useCallback(() => {
    setModal(null);
    lastButton.current?.focus();
  }, []);

  async function serverCapture(kind: "photo" | "clip", behind: number | null) {
    try {
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, seconds: kind === "clip" ? DEFAULT_VISITOR_CLIP_SECONDS : undefined, behind_live_seconds: behind }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.capture) {
        setModal({ phase: "error", kind, message: data.error ?? "Something went wrong saving that. Please try again." });
        return;
      }
      setModal({ phase: "server", capture: data.capture });
    } catch {
      setModal({ phase: "error", kind, message: "Couldn't reach the site. Check your connection and try again." });
    }
  }

  async function takePhoto(e: React.MouseEvent<HTMLButtonElement>) {
    lastButton.current = e.currentTarget;
    // Measured at the click, before anything async.
    const behind = behindLiveSeconds();
    const photo = await takeBrowserPhoto(getPlayerVideo());
    if (typeof photo !== "string") {
      setModal({ phase: "local", photo, takenAt: new Date() });
      return;
    }
    // The browser couldn't do it: the capture server takes the photo instead.
    setModal({ phase: "working", kind: "photo" });
    await serverCapture("photo", behind);
  }

  async function saveClip(e: React.MouseEvent<HTMLButtonElement>) {
    lastButton.current = e.currentTarget;
    const behind = behindLiveSeconds();
    setModal({ phase: "working", kind: "clip" });
    await serverCapture("clip", behind);
  }

  if (!available?.enabled) return null;
  const live = status === "playing";
  const pill =
    "relative h-5 shrink-0 whitespace-nowrap rounded-full border border-forest/50 px-2.5 text-xs font-semibold leading-none text-forest transition-colors before:absolute before:-inset-x-1 before:-bottom-3 before:top-0 before:content-[''] hover:bg-forest hover:text-parchment focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-forest";

  return (
    <>
      <button
        type="button"
        onClick={takePhoto}
        disabled={!live || modal?.phase === "working"}
        aria-label="Take photo"
        title={live ? "Take photo" : "The stream is offline"}
        className={pill}
      >
        <span aria-hidden="true">📷</span>
        {/* Icon only on the narrowest phones, so the row never overflows. */}
        <span className="max-[359px]:hidden"> Photo</span>
      </button>
      <button
        type="button"
        onClick={saveClip}
        disabled={!live || available.paused || modal?.phase === "working"}
        aria-label={`Save clip (last ${DEFAULT_VISITOR_CLIP_SECONDS} s)`}
        title={available.paused ? "Clips are paused right now" : live ? `Save the last ${DEFAULT_VISITOR_CLIP_SECONDS} seconds` : "The stream is offline"}
        className={pill}
      >
        <span aria-hidden="true">🎬</span>
        <span className="max-[359px]:hidden"> Clip</span>
      </button>
      {modal && <CaptureModal state={modal} onClose={close} />}
    </>
  );
}
