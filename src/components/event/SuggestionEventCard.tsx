"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Card from "@/components/ui/Card";
import { EVENT_NAME_MAX_LENGTH } from "@/config/constants";

type Frog = { id: string; label: string; imageUrl: string | null };
type EventData = {
  id: string;
  prompt: string;
  description: string | null;
  endsAt: string | null;
  frogs: Frog[];
};

const REFRESH_INTERVAL_MS = 60000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

// Renders nothing at all (no wrapper, no spacing) unless a suggestion event
// is switched on and hasn't ended, so the page is unchanged otherwise.
export default function SuggestionEventCard() {
  const [event, setEvent] = useState<EventData | null>(null);
  const [openFrogId, setOpenFrogId] = useState<string | null>(null);
  const clockSkewMs = useRef(0);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/suggestion-event", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      clockSkewMs.current = Date.parse(data.serverTime) - Date.now();
      setEvent(data.event ?? null);
    } catch {
      // Stay as we are; the next refresh will try again.
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  // Hide the card the moment the end time passes, even if this tab has been
  // open a long time. (The server also refuses late submissions.)
  useEffect(() => {
    if (!event?.endsAt) return;
    const remaining = Date.parse(event.endsAt) - (Date.now() + clockSkewMs.current);
    if (remaining <= 0) {
      setEvent(null);
      return;
    }
    const timer = setTimeout(() => setEvent(null), Math.min(remaining, MAX_TIMEOUT_MS));
    return () => clearTimeout(timer);
  }, [event]);

  const closeForm = useCallback((returnFocusTo?: string) => {
    // Move focus back to the frog's button before the form unmounts, so
    // keyboard and screen-reader users don't get dropped at the page top.
    if (returnFocusTo) buttonRefs.current[returnFocusTo]?.focus();
    setOpenFrogId(null);
  }, []);

  if (!event) return null;

  const openFrog = event.frogs.find((f) => f.id === openFrogId) ?? null;

  return (
    <Card className="order-1 lg:order-none">
      {/*
        Phones (below `sm`): the original stack -- heading, description, then
        a 2-up grid of frogs. From `sm` up the heading + description sit on
        the left and the frogs on the right, so a wide card doesn't leave
        most of its width empty. The right column holds at most two pictures
        per row (20.75rem = two 10rem tiles + the gap) and wraps to more rows
        when an event has more frogs, so the text column keeps the rest.
      */}
      <div className="sm:grid sm:grid-cols-[minmax(11rem,1fr)_auto] sm:items-start sm:gap-x-6">
        <div>
          <h2 className="mb-3 font-heading text-lg font-semibold text-forest">{event.prompt}</h2>
          {event.description && (
            <p className="-mt-1 mb-3 text-sm text-muted">{event.description}</p>
          )}
        </div>

        <ul className="grid grid-cols-2 gap-3 sm:flex sm:max-w-[20.75rem] sm:flex-wrap sm:justify-end">
          {event.frogs.map((frog) => (
            <li key={frog.id} className="flex flex-col gap-2 sm:w-40">
              <div className="relative aspect-square overflow-hidden rounded-lg border border-moss bg-moss/40">
                {frog.imageUrl ? (
                  <Image
                    src={frog.imageUrl}
                    alt={frog.label}
                    fill
                    sizes="(min-width: 640px) 160px, 45vw"
                    className="object-cover"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="flex h-full items-center justify-center px-2 text-center text-sm text-muted"
                  >
                    {frog.label}
                  </div>
                )}
              </div>
              <button
                type="button"
                ref={(el) => {
                  buttonRefs.current[frog.id] = el;
                }}
                aria-expanded={openFrogId === frog.id}
                aria-controls="name-idea-form"
                onClick={() => setOpenFrogId(openFrogId === frog.id ? null : frog.id)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                  openFrogId === frog.id
                    ? "border-forest bg-forest text-parchment"
                    : "border-moss text-forest hover:bg-parchment"
                }`}
              >
                Name {frog.label}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {openFrog && (
        <NameIdeaForm
          key={openFrog.id}
          eventId={event.id}
          frog={openFrog}
          onClose={() => closeForm(openFrog.id)}
          onEventClosed={() => {
            closeForm();
            load();
          }}
        />
      )}
    </Card>
  );
}

function NameIdeaForm({
  eventId,
  frog,
  onClose,
  onEventClosed,
}: {
  eventId: string;
  frog: Frog;
  onClose: () => void;
  onEventClosed: () => void;
}) {
  const [text, setText] = useState("");
  const [website, setWebsite] = useState(""); // honeypot -- real visitors never see this
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);

    if (text.trim().length === 0) {
      setError("Please type a name idea first.");
      inputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/suggestion-event/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, frogId: frog.id, text, website }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong, please try again.");
      if (data.code === "event_closed") onEventClosed();
      return;
    }

    setMessage(`Thanks! Your idea for ${frog.label} was sent. Got another?`);
    setText("");
    inputRef.current?.focus();
  }

  return (
    <form
      id="name-idea-form"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="mt-4 flex flex-col gap-2 rounded-lg border border-moss bg-parchment p-3"
    >
      {/* Honeypot: off-screen and never focusable, so only bots fill it in. */}
      <div className="absolute left-[-9999px]" aria-hidden="true">
        <label htmlFor="name-idea-website">Website</label>
        <input
          id="name-idea-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <label htmlFor="name-idea-input" className="text-sm font-medium text-ink">
        Your name idea for {frog.label}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="name-idea-input"
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={EVENT_NAME_MAX_LENGTH}
          autoComplete="off"
          className="w-full min-w-0 rounded-md border border-moss bg-card px-3 py-2 text-sm text-ink outline-none focus:border-forest sm:w-auto sm:flex-1"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-forest px-3 py-2 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Send idea"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-moss px-3 py-2 text-sm text-muted hover:bg-card"
        >
          Close
        </button>
      </div>

      <div role="status" aria-live="polite" className="text-sm text-forest empty:hidden">
        {message}
      </div>
      <div role="alert" className="text-sm text-amber empty:hidden">
        {error}
      </div>

      <p className="text-[11px] text-muted">
        Suggestions are reviewed by us, and names we choose may be shown publicly. We don&apos;t
        ask for your name or email.
      </p>
    </form>
  );
}
