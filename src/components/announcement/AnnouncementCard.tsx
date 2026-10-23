"use client";

import { useState } from "react";
import Image from "next/image";
import type { PublicAnnouncement } from "@/lib/announcementLinks";

// 16:9 crop at the card's full width, capped in height (same treatment as the
// poll's picture). If the file fails to load it renders nothing.
function Picture({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div className="relative mb-4 aspect-video max-h-72 w-full overflow-hidden rounded-lg border border-moss bg-moss/40">
      <Image
        src={url}
        alt={alt}
        fill
        sizes="(min-width: 1024px) 760px, 100vw"
        className="object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

const buttonClass =
  "inline-flex items-center gap-1 rounded-md bg-forest px-3 py-2 text-sm font-semibold text-parchment hover:bg-forest-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest";

// One announcement card, in the event card's design language. Also used by
// the admin panel's Preview, so what the admin sees is what visitors get.
export default function AnnouncementCard({ announcement: a }: { announcement: PublicAnnouncement }) {
  const headingId = `announcement-${a.id}`;
  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-moss bg-card p-5 shadow-sm">
      {a.imageUrl && <Picture url={a.imageUrl} alt={a.title} />}
      <h2 id={headingId} className="font-heading text-lg font-semibold text-forest [overflow-wrap:anywhere]">
        {a.title}
      </h2>
      {a.message && (
        // Plain text: React escapes it, and pre-line keeps the line breaks.
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink [overflow-wrap:anywhere]">
          {a.message}
        </p>
      )}
      {a.button && (
        <div className="mt-4">
          {a.button.external ? (
            <a href={a.button.href} target="_blank" rel="noopener noreferrer" className={buttonClass}>
              {a.button.label}
              <span aria-hidden="true">↗</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            // A plain link: "/#todays-vote" on the home page is an ordinary
            // in-page jump; from any other page the browser loads the home
            // page and jumps to the poll (PollAnchorScroll keeps it aimed).
            <a href={a.button.href} className={buttonClass}>
              {a.button.label}
            </a>
          )}
        </div>
      )}
    </section>
  );
}
