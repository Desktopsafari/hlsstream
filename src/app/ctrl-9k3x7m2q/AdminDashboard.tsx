"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import PollEditor from "./PollEditor";
import OpenNowPanel from "./OpenNowPanel";
import PollImageField from "./PollImageField";
import DurationField, { DEFAULT_DURATION, toDurationInput, type DurationValue } from "./DurationField";
import OpenPollControls from "./OpenPollControls";
import { cutoffLabel, formatEasternDate } from "@/lib/pollSchedule";
import SpeciesAdmin from "./SpeciesAdmin";
import SuggestionEventAdmin from "./SuggestionEventAdmin";
import NotificationCategoriesAdmin from "./NotificationCategoriesAdmin";
import BroadcastComposer from "./BroadcastComposer";
import SuggestionsAdmin from "./SuggestionsAdmin";

type PollOptionResult = {
  option_id: string;
  label: string;
  display_order: number;
  vote_count: number;
};

type Poll = {
  id: string;
  question: string;
  status: "scheduled" | "open" | "closed";
  opens_at: string;
  closes_at: string;
  created_at: string;
  options: PollOptionResult[];
  repeat_daily: boolean;
  repeat_paused: boolean;
  opened_early: boolean;
  image_url: string | null;
  // How long voting runs (all empty on a normal daily poll).
  ends_at: string | null;
  open_ended: boolean;
  duration_days: number | null;
  voting_end: string | null; // for an open poll: when voting ends, null = no end
  is_long: boolean;
};

// "Today only" / "3 days from when it opens" / "until Sun, Oct 18, 8:00 PM ET" / "until closed".
function describeDuration(p: Poll): string {
  if (p.open_ended) return "until you close it (no end)";
  if (p.duration_days) return `${p.duration_days} days from when it opens (ends ${cutoffLabel()} on the last day)`;
  if (p.ends_at) return `until ${formatEasternDate(new Date(p.ends_at))} ET`;
  return `today only (ends ${cutoffLabel()})`;
}

function formatEastern(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

type Ban = {
  id: string;
  session_id: string | null;
  ip_address: string | null;
  reason: string | null;
  created_at: string;
};

export default function AdminDashboard() {
  const router = useRouter();
  const [polls, setPolls] = useState<Poll[]>([]);
  const [bans, setBans] = useState<Ban[]>([]);
  const [editingPollId, setEditingPollId] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  // The question's picture: uploaded as soon as it's picked and kept as a
  // "pending" file (imagePath) until the poll is saved.
  const [image, setImage] = useState<{ path: string; url: string | null } | null>(null);
  const [repeatDaily, setRepeatDaily] = useState(false);
  const [duration, setDuration] = useState<DurationValue>(DEFAULT_DURATION);
  const [durationsSupported, setDurationsSupported] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollNotice, setPollNotice] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [pollSubmitting, setPollSubmitting] = useState(false);
  const [imagesSupported, setImagesSupported] = useState(false);
  // Which Open now confirmation is showing: the form's, or a queued poll's.
  const [openNowFor, setOpenNowFor] = useState<{ kind: "form" } | { kind: "poll"; pollId: string } | null>(
    null,
  );

  const [banTarget, setBanTarget] = useState("");
  const [banReason, setBanReason] = useState("");
  const [banError, setBanError] = useState<string | null>(null);

  async function loadPolls() {
    const res = await fetch("/api/admin/polls");
    if (res.ok) {
      const data = await res.json();
      setPolls(data.polls);
      setImagesSupported(data.imagesSupported === true);
      setDurationsSupported(data.durationsSupported === true);
    }
  }

  async function loadBans() {
    const res = await fetch("/api/admin/bans");
    if (res.ok) {
      const data = await res.json();
      setBans(data.bans);
    }
  }

  useEffect(() => {
    loadPolls();
    loadBans();
  }, []);

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/");
  }

  const filledOptions = options.filter((o) => o.trim().length > 0);

  function resetPollForm() {
    setQuestion("");
    setOptions(["", ""]);
    setImage(null);
    setRepeatDaily(false);
    setDuration(DEFAULT_DURATION);
  }

  async function queuePoll() {
    setPollError(null);
    setPollNotice(null);
    setOpenNowFor(null);
    setPollSubmitting(true);

    const res = await fetch("/api/admin/polls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        options: filledOptions,
        repeatDaily,
        imagePath: image?.path ?? null,
        duration: toDurationInput(duration),
      }),
    });

    setPollSubmitting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setPollError(data.error ?? "Failed to create poll.");
      return;
    }

    resetPollForm();
    loadPolls();
  }

  function submitPoll(e: React.FormEvent) {
    e.preventDefault();
    queuePoll();
  }

  function startFormOpenNow() {
    setPollError(null);
    setPollNotice(null);
    if (question.trim().length === 0 || filledOptions.length < 2) {
      setPollError("Need a question and at least 2 non-empty options.");
      return;
    }
    if (duration.mode === "until" && !duration.until) {
      setPollError("Pick the end date and time for voting.");
      return;
    }
    setOpenNowFor({ kind: "form" });
  }

  // The picture picked in the form uploads right away and waits as a "pending"
  // file until the poll is saved; replacing or removing it deletes the old file.
  async function uploadFormPicture(file: File): Promise<string | null> {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/admin/polls/image", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return data.error ?? "Upload failed.";
    const previous = image?.path;
    setImage({ path: data.path, url: data.url });
    if (previous) {
      await fetch(`/api/admin/polls/image?path=${encodeURIComponent(previous)}`, { method: "DELETE" });
    }
    return null;
  }

  async function removeFormPicture(): Promise<string | null> {
    const previous = image?.path;
    setImage(null);
    if (previous) {
      await fetch(`/api/admin/polls/image?path=${encodeURIComponent(previous)}`, { method: "DELETE" });
    }
    return null;
  }

  async function submitBan(e: React.FormEvent) {
    e.preventDefault();
    setBanError(null);

    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(banTarget.trim());

    const res = await fetch("/api/admin/bans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: isIp ? null : banTarget.trim(),
        ipAddress: isIp ? banTarget.trim() : null,
        reason: banReason,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setBanError(data.error ?? "Failed to add ban.");
      return;
    }

    setBanTarget("");
    setBanReason("");
    loadBans();
  }

  async function removeBan(id: string) {
    await fetch(`/api/admin/bans?id=${id}`, { method: "DELETE" });
    loadBans();
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold text-forest">Admin</h1>
        <button
          onClick={handleLogout}
          className="rounded-md border border-moss px-3 py-1.5 text-sm text-muted hover:bg-card"
        >
          Log out
        </button>
      </div>

      {/* Next poll */}
      <section className="rounded-xl border border-moss bg-card p-5 shadow-sm">
        <h2 className="mb-3 font-heading text-lg font-semibold text-forest">Set Next Poll</h2>
        <form onSubmit={submitPoll} className="flex flex-col gap-3">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Poll question"
            className="rounded-md border border-moss bg-parchment px-3 py-2 text-sm text-ink outline-none focus:border-forest"
          />
          {imagesSupported ? (
            <PollImageField url={image?.url ?? null} onUpload={uploadFormPicture} onRemove={removeFormPicture} />
          ) : (
            <p className="text-[11px] text-muted">
              The poll picture is off until supabase/poll_question_image.sql has been run in the
              Supabase SQL Editor.
            </p>
          )}
          {options.map((opt, i) => (
            <input
              key={i}
              value={opt}
              onChange={(e) => {
                const next = [...options];
                next[i] = e.target.value;
                setOptions(next);
              }}
              placeholder={`Option ${i + 1}`}
              className="rounded-md border border-moss bg-parchment px-3 py-2 text-sm text-ink outline-none focus:border-forest"
            />
          ))}
          <DurationField
            value={duration}
            onChange={setDuration}
            repeatDaily={repeatDaily}
            supported={durationsSupported}
          />
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={repeatDaily}
              disabled={duration.mode !== "today"}
              onChange={(e) => setRepeatDaily(e.target.checked)}
              className="h-4 w-4 rounded border-moss"
            />
            <span className={duration.mode !== "today" ? "text-muted" : undefined}>Repeat this poll daily</span>
          </label>
          {duration.mode !== "today" && (
            <p className="-mt-2 text-[11px] text-muted">
              Not available for a multi-day or open-ended poll. Choose &ldquo;Today only&rdquo; above to
              repeat daily.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setOptions([...options, ""])}
              className="rounded-md border border-moss px-3 py-1.5 text-sm text-forest hover:bg-parchment"
            >
              + Add option
            </button>
            <button
              type="submit"
              disabled={pollSubmitting}
              className="rounded-md bg-forest px-3 py-1.5 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50"
            >
              Queue poll
            </button>
            <button
              type="button"
              onClick={startFormOpenNow}
              disabled={pollSubmitting || openNowFor?.kind === "form"}
              className="rounded-md border border-forest px-3 py-1.5 text-sm font-semibold text-forest hover:bg-parchment disabled:opacity-50"
            >
              Open now
            </button>
          </div>
          <p className="text-[11px] text-muted">
            {duration.mode === "today"
              ? `Queue poll opens it at the next noon. Open now makes it live immediately; voting still ends at ${cutoffLabel()}.`
              : "Queue poll opens it at the next noon. Open now makes it live immediately."}
          </p>
          {openNowFor?.kind === "form" && (
            <OpenNowPanel
              newPoll={{
                question,
                options: filledOptions,
                repeatDaily,
                imagePath: image?.path ?? null,
                duration: toDurationInput(duration),
              }}
              onCancel={() => setOpenNowFor(null)}
              onQueueInstead={queuePoll}
              onOpened={(message) => {
                setOpenNowFor(null);
                resetPollForm();
                setPollNotice(message);
                loadPolls();
              }}
            />
          )}
          {pollError && <p className="text-sm text-amber">{pollError}</p>}
          {pollNotice && <p className="text-sm text-forest">{pollNotice}</p>}
        </form>
      </section>

      {/* Poll history */}
      <section className="rounded-xl border border-moss bg-card p-5 shadow-sm">
        <h2 className="mb-3 font-heading text-lg font-semibold text-forest">Poll History</h2>
        {historyNotice && <p className="mb-3 text-sm text-forest">{historyNotice}</p>}
        <div className="flex flex-col gap-4">
          {polls.length === 0 && <p className="text-sm text-muted">No polls yet.</p>}
          {polls.map((poll) =>
            editingPollId === poll.id ? (
              <PollEditor
                key={poll.id}
                poll={poll}
                imagesSupported={imagesSupported}
                durationsSupported={durationsSupported}
                onCancel={() => {
                  setEditingPollId(null);
                  loadPolls();
                }}
                onSaved={() => {
                  setEditingPollId(null);
                  loadPolls();
                }}
              />
            ) : (
              <div key={poll.id} className="border-b border-moss pb-3 last:border-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {poll.image_url && (
                      <span className="relative aspect-video w-12 shrink-0 overflow-hidden rounded border border-moss">
                        <Image src={poll.image_url} alt="" fill sizes="48px" className="object-cover" />
                      </span>
                    )}
                    <p className="text-sm font-semibold text-ink">{poll.question}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase text-muted">{poll.status}</span>
                    {poll.status === "scheduled" && (
                      <button
                        onClick={() => setOpenNowFor({ kind: "poll", pollId: poll.id })}
                        disabled={openNowFor?.kind === "poll" && openNowFor.pollId === poll.id}
                        className="rounded-md border border-forest px-2 py-1 text-xs font-semibold text-forest hover:bg-parchment disabled:opacity-50"
                      >
                        Open now
                      </button>
                    )}
                    {poll.status !== "closed" && (
                      <button
                        onClick={() => setEditingPollId(poll.id)}
                        className="rounded-md border border-moss px-2 py-1 text-xs text-forest hover:bg-parchment"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>
                {poll.repeat_daily && !poll.repeat_paused && (
                  <p className="mt-1 text-xs font-semibold text-forest">🔁 Repeats daily</p>
                )}
                {poll.repeat_paused && (
                  <p className="mt-1 text-xs text-amber">
                    🔁 Repeating poll paused — a different poll was manually queued for the next
                    cycle.
                  </p>
                )}
                {poll.opened_early && (
                  <p className="mt-1 text-xs text-amber">
                    ⚡ Opened early with Open now at {formatEastern(poll.opens_at)} ET
                  </p>
                )}
                {poll.status !== "closed" && (poll.is_long || poll.duration_days) && (
                  <p className="mt-1 text-xs font-semibold text-forest">⏱ Voting runs {describeDuration(poll)}</p>
                )}
                {poll.status === "open" && (
                  <OpenPollControls
                    poll={poll}
                    durationsSupported={durationsSupported}
                    onChanged={(message) => {
                      setHistoryNotice(message);
                      loadPolls();
                    }}
                  />
                )}
                {openNowFor?.kind === "poll" && openNowFor.pollId === poll.id && (
                  <div className="mt-2">
                    <OpenNowPanel
                      pollId={poll.id}
                      onCancel={() => setOpenNowFor(null)}
                      onOpened={(message) => {
                        setOpenNowFor(null);
                        setPollNotice(message);
                        loadPolls();
                      }}
                    />
                  </div>
                )}
                <ul className="mt-1 text-sm text-muted">
                  {poll.options.map((o) => (
                    <li key={o.option_id}>
                      {o.label}: {o.vote_count}
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
        </div>
      </section>

      <SuggestionEventAdmin />

      <SpeciesAdmin />

      <NotificationCategoriesAdmin />
      <BroadcastComposer />
      <SuggestionsAdmin />

      {/* Moderation */}
      <section className="rounded-xl border border-moss bg-card p-5 shadow-sm">
        <h2 className="mb-3 font-heading text-lg font-semibold text-forest">Chat Moderation</h2>
        <form onSubmit={submitBan} className="mb-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={banTarget}
            onChange={(e) => setBanTarget(e.target.value)}
            placeholder="Session ID or IP address"
            className="flex-1 rounded-md border border-moss bg-parchment px-3 py-2 text-sm text-ink outline-none focus:border-forest"
          />
          <input
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
            placeholder="Reason (optional)"
            className="flex-1 rounded-md border border-moss bg-parchment px-3 py-2 text-sm text-ink outline-none focus:border-forest"
          />
          <button
            type="submit"
            className="rounded-md bg-forest px-3 py-2 text-sm font-semibold text-parchment hover:bg-forest-dark"
          >
            Ban
          </button>
        </form>
        {banError && <p className="mb-2 text-sm text-amber">{banError}</p>}

        <div className="flex flex-col gap-2">
          {bans.length === 0 && <p className="text-sm text-muted">No active bans.</p>}
          {bans.map((ban) => (
            <div key={ban.id} className="flex items-center justify-between text-sm">
              <span>
                {ban.session_id ?? ban.ip_address}
                {ban.reason && <span className="text-muted"> — {ban.reason}</span>}
              </span>
              <button
                onClick={() => removeBan(ban.id)}
                className="rounded-md border border-moss px-2 py-1 text-xs text-muted hover:bg-parchment"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
