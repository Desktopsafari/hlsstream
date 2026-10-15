"use client";

import { useState } from "react";
import PollImageField from "./PollImageField";

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
  repeat_daily: boolean;
  repeat_paused: boolean;
  image_url: string | null;
};

type EditOption = { id?: string; label: string };

export default function PollEditor({
  poll,
  imagesSupported,
  onSaved,
  onCancel,
}: {
  poll: EditablePoll;
  imagesSupported: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const totalVotes = poll.options.reduce((sum, o) => sum + o.vote_count, 0);
  const locked = totalVotes > 0;

  const [question, setQuestion] = useState(poll.question);
  const [repeatDaily, setRepeatDaily] = useState(poll.repeat_daily);
  const [options, setOptions] = useState<EditOption[]>(
    [...poll.options]
      .sort((a, b) => a.display_order - b.display_order)
      .map((o) => ({ id: o.option_id, label: o.label })),
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [imageUrl, setImageUrl] = useState(poll.image_url);

  // The picture follows the question text's rule: editable here (queued or
  // open) even when votes exist, and it applies right away rather than on Save.
  async function uploadPicture(file: File): Promise<string | null> {
    const body = new FormData();
    body.append("file", file);
    body.append("pollId", poll.id);
    const res = await fetch("/api/admin/polls/image", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return data.error ?? "Upload failed.";
    setImageUrl(data.url);
    return null;
  }

  async function removePicture(): Promise<string | null> {
    const res = await fetch(`/api/admin/polls/image?pollId=${poll.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return data.error ?? "Couldn't remove the picture.";
    }
    setImageUrl(null);
    return null;
  }

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
        repeatDaily,
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

      {imagesSupported && (
        <div className="flex flex-col gap-1">
          <PollImageField url={imageUrl} onUpload={uploadPicture} onRemove={removePicture} />
          <p className="text-[11px] text-muted">
            The picture can be changed any time before the poll closes, even after votes come in
            (like the question). It applies right away, not on Save.
          </p>
        </div>
      )}

      {locked && (
        <p className="rounded-md border border-amber/50 bg-card p-2 text-xs text-ink">
          Options are locked because votes exist. Only the question{imagesSupported ? " and its picture" : ""} can be edited.
        </p>
      )}

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={repeatDaily}
          onChange={(e) => setRepeatDaily(e.target.checked)}
          className="h-4 w-4 rounded border-moss"
        />
        Repeat this poll daily
      </label>

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
