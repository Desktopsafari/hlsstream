"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { POLL_REFRESH_INTERVAL_MS } from "@/config/constants";
import { publicDeadline } from "@/lib/pollDuration";
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
  // Optional picture shown above the question; absent/null for polls without
  // one (and for every poll until supabase/poll_question_image.sql is run).
  image_url?: string | null;
  // Only set on a poll with a chosen duration (multi-day, specific end time,
  // open-ended). A normal daily poll leaves both empty and the card is exactly
  // as it always was.
  ends_at?: string | null;
  open_ended?: boolean | null;
};

// 16:9 crop at the card's full width, capped in height so it can't take over
// the card on wide screens. If the file is missing or fails to load it renders
// nothing, so the card falls back to looking like a poll without a picture.
function QuestionPicture({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div className="relative aspect-video max-h-64 w-full overflow-hidden rounded-lg border border-moss bg-moss/40">
      <Image
        src={url}
        alt={alt}
        fill
        sizes="(min-width: 1024px) 720px, 100vw"
        className="object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

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
  const deadline = poll.status === "open" ? publicDeadline(poll) : null;

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

      {poll.image_url && <QuestionPicture key={poll.image_url} url={poll.image_url} alt={poll.question} />}

      <p className={isClosed ? "text-base font-semibold text-ink" : "text-sm font-medium text-ink"}>
        {poll.question}
      </p>

      {deadline && <p className="text-xs text-muted">{deadline}</p>}

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
