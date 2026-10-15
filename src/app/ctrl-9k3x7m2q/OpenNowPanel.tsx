"use client";

import { useEffect, useState } from "react";

type Info = {
  allowed: boolean;
  cutoff: string;
  message: string;
  openPoll: {
    id: string;
    question: string;
    votes: number;
    repeatDaily: boolean;
    repeatOutcome: "none" | "queue_copy" | "pause";
  } | null;
  staleCount: number;
  queued: { id: string; question: string } | null;
};

// Confirmation step for "Open now". Shows how long voting would run, and, if
// another poll is open, exactly what happens to it before anything changes.
// Used both for a poll waiting in the queue ({ pollId }) and for a new poll
// from the Set Next Poll form ({ newPoll }).
export default function OpenNowPanel({
  pollId,
  newPoll,
  onOpened,
  onCancel,
  onQueueInstead,
}: {
  pollId?: string;
  newPoll?: { question: string; options: { label: string; imagePath: string | null }[]; repeatDaily: boolean };
  onOpened: (message: string) => void;
  onCancel: () => void;
  // Form only: queue the poll for tomorrow's noon instead (shown after 8pm).
  onQueueInstead?: () => void;
}) {
  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    const res = await fetch(`/api/admin/polls/open-now${pollId ? `?pollId=${pollId}` : ""}`);
    if (!res.ok) {
      setLoadError("Couldn't check the poll status. Try again.");
      return;
    }
    setInfo(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function confirm() {
    if (!info) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/admin/polls/open-now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(pollId ? { pollId } : newPoll),
        confirmReplace: info.openPoll !== null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);

    if (!res.ok) {
      setError(data.error ?? "Failed to open the poll.");
      // The situation changed since the panel loaded (e.g. another poll opened);
      // show the fresh picture rather than letting a stale confirm go through.
      if (data.code === "confirm_replace" || data.code === "just_opened" || data.code === "collision") {
        load();
      }
      return;
    }

    const closed: { question: string; repeatMessage: string }[] = data.closed ?? [];
    const extra = closed
      .map((c) => ` Closed "${c.question}" and emailed its results.${c.repeatMessage}`)
      .join("");
    onOpened(`${data.message}${extra}`);
  }

  return (
    <div
      role="group"
      aria-label="Open now"
      className="flex flex-col gap-2 rounded-lg border border-amber/60 bg-parchment p-3 text-sm text-ink"
    >
      {!info && !loadError && <p className="text-muted">Checking…</p>}
      {loadError && <p className="text-amber">{loadError}</p>}

      {info && !info.allowed && (
        <>
          <p className="font-semibold">{info.message}</p>
          {onQueueInstead ? (
            <p>You can queue it for tomorrow&apos;s noon instead.</p>
          ) : (
            <p>It stays queued and opens at tomorrow&apos;s noon.</p>
          )}
        </>
      )}

      {info && info.allowed && (
        <>
          <p className="font-semibold">{info.message}</p>

          {info.openPoll && (
            <div className="rounded-md border border-amber bg-card p-2">
              <p className="font-semibold text-amber">
                A poll is already open: &ldquo;{info.openPoll.question}&rdquo; (
                {info.openPoll.votes} vote{info.openPoll.votes === 1 ? "" : "s"}).
              </p>
              <p className="mt-1">Opening this one will:</p>
              <ul className="ml-5 list-disc text-muted">
                <li>
                  close that poll right now. Its {info.openPoll.votes} vote
                  {info.openPoll.votes === 1 ? " is" : "s are"} kept and its results stay in the history.
                </li>
                <li>
                  email its results once, now. It won&apos;t be emailed again at {info.cutoff}.
                </li>
                {info.openPoll.repeatOutcome === "queue_copy" && (
                  <li>
                    queue tomorrow&apos;s copy of it (it repeats daily), the same as it would at{" "}
                    {info.cutoff}.
                  </li>
                )}
                {info.openPoll.repeatOutcome === "pause" && (
                  <li>
                    pause its daily repeat, because &ldquo;{info.queued?.question}&rdquo; is already
                    queued for tomorrow.
                  </li>
                )}
              </ul>
            </div>
          )}

          {info.staleCount > 0 && (
            <p className="text-muted">
              {info.staleCount} earlier poll{info.staleCount === 1 ? " is" : "s are"} past {info.cutoff} but
              not closed yet; they&apos;ll be closed and their results emailed as well.
            </p>
          )}
          {info.queued && !info.openPoll && (
            <p className="text-muted">
              &ldquo;{info.queued.question}&rdquo; is queued separately and still opens at
              tomorrow&apos;s noon.
            </p>
          )}
        </>
      )}

      {error && <p className="text-amber">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {info?.allowed && (
          <button
            type="button"
            onClick={confirm}
            disabled={submitting}
            className="rounded-md bg-forest px-3 py-1.5 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50"
          >
            {submitting
              ? "Opening…"
              : info.openPoll
                ? "Close that poll and open this one now"
                : "Open now"}
          </button>
        )}
        {info && !info.allowed && onQueueInstead && (
          <button
            type="button"
            onClick={onQueueInstead}
            className="rounded-md bg-forest px-3 py-1.5 text-sm font-semibold text-parchment hover:bg-forest-dark"
          >
            Queue for tomorrow&apos;s noon
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-moss px-3 py-1.5 text-sm text-muted hover:bg-card"
        >
          {info && !info.allowed ? "Close" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
