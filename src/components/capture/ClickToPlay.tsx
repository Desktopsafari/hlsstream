"use client";

// A clip (or an external embed) shown as its thumbnail with a play button.
// Nothing is loaded until it's clicked: the <video> only exists after the
// click, with preload="none". The parent decides which one is active, so a
// page never has more than one video or embed loaded at a time.
export default function ClickToPlay({
  active,
  onActivate,
  thumbUrl,
  videoUrl,
  embedUrl,
  label,
  embedTitle,
}: {
  active: boolean;
  onActivate: () => void;
  thumbUrl: string | null;
  videoUrl?: string | null;
  embedUrl?: string | null;
  label: string;
  embedTitle?: string;
}) {
  if (active && embedUrl) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
        <iframe
          src={embedUrl}
          title={embedTitle ?? label}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
          allowFullScreen
        />
      </div>
    );
  }
  if (active && videoUrl) {
    return (
      <video
        src={videoUrl}
        poster={thumbUrl ?? undefined}
        controls
        autoPlay
        playsInline
        preload="none"
        className="aspect-video w-full rounded-lg bg-black"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={onActivate}
      aria-label={label}
      className="group relative block aspect-video w-full overflow-hidden rounded-lg bg-forest-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
    >
      {/* A plain <img>: the files are on the VPS, not run through next/image. */}
      {thumbUrl && (
        <img src={thumbUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ink/60 text-xl text-parchment transition-transform group-hover:scale-110">
          ▶
        </span>
      </span>
    </button>
  );
}
