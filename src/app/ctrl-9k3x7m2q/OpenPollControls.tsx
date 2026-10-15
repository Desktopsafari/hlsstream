"use client";

import { useState } from "react";
import { emailNoteFor } from "@/lib/pollDuration";
import { formatEasternDate, parseEasternDateTime, toEasternDateTimeInput } from "@/lib/pollSchedule";

// Shown on an open poll in Poll History: when voting ends (or "no end"), Close
// now, and Change end time. Both actions apply on the server only once; the
// buttons are disabled while a request runs and the server refuses a repeat.
export default function OpenPollControls({
  poll,
  durationsSupported,
  onChanged,
}: {
  poll: {
    id: string;
    question: string;
    repeat_daily: boolean;
    open_ended: boolean;
    is_long: boolean;
    voting_end: string | null;
  };
  durationsSupported: boolean;
  onChanged: (message: string) => void;
}) {
  const [panel, setPanel] = useState<"close" | "end" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endValue, setEndValue] = useState(() =>
    toEasternDateTimeInput(new Date(poll.voting_end ? Date.parse(poll.voting_end) : Date.now() + 24 * 3600e3)),
  );

  const endText = poll.open_ended
    ? "No end time: this poll stays open until you close it."
    : poll.voting_end
      ? `Voting ends ${formatEasternDate(new Date(poll.voting_end))} ET`
      : null;
  const canChangeEnd = durationsSupported && !poll.repeat_daily;
  const picked = parseEasternDateTime(endValue);
  const emailNote = picked ? emailNoteFor(picked) : null;

  async function closeNow() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/polls/close-now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pollId: poll.id }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't close the poll.");
      if (data.code === "not_open") onChanged(data.error);
      return;
    }
    setPanel(null);
    onChanged(data.message);
  }

  async function saveEnd() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/polls/end-time", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pollId: poll.id, endsAtLocal: endValue }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't change the end time.");
      return;
    }
    setPanel(null);
    onChanged(data.message);
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {endText && (
        <p className={`text-xs ${poll.open_ended ? "font-semibold text-amber" : "text-muted"}`}>{endText}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setPanel(panel === "close" ? null : "close");
          }}
          disabled={busy}
          className={
            poll.open_ended
              ? "rounded-md bg-forest px-3 py-1.5 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50"
              : "rounded-md border border-forest px-2 py-1 text-xs font-semibold text-forest hover:bg-parchment disabled:opacity-50"
          }
        >
          Close now
        </button>
        {canChangeEnd && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setPanel(panel === "end" ? null : "end");
            }}
            disabled={busy}
            className="rounded-md border border-moss px-2 py-1 text-xs text-forest hover:bg-parchment disabled:opacity-50"
          >
            {poll.open_ended ? "Set an end time" : "Change end time"}
          </button>
        )}
      </div>

      {panel === "close" && (
        <div role="group" aria-label="Close now" className="flex flex-col gap-2 rounded-lg border border-amber/60 bg-parchment p-3 text-sm text-ink">
          <p className="font-semibold">Close &ldquo;{poll.question}&rdquo; right now?</p>
          <ul className="ml-5 list-disc text-muted">
            <li>Voting stops immediately. Its votes are kept and its results stay in the history.</li>
            <li>The results email is sent now, once.</li>
            {poll.repeat_daily && <li>It repeats daily, so tomorrow&apos;s copy is queued as usual.</li>}
            {poll.is_long && (
              <li>
                A daily poll that was paused to make way for this one goes back in the queue (unless
                you&apos;ve queued a different poll).
              </li>
            )}
          </ul>
          {error && <p className="text-amber">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={closeNow}
              disabled={busy}
              className="rounded-md bg-forest px-3 py-1.5 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50"
            >
              {busy ? "Closing…" : "Yes, close it now"}
            </button>
            <button
              type="button"
              onClick={() => setPanel(null)}
              className="rounded-md border border-moss px-3 py-1.5 text-sm text-muted hover:bg-card"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {panel === "end" && (
        <div role="group" aria-label="Change end time" className="flex flex-col gap-2 rounded-lg border border-amber/60 bg-parchment p-3 text-sm text-ink">
          <label htmlFor={`end-${poll.id}`} className="font-semibold">
            New end time (Eastern Time)
          </label>
          <input
            id={`end-${poll.id}`}
            type="datetime-local"
            value={endValue}
            min={toEasternDateTimeInput(new Date())}
            onChange={(e) => setEndValue(e.target.value)}
            className="w-fit rounded-md border border-moss bg-card px-2 py-1 text-sm text-ink outline-none focus:border-forest"
          />
          <p className="text-[11px] text-muted">
            Later or earlier is fine, but not in the past. To end it right now use Close now.
          </p>
          {emailNote && <p className="text-[11px] text-muted">{emailNote}</p>}
          {error && <p className="text-amber">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={saveEnd}
              disabled={busy || !picked}
              className="rounded-md bg-forest px-3 py-1.5 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save end time"}
            </button>
            <button
              type="button"
              onClick={() => setPanel(null)}
              className="rounded-md border border-moss px-3 py-1.5 text-sm text-muted hover:bg-card"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
