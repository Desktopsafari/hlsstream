"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
};

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

  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollSubmitting, setPollSubmitting] = useState(false);

  const [banTarget, setBanTarget] = useState("");
  const [banReason, setBanReason] = useState("");
  const [banError, setBanError] = useState<string | null>(null);

  async function loadPolls() {
    const res = await fetch("/api/admin/polls");
    if (res.ok) {
      const data = await res.json();
      setPolls(data.polls);
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

  async function submitPoll(e: React.FormEvent) {
    e.preventDefault();
    setPollError(null);
    setPollSubmitting(true);

    const res = await fetch("/api/admin/polls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        options: options.filter((o) => o.trim().length > 0),
      }),
    });

    setPollSubmitting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setPollError(data.error ?? "Failed to create poll.");
      return;
    }

    setQuestion("");
    setOptions(["", ""]);
    loadPolls();
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
          <div className="flex gap-2">
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
          </div>
          {pollError && <p className="text-sm text-amber">{pollError}</p>}
        </form>
      </section>

      {/* Poll history */}
      <section className="rounded-xl border border-moss bg-card p-5 shadow-sm">
        <h2 className="mb-3 font-heading text-lg font-semibold text-forest">Poll History</h2>
        <div className="flex flex-col gap-4">
          {polls.length === 0 && <p className="text-sm text-muted">No polls yet.</p>}
          {polls.map((poll) => (
            <div key={poll.id} className="border-b border-moss pb-3 last:border-0">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">{poll.question}</p>
                <span className="text-xs uppercase text-muted">{poll.status}</span>
              </div>
              <ul className="mt-1 text-sm text-muted">
                {poll.options.map((o) => (
                  <li key={o.option_id}>
                    {o.label}: {o.vote_count}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

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
