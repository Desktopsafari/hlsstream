"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SubscribeForm from "@/components/contact/SubscribeForm";

// "Notify me" button under the video. Opens the same Stay Notified signup the
// Contact page uses in a modal, so the visitor never leaves the stream. This
// component owns its own state and sits beside the player and chat, so
// opening it re-renders neither of them.
export default function NotifyMe() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Synchronous, before the dialog unmounts, so focus never falls to <body>.
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      // Keep Tab inside the dialog while it's open.
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <>
      {/* The ::before widens the tap target without adding any layout height. */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="relative ml-auto h-5 shrink-0 whitespace-nowrap rounded-full border border-forest/50 px-3 text-xs font-semibold leading-none text-forest transition-colors before:absolute before:-inset-x-2 before:-bottom-3 before:top-0 before:content-[''] hover:bg-forest hover:text-parchment focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
      >
        Notify me
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          onClick={close}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Stay Notified"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl shadow-2xl outline-none"
          >
            <SubscribeForm />
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="absolute right-3 top-3 rounded-full border border-moss px-2.5 py-1 text-sm text-muted hover:bg-parchment"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
