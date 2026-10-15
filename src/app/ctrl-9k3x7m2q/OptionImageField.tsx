"use client";

import { useState } from "react";
import Image from "next/image";

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

// Picture picker for one poll option: uploads as soon as a file is chosen,
// with Replace and Remove once there is one. Same look and limits as the
// naming event's frog pictures. The parent decides where the file goes
// (onUpload / onRemove) and whether the field is locked.
export default function OptionImageField({
  url,
  label,
  locked = false,
  lockedNote,
  onUpload,
  onRemove,
}: {
  url: string | null;
  label: string;
  locked?: boolean;
  lockedNote?: string;
  // Resolve to an error message, or null on success.
  onUpload: (file: File) => Promise<string | null>;
  onRemove: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File) {
    setError(null);
    if (!TYPES.includes(file.type)) {
      setError("Images must be JPG, PNG, or WebP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("That image is over 4MB. Please resize/compress it and try again.");
      return;
    }
    setBusy(true);
    const message = await onUpload(file);
    setBusy(false);
    if (message) setError(message);
  }

  async function remove() {
    setError(null);
    setBusy(true);
    const message = await onRemove();
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <div className="flex items-center gap-3">
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-moss bg-moss/40">
        {url ? (
          <Image src={url} alt="" fill sizes="48px" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-muted">
            No picture
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <label
            className={`rounded-md border border-moss px-2 py-1 text-xs focus-within:ring-2 focus-within:ring-forest ${
              locked || busy
                ? "cursor-not-allowed text-forest/50"
                : "cursor-pointer text-forest hover:bg-parchment"
            }`}
          >
            {busy ? "Working…" : url ? "Replace" : "Add picture"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label={`Picture for ${label || "this option"}`}
              className="sr-only"
              disabled={locked || busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) pick(file);
              }}
            />
          </label>
          {url && (
            <button
              type="button"
              onClick={remove}
              disabled={locked || busy}
              className="rounded-md border border-moss px-2 py-1 text-xs text-muted hover:bg-parchment disabled:cursor-not-allowed disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
        {locked && lockedNote && <p className="text-[11px] text-muted">{lockedNote}</p>}
        {error && <p className="text-xs text-amber">{error}</p>}
      </div>
    </div>
  );
}
