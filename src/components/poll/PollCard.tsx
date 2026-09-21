"use client";

import { useEffect, useState } from "react";
import { POLL_REFRESH_INTERVAL_MS } from "@/config/constants";
import { getSessionId } from "@/lib/session";

type PollOption = {
  option_id: string;
  label: string;
  display_order: number;
  vote_count: number;
};

type Poll = {
  id: string;
  question: string;
  status: "scheduled" | "open" | "closed";
};

type PollResponse = {
  poll: Poll | null;
  options: PollOption[];
  hasVoted: boolean;
  votedOptionId: string | null;
};

export default function PollCard() {
  const [data, setData] = useState<PollResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const sessionId = getSessionId();
    const res = await fetch(`/api/poll?sessionId=${sessionId}`);
    if (res.ok) {
      setData(await res.json());
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  async function vote(optionId: string) {
    if (!data?.poll) return;
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pollId: data.poll.id,
        optionId,
        sessionId: getSessionId(),
      }),
    });

    setSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to vote.");
      return;
    }

    load();
  }

  if (!data || !data.poll) {
    return <p className="text-sm text-muted">No vote scheduled right now.</p>;
  }

  const { poll, options, hasVoted, votedOptionId } = data;
  const totalVotes = options.reduce((sum, o) => sum + o.vote_count, 0);
  const showResults = poll.status === "closed" || hasVoted;

  const isClosed = poll.status === "closed";

  return (
    <div className="flex flex-col gap-3">
      {isClosed && (
        <div
          role="status"
          className="rounded-lg border-b-4 border-amber bg-forest px-4 py-4 text-center"
        >
          <p className="font-heading text-3xl font-black uppercase leading-none tracking-wide text-parchment sm:text-4xl">
            Voting closed!
          </p>
        </div>
      )}

      <p className={isClosed ? "text-base font-semibold text-ink" : "text-sm font-medium text-ink"}>
        {poll.question}
      </p>

      {!showResults &&
        options.map((opt) => (
          <button
            key={opt.option_id}
            onClick={() => vote(opt.option_id)}
            disabled={submitting}
            className="rounded-md border border-moss bg-parchment px-3 py-2 text-left text-sm text-ink hover:border-forest disabled:opacity-50"
          >
            {opt.label}
          </button>
        ))}

      {showResults &&
        options.map((opt) => {
          const pct = totalVotes > 0 ? Math.round((opt.vote_count / totalVotes) * 100) : 0;
          const isMine = opt.option_id === votedOptionId;
          return (
            <div key={opt.option_id} className="text-sm">
              <div className="flex justify-between">
                <span className={isMine ? "font-semibold text-forest" : "text-ink"}>
                  {opt.label}
                  {isMine && " (your vote)"}
                </span>
                <span className="text-muted">
                  {opt.vote_count} · {pct}%
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-moss">
                <div className="h-full bg-amber" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}

      {hasVoted && poll.status === "open" && (
        <p className="text-xs text-muted">Thanks for voting! Results update live.</p>
      )}
      {error && <p className="text-xs text-amber">{error}</p>}
    </div>
  );
}
