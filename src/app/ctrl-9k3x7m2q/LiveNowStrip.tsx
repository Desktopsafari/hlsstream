"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEasternDate } from "@/lib/pollSchedule";

const REFRESH_MS = 60000;

type StripPoll = {
  question: string;
  status: string;
  voting_end: string | null;
  repeat_paused: boolean;
  visibility?: { hidden: boolean };
};
type StripEvent = { prompt: string; isActive: boolean; endsAt: string | null };
type StripAnnouncement = { status: { kind: string } };

type Snapshot = {
  polls: StripPoll[] | null;
  events: StripEvent[] | null;
  announcements: StripAnnouncement[] | null;
  announcementsSupported: boolean;
};

async function getJson(url: string) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

const when = (iso: string) => `${formatEasternDate(new Date(iso))} ET`;

// "Live now" at the top of the admin panel. It only reads the admin routes
// the sections below already use (which apply the real rules on the server:
// poll end times, which event is active, which announcements are showing), so
// it never works anything out for itself. Refreshes every minute, or on demand.
export default function LiveNowStrip() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const [polls, events, announcements] = await Promise.all([
      getJson("/api/admin/polls"),
      getJson("/api/admin/suggestion-events"),
      getJson("/api/admin/announcements"),
    ]);
    setSnap({
      polls: polls?.polls ?? null,
      events: events?.events ?? null,
      announcements: announcements?.announcements ?? null,
      announcementsSupported: announcements?.supported !== false,
    });
    setBusy(false);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const items: { label: string; text: string }[] = [];
  const paused: string[] = [];

  if (snap) {
    // Poll
    if (!snap.polls) {
      items.push({ label: "Poll", text: "couldn't load" });
    } else {
      const open = snap.polls.find((p) => p.status === "open");
      if (open) {
        const ended = open.voting_end && Date.parse(open.voting_end) <= Date.now();
        const end = !open.voting_end ? "no end" : ended ? "voting ended, closing soon" : `ends ${when(open.voting_end)}`;
        items.push({ label: "Poll", text: `“${open.question}” · ${end}` });
      } else {
        const latestClosed = snap.polls.find((p) => p.status === "closed");
        items.push({
          label: "Poll",
          text: latestClosed?.visibility?.hidden ? "none open (last closed poll hidden from site)" : "none open",
        });
      }
      for (const p of snap.polls) {
        if (p.repeat_paused && p.status !== "closed") paused.push(`daily repeat of “${p.question}”`);
      }
    }

    // Suggestion event
    if (!snap.events) {
      items.push({ label: "Event", text: "couldn't load" });
    } else {
      const active = snap.events.find((e) => e.isActive);
      items.push({
        label: "Event",
        text: active ? `“${active.prompt}” · ${active.endsAt ? `until ${when(active.endsAt)}` : "no end"}` : "none active",
      });
    }

    // Announcements
    if (!snap.announcementsSupported) {
      items.push({ label: "Announcements", text: "table not set up" });
    } else if (!snap.announcements) {
      items.push({ label: "Announcements", text: "couldn't load" });
    } else {
      const showing = snap.announcements.filter((a) => a.status.kind === "showing").length;
      const waiting = snap.announcements.filter((a) => a.status.kind === "waiting").length;
      items.push({ label: "Announcements", text: `${showing} showing` });
      if (waiting > 0) paused.push(`${waiting} announcement${waiting === 1 ? "" : "s"} waiting (3-card limit)`);
    }
  }

  return (
    <section
      aria-label="Live now"
      className="rounded-xl border border-moss bg-card px-4 py-3 text-sm shadow-sm"
    >
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-amber">Live now</span>
        {!snap && <span className="text-muted">Loading…</span>}
        {items.map((i) => (
          <span key={i.label} className="min-w-0 [overflow-wrap:anywhere]">
            <span className="font-semibold text-forest">{i.label}:</span> <span className="text-ink">{i.text}</span>
          </span>
        ))}
        {snap && (
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <span className="font-semibold text-forest">Paused:</span>{" "}
            <span className={paused.length ? "text-amber" : "text-ink"}>{paused.length ? paused.join("; ") : "nothing"}</span>
          </span>
        )}
        <button
          type="button"
          onClick={load}
          disabled={busy}
          className="ml-auto rounded-md border border-moss px-2 py-0.5 text-xs text-muted hover:bg-parchment disabled:opacity-50"
        >
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </section>
  );
}
