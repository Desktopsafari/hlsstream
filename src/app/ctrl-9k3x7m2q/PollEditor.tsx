"use client";

import { useState } from "react";

type PollOptionResult = {
  option_id: string;
  label: string;
  display_order: number;
  vote_count: number;
};

type EditablePoll = {
  id: string;
  question: string;
  status: "scheduled" | "open" | "closed";
  options: PollOptionResult[];
};

type EditOption = { id?: string; label: string };

export default function PollEditor({
  poll,
  onSaved,
  onCancel,
}: {
  poll: EditablePoll;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const totalVotes = poll.options.reduce((sum, o) => sum + o.vote_count, 0);
  const locked = totalVotes > 0;

  const [question, setQuestion] = useState(poll.question);
  const [options, setOptions] = useState<EditOption[]>(
    [...poll.options]
      .sort((a, b) => a.display_order - b.display_order)
      .map((o) => ({ id: o.option_id, label: o.label })),
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const lockedExplanation = `This poll already has ${totalVotes} vote${
    totalVotes === 1 ? "" : "s"
  }, so its options are locked. Adding, removing, or renaming an option now would leave existing votes attached to options that no longer mean the same thing. You can still edit the question text (for example, to fix a typo).`;

  function blockedAction() {
    setNotice(lockedExplanation);
  }

  async function save() {
    setSaving(true);
    setError(null);

    const res = await fetch("/api/admin/polls", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pollId: poll.id,
        question,
        options: options.map((o) => ({ id: o.id, label: o.label })),
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to save changes.");
      return;
    }
    onSaved();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-forest/40 bg-parchment p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        Editing {poll.status === "open" ? "live" : "queued"} poll
        {locked && ` · ${totalVotes} vote${totalVotes === 1 ? "" : "s"}`}
      </p>

      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        className="rounded-md border border-moss bg-card px-3 py-2 text-sm text-ink outline-none focus:border-forest"
      />

      {locked && (
        <p className="rounded-md border border-amber/50 bg-card p-2 text-xs text-ink">
          Options are locked because votes exist. Only the question can be edited.
        </p>
      )}

      {options.map((opt, i) => (
        <div key={opt.id ?? `new-${i}`} className="flex gap-2">
          <input
            value={opt.label}
            readOnly={locked}
            onFocus={() => locked && blockedAction()}
            onChange={(e) => {
              const next = [...options];
              next[i] = { ...next[i], label: e.target.value };
              setOptions(next);
            }}
            className={`flex-1 rounded-md border border-moss px-3 py-2 text-sm text-ink outline-none focus:border-forest ${
              locked ? "cursor-not-allowed bg-moss/40" : "bg-card"
            }`}
          />
          <button
            type="button"
            onClick={() => {
              if (locked) return blockedAction();
              if (options.length <= 2) {
                return setNotice("A poll needs at least 2 options.");
              }
              setNotice(null);
              setOptions(options.filter((_, idx) => idx !== i));
            }}
            aria-label={`Remove option ${i + 1}`}
            className={`rounded-md border border-moss px-2 text-sm hover:bg-card ${
              locked ? "text-muted/50" : "text-muted"
            }`}
          >
            ✕
          </button>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            if (locked) return blockedAction();
            setNotice(null);
            setOptions([...options, { label: "" }]);
          }}
          className={`rounded-md border border-moss px-3 py-1.5 text-sm hover:bg-card ${
            locked ? "text-forest/50" : "text-forest"
          }`}
        >
          + Add option
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-forest px-3 py-1.5 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-moss px-3 py-1.5 text-sm text-muted hover:bg-card"
        >
          Cancel
        </button>
      </div>

      {notice && <p className="text-sm text-ink">{notice}</p>}
      {error && <p className="text-sm text-amber">{error}</p>}
    </div>
  );
}
