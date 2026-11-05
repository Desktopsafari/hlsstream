"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { photoFileName, type BrowserPhoto } from "@/lib/browserPhoto";
import { VISITOR_TTL_LABEL } from "@/lib/captureShared";
import ClickToPlay from "./ClickToPlay";

export type ServerCapture = {
  id: string;
  kind: "photo" | "clip";
  seconds: number;
  url: string | null;
  downloadUrl: string | null;
  thumbUrl: string | null;
  expiresAt: string | null;
};

export type ModalState =
  | { phase: "working"; kind: "photo" | "clip" }
  | { phase: "error"; kind: "photo" | "clip"; message: string }
  | { phase: "local"; photo: BrowserPhoto; takenAt: Date }
  | { phase: "server"; capture: ServerCapture };

const primary =
  "inline-flex items-center justify-center rounded-md bg-forest px-4 py-2 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50";
const secondary =
  "inline-flex items-center justify-center rounded-md border border-moss px-4 py-2 text-sm text-forest hover:bg-parchment disabled:opacity-50";

// The capture result: a preview, Download, Share, and how long it's kept.
export default function CaptureModal({ state, onClose }: { state: ModalState; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], video, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title =
    state.phase === "working"
      ? state.kind === "clip" ? "Saving your clip…" : "Taking your photo…"
      : state.phase === "error"
        ? state.kind === "clip" ? "Couldn't save the clip" : "Couldn't take the photo"
        : (state.phase === "local" || state.capture.kind === "photo") ? "Your photo" : "Your clip";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-xl border border-moss bg-card p-5 shadow-2xl outline-none"
      >
        <h2 className="pr-10 font-heading text-lg font-semibold text-forest">{title}</h2>
        {state.phase === "working" && <Working kind={state.kind} />}
        {state.phase === "error" && <p className="text-sm text-ink">{state.message}</p>}
        {state.phase === "local" && <LocalPhoto photo={state.photo} takenAt={state.takenAt} />}
        {state.phase === "server" && <ServerResult capture={state.capture} />}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-full border border-moss px-2.5 py-1 text-sm text-muted hover:bg-parchment"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function Working({ kind }: { kind: "photo" | "clip" }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted" role="status">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-moss border-t-forest" />
      {kind === "clip" ? "Putting together the last 30 seconds you watched. This takes a few seconds." : "One moment…"}
    </div>
  );
}

// Taken in the browser: never uploaded, so nothing to expire.
function LocalPhoto({ photo, takenAt }: { photo: BrowserPhoto; takenAt: Date }) {
  const objectUrl = useMemo(() => URL.createObjectURL(photo.blob), [photo.blob]);
  useEffect(() => () => URL.revokeObjectURL(objectUrl), [objectUrl]);
  const name = photoFileName(takenAt);
  const file = useMemo(() => new File([photo.blob], name, { type: "image/jpeg" }), [photo.blob, name]);
  const canShare = typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });
  const [note, setNote] = useState<string | null>(null);

  async function share() {
    try {
      await navigator.share({ files: [file], title: "Desktop Safari Live" });
    } catch (err) {
      if ((err as Error).name !== "AbortError") setNote("Sharing didn't work here. Use Download instead.");
    }
  }

  return (
    <>
      {/* A plain <img>: a local blob, nothing for next/image to do. */}
      <img src={objectUrl} alt="Photo of the stream" width={photo.width} height={photo.height} className="h-auto w-full rounded-lg bg-black" />
      <div className="flex flex-wrap gap-2">
        <a href={objectUrl} download={name} className={primary}>
          Download
        </a>
        {canShare && (
          <button type="button" onClick={share} className={secondary}>
            Share
          </button>
        )}
      </div>
      {note && <p className="text-xs text-amber">{note}</p>}
      <p className="text-xs text-muted">
        Taken in your browser: this photo was never uploaded, so only you have it. Download it to keep it.
      </p>
    </>
  );
}

function ServerResult({ capture }: { capture: ServerCapture }) {
  const [playing, setPlaying] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Set when the file was fetched but the browser wanted a fresh tap to share it.
  const [readyFile, setReadyFile] = useState<File | null>(null);
  const isClip = capture.kind === "clip";
  const name = `desktopsafari-${capture.id}.${isClip ? "mp4" : "jpg"}`;

  async function shareFile(file: File) {
    try {
      await navigator.share({ files: [file], title: "Desktop Safari Live" });
      setReadyFile(null);
    } catch (err) {
      const e = err as Error;
      if (e.name === "AbortError") return setReadyFile(null);
      // Fetching the file can use up the tap's permission to share: ask for another tap.
      if (e.name === "NotAllowedError") return setReadyFile(file);
      await copyLink();
    }
  }

  async function copyLink() {
    if (!capture.url) return;
    try {
      await navigator.clipboard.writeText(capture.url);
      setNote(`Link copied. It works for ${VISITOR_TTL_LABEL}.`);
    } catch {
      setNote(`Copy this link (it works for ${VISITOR_TTL_LABEL}): ${capture.url}`);
    }
  }

  async function share() {
    setNote(null);
    if (!capture.url) return;
    if (typeof navigator.canShare === "function") {
      try {
        setNote("Preparing…");
        const blob = await (await fetch(capture.url)).blob();
        const file = new File([blob], name, { type: isClip ? "video/mp4" : "image/jpeg" });
        setNote(null);
        if (navigator.canShare({ files: [file] })) return shareFile(file);
      } catch {
        setNote(null);
      }
    }
    await copyLink();
  }

  return (
    <>
      {isClip ? (
        <ClickToPlay
          active={playing}
          onActivate={() => setPlaying(true)}
          thumbUrl={capture.thumbUrl}
          videoUrl={capture.url}
          label={`Play your ${capture.seconds}-second clip`}
        />
      ) : (
        capture.url && <img src={capture.url} alt="Photo of the stream" className="h-auto w-full rounded-lg bg-black" />
      )}
      <div className="flex flex-wrap gap-2">
        {capture.downloadUrl && (
          <a href={capture.downloadUrl} download={name} className={primary}>
            Download
          </a>
        )}
        {readyFile ? (
          <button type="button" onClick={() => shareFile(readyFile)} className={secondary}>
            Share now
          </button>
        ) : (
          <button type="button" onClick={share} className={secondary}>
            Share
          </button>
        )}
      </div>
      {note && <p className="break-all text-xs text-muted">{note}</p>}
      <p className="text-xs text-muted">
        Only people you give the link to can see it. It&apos;s kept for {VISITOR_TTL_LABEL}, then deleted, so download
        it if you want to keep it.
      </p>
    </>
  );
}
