"use client";

import { useState } from "react";
import { AUTO_HIDE_CHOICES, autoHideLabel } from "@/lib/pollVisibility";

export type AdminPollVisibility =
  | { hidden: false; hideAt: string | null }
  | { hidden: true; reason: "manual" }
  | { hidden: true; reason: "auto"; hours: number; since: string };

function formatEastern(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const smallButton =
  "rounded-md border border-moss px-2 py-1 text-xs hover:bg-parchment disabled:cursor-not-allowed disabled:opacity-50";

// The "Hide closed polls after" setting, at the top of Poll History.
export function AutoHideSetting({
  supported,
  hours,
  onChanged,
}: {
  supported: boolean;
  hours: number | null;
  onChanged: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!supported) {
    return (
      <p className="mb-3 text-xs text-amber">
        Hiding closed polls needs the database changes first: run supabase/poll_hide.sql in the
        Supabase SQL Editor, then reload this page. Until then every poll shows as before.
      </p>
    );
  }

  async function change(value: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/polls/auto-hide", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours: value === "" ? null : Number(value) }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't save that.");
      return;
    }
    onChanged(data.message);
  }

  return (
    <div className="mb-3 flex flex-col gap-1">
      <label className="flex flex-wrap items-center gap-2 text-sm text-ink">
        Hide closed polls after
        <select
          value={hours ?? ""}
          disabled={busy}
          onChange={(e) => change(e.target.value)}
          className="rounded-md border border-moss bg-parchment px-2 py-1 text-sm text-ink outline-none focus:border-forest"
        >
          {AUTO_HIDE_CHOICES.map((c) => (
            <option key={c.label} value={c.hours ?? ""}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[11px] text-muted">
        Counted from when voting really ended. &quot;Hide from site&quot; always hides a closed poll;
        &quot;Show on site&quot; keeps it visible and ignores this timer for that poll. Open,
        scheduled and queued polls always show. Nothing is deleted.
      </p>
      {error && <p className="text-xs text-amber">{error}</p>}
    </div>
  );
}

// Status line + Hide/Show buttons on one poll in Poll History.
export function PollVisibilityControls({
  pollId,
  status,
  visibility,
  forceShown,
  supported,
  onChanged,
}: {
  pollId: string;
  status: string;
  visibility: AdminPollVisibility;
  forceShown: boolean;
  supported: boolean;
  onChanged: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!supported) return null;

  if (status !== "closed") {
    return <p className="mt-1 text-[11px] text-muted">Open, scheduled and queued polls can&apos;t be hidden.</p>;
  }

  async function act(action: "hide" | "show") {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/polls/visibility", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pollId, action }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't change that.");
      return;
    }
    onChanged(data.message);
  }

  let line: string;
  let lineClass = "text-muted";
  if (visibility.hidden && visibility.reason === "manual") {
    line = "Hidden from site (manual)";
    lineClass = "font-semibold text-amber";
  } else if (visibility.hidden) {
    line = `Hidden from site (auto, after ${autoHideLabel(visibility.hours)})`;
    lineClass = "font-semibold text-amber";
  } else if (forceShown) {
    line = "Shown on site (auto-hide ignored for this poll)";
  } else if (visibility.hideAt) {
    line = `Shown on site, auto-hides ${formatEastern(visibility.hideAt)} ET`;
  } else {
    line = "Shown on site";
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <span className={`text-xs ${lineClass}`}>👁 {line}</span>
      {!visibility.hidden && (
        <button type="button" onClick={() => act("hide")} disabled={busy} className={`${smallButton} text-muted`}>
          {busy ? "Working…" : "Hide from site"}
        </button>
      )}
      {/* Also offered before the timer hides it, to keep it up for good. */}
      {(visibility.hidden || (visibility.hideAt && !forceShown)) && (
        <button type="button" onClick={() => act("show")} disabled={busy} className={`${smallButton} text-forest`}>
          {busy ? "Working…" : "Show on site"}
        </button>
      )}
      {error && <span className="text-xs text-amber">{error}</span>}
    </div>
  );
}
