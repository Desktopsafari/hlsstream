"use client";

import { useId, useState, type ReactNode } from "react";

// Wraps an existing admin section (which keeps its own card and heading) so
// it can be collapsed. Open: the section exactly as before, with a small
// "Collapse" button in the card's top-right corner. Collapsed: a one-line bar
// with the section's name. The section stays mounted either way, so nothing
// it has loaded or that's half-typed is lost.
export default function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <div className="relative">
      {open ? (
        <button
          type="button"
          aria-expanded="true"
          aria-controls={bodyId}
          aria-label={`Collapse ${title}`}
          onClick={() => setOpen(false)}
          className="absolute right-3 top-3 z-10 rounded-md border border-moss bg-card px-2 py-1 text-xs text-muted hover:bg-parchment focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest"
        >
          Collapse ▴
        </button>
      ) : (
        <button
          type="button"
          aria-expanded="false"
          aria-controls={bodyId}
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-between rounded-xl border border-moss bg-card px-5 py-4 text-left shadow-sm hover:bg-parchment focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest"
        >
          <span className="font-heading text-lg font-semibold text-forest">{title}</span>
          <span className="text-xs text-muted">Expand ▾</span>
        </button>
      )}
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
