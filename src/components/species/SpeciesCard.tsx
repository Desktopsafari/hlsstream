"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  CONSERVATION_STATUSES,
  type SpeciesCardData,
} from "@/lib/species";

const HOVER_DELAY_MS = 1000;
const ANIMATION_MS = 250;

// Segment colors for the conservation bar, least concern -> critical.
const STATUS_COLORS = ["#5f8f6b", "#a3b45f", "#d9a441", "#c97c3d", "#a8402f"];

function StatusBar({ status }: { status: SpeciesCardData["conservationStatus"] }) {
  if (!status) return null;
  const activeIndex = CONSERVATION_STATUSES.findIndex((s) => s.value === status);
  const label = CONSERVATION_STATUSES[activeIndex]?.label;

  return (
    <div>
      <div className="flex gap-1" aria-hidden="true">
        {STATUS_COLORS.map((color, i) => (
          <div
            key={color}
            className="h-2 flex-1 rounded-full"
            style={{ backgroundColor: color, opacity: i === activeIndex ? 1 : 0.22 }}
          />
        ))}
      </div>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        Conservation status: <span className="text-ink">{label}</span>
      </p>
    </div>
  );
}

function CardBody({ card, large }: { card: SpeciesCardData; large: boolean }) {
  const hasBoth = card.photoUrl && card.rangeMapUrl;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-amber">
          Meet the resident
        </p>
        <h3
          className={`font-heading font-bold leading-tight text-forest ${
            large ? "text-3xl" : "text-xl"
          }`}
        >
          {card.speciesName || "Species info coming soon"}
        </h3>
        {card.scientificName && (
          <p className={`italic text-muted ${large ? "text-base" : "text-sm"}`}>
            {card.scientificName}
          </p>
        )}
      </div>

      {(card.photoUrl || card.rangeMapUrl) && (
        <div className={`grid gap-3 ${hasBoth ? "grid-cols-[3fr_2fr]" : "grid-cols-1"}`}>
          {card.photoUrl && (
            <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-moss bg-moss">
              <Image
                src={card.photoUrl}
                alt={card.speciesName ? `${card.speciesName} photo` : "Species photo"}
                fill
                sizes={large ? "(min-width: 768px) 420px, 90vw" : "(min-width: 640px) 240px, 60vw"}
                className="object-cover"
              />
            </div>
          )}
          {card.rangeMapUrl && (
            <div className="relative aspect-square self-end overflow-hidden rounded-lg border border-moss bg-parchment">
              <Image
                src={card.rangeMapUrl}
                alt={card.speciesName ? `${card.speciesName} range map` : "Range map"}
                fill
                sizes={large ? "(min-width: 768px) 280px, 40vw" : "(min-width: 640px) 160px, 35vw"}
                className="object-contain p-1"
              />
            </div>
          )}
        </div>
      )}

      {card.infoBlocks.length > 0 && (
        <dl className="flex flex-col gap-3">
          {card.infoBlocks.map((block, i) => (
            <div key={i}>
              <dt className="text-[11px] font-bold uppercase tracking-widest text-forest">
                {block.title}
              </dt>
              <dd
                className={`text-ink ${
                  large ? "text-base leading-relaxed" : "line-clamp-3 text-sm"
                }`}
              >
                {block.body}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <StatusBar status={card.conservationStatus} />
    </div>
  );
}

export default function SpeciesCard() {
  const [card, setCard] = useState<SpeciesCardData | null | undefined>(undefined);
  const [mounted, setMounted] = useState(false); // overlay in the DOM
  const [shown, setShown] = useState(false); // overlay animated in
  const openedBy = useRef<"hover" | "click">("click");
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/species")
      .then((r) => r.json())
      .then((data) => setCard(data.card ?? null))
      .catch(() => setCard(null));
  }, []);

  const clearHoverTimer = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const open = useCallback((by: "hover" | "click") => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openedBy.current = by;
    setMounted(true);
  }, []);

  const close = useCallback(() => {
    setShown(false);
    closeTimer.current = setTimeout(() => setMounted(false), ANIMATION_MS);
  }, []);

  // Trigger the enter transition one frame after mounting.
  useEffect(() => {
    if (!mounted) return;
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [mounted, close]);

  useEffect(() => () => clearHoverTimer(), []);

  if (card === undefined) {
    return (
      <div className="h-48 animate-pulse rounded-xl border border-moss bg-card shadow-sm" />
    );
  }

  if (card === null || (!card.speciesName && card.infoBlocks.length === 0)) {
    return (
      <div className="rounded-xl border border-moss bg-card p-5 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-amber">
          Meet the resident
        </p>
        <p className="mt-1 text-sm text-muted">Species info coming soon.</p>
      </div>
    );
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={`Enlarge ${card.speciesName} info card`}
        onPointerEnter={(e) => {
          // Hover only exists for mouse-like pointers; touch uses tap below.
          if (e.pointerType !== "mouse") return;
          clearHoverTimer();
          hoverTimer.current = setTimeout(() => open("hover"), HOVER_DELAY_MS);
        }}
        onPointerLeave={clearHoverTimer}
        onClick={() => {
          clearHoverTimer();
          open("click");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open("click");
          }
        }}
        className="cursor-zoom-in rounded-xl border border-moss bg-card p-5 shadow-sm transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-forest"
      >
        <CardBody card={card} large={false} />
        <p className="mt-3 text-[11px] text-muted sm:hidden">Tap to enlarge</p>
      </div>

      {mounted && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 transition-opacity duration-[250ms] ${
            shown ? "opacity-100" : "opacity-0"
          }`}
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${card.speciesName} info card`}
            onClick={(e) => e.stopPropagation()}
            onMouseLeave={() => {
              if (openedBy.current === "hover") close();
            }}
            className={`relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-moss bg-card p-6 shadow-2xl transition-all duration-[250ms] ease-out sm:p-8 ${
              shown ? "scale-100 opacity-100" : "scale-90 opacity-0"
            }`}
          >
            <button
              onClick={close}
              aria-label="Close"
              className="absolute right-3 top-3 rounded-full border border-moss px-2.5 py-1 text-sm text-muted hover:bg-parchment"
            >
              ✕
            </button>
            <CardBody card={card} large />
          </div>
        </div>
      )}
    </>
  );
}
