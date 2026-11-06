"use client";

import { useState } from "react";
import type { GalleryItem } from "@/lib/data/captures";
import { PROVIDER_LABELS } from "@/lib/data/captures/rules";
import ClickToPlay from "./ClickToPlay";

const download =
  "inline-flex items-center justify-center rounded-md border border-moss px-3 py-1.5 text-xs font-semibold text-forest hover:bg-parchment";

// One video or embed at a time: starting another one unloads the last.
// Embeds (YouTube via youtube-nocookie, TikTok, Instagram) load nothing from
// those sites until clicked.
export default function GalleryGrid({ items }: { items: GalleryItem[] }) {
  const [active, setActive] = useState<string | null>(null);

  return (
    <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <li key={item.id} className="flex flex-col gap-2 rounded-xl border border-moss bg-card p-3 shadow-sm">
          {item.embed ? (
            <ClickToPlay
              active={active === item.id}
              onActivate={() => setActive(item.id)}
              thumbUrl={item.thumbUrl}
              embedUrl={item.embed.embedUrl}
              label={`Play on ${PROVIDER_LABELS[item.embed.provider]}`}
              embedTitle={`Clip from the stream on ${PROVIDER_LABELS[item.embed.provider]}`}
            />
          ) : item.kind === "clip" ? (
            <ClickToPlay
              active={active === item.id}
              onActivate={() => setActive(item.id)}
              thumbUrl={item.thumbUrl}
              videoUrl={item.url}
              label={`Play ${item.seconds}-second clip`}
            />
          ) : (
            // Full-size photo, but only fetched as it scrolls into view.
            item.url && (
              <img
                src={item.url}
                alt="Photo from the stream"
                loading="lazy"
                decoding="async"
                className="aspect-video w-full rounded-lg bg-forest-dark object-cover"
              />
            )
          )}
          <div className="flex min-h-8 items-center justify-between gap-2 text-xs text-muted">
            <span>
              {item.embed
                ? `Clip · ${PROVIDER_LABELS[item.embed.provider]}`
                : item.kind === "clip"
                  ? `Clip · ${item.seconds} s`
                  : "Photo"}
            </span>
            {item.embed ? (
              <a href={item.embed.url} target="_blank" rel="noopener noreferrer" className={download}>
                Open on {PROVIDER_LABELS[item.embed.provider]}
              </a>
            ) : (
              item.downloadUrl && (
                <a href={item.downloadUrl} className={download}>
                  Download
                </a>
              )
            )}
          </div>
          {item.embed && active === item.id && (
            <p className="text-[11px] text-muted">
              Played by {PROVIDER_LABELS[item.embed.provider]}, which may set its own cookies.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
