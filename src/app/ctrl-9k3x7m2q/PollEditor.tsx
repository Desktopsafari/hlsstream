"use client";

import { useState } from "react";
import OptionImageField from "./OptionImageField";

type PollOptionResult = {
  option_id: string;
  label: string;
  display_order: number;
  vote_count: number;
  image_url: string | null;
};

type EditablePoll = {
  id: string;
  question: string;
  status: "scheduled" | "open" | "closed";
  options: PollOptionResult[];
  repeat_daily: boolean;
  repeat_paused: boolean;
};

// Existing options have an id and their picture is stored on the option itself
// (changes apply immediately). A new option has no id yet, so a picture picked
// for it is a pending upload that's attached when the poll is saved.
type EditOption = { id?: string; label: string; imageUrl: string | null; pendingPath: string | null };

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
      .map((o) => ({ id: o.option_id, label: o.label, imageUrl: o.image_url, pendingPath: null })),
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const lockedExplanation = `This poll already has ${totalVotes} vote${
    totalVotes === 1 ? "" : "s"
  }, so its options and pictures are locked. Adding, removing, renaming, or changing the picture of an option now would leave existing votes attached to options that no longer mean the same thing. You can still edit the question text (for example, to fix a typo).`;

  function blockedAction() {
    setNotice(lockedExplanation);
  }

  function patchOption(index: number, patch: Partial<EditOption>) {
    setOptions((prev) => prev.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }

  async function deletePending(path: string | null) {
    if (path) await fetch(`/api/admin/polls/image?path=${encodeURIComponent(path)}`, { method: "DELETE" });
  }

  async function uploadPicture(index: number, file: File): Promise<string | null> {
    const opt = options[index];
    const body = new FormData();
    body.append("file", file);
    if (opt.id) body.append("optionId", opt.id);
    const res = await fetch("/api/admin/polls/image", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return data.error ?? "Upload failed.";
    if (opt.id) {
      patchOption(index, { imageUrl: data.url });
    } else {
      patchOption(index, { imageUrl: data.url, pendingPath: data.path });
      await deletePending(opt.pendingPath);
    }
    return null;
  }

  async function removePicture(index: number): Promise<string | null> {
    const opt = options[index];
    if (opt.id) {
      const res = await fetch(`/api/admin/polls/image?optionId=${opt.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return data.error ?? "Couldn't remove the picture.";
      }
      patchOption(index, { imageUrl: null });
      return null;
    }
    patchOption(index, { imageUrl: null, pendingPath: null });
    await deletePending(opt.pendingPath);
    return null;
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
        options: options.map((o) => ({
          id: o.id,
          label: o.label,
          imagePath: o.id ? undefined : (o.pendingPath ?? undefined),
        })),
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

      {locked && (
        <p className="rounded-md border border-amber/50 bg-card p-2 text-xs text-ink">
          Options and pictures are locked because votes exist. Only the question can be edited.
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
        <div key={opt.id ?? `new-${i}`} className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              value={opt.label}
              readOnly={locked}
              onFocus={() => locked && blockedAction()}
              onChange={(e) => patchOption(i, { label: e.target.value })}
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
                // A new option's unsaved picture would otherwise be left behind.
                if (!opt.id) deletePending(opt.pendingPath);
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
          {imagesSupported && (
            <OptionImageField
              url={opt.imageUrl}
              label={opt.label}
              locked={locked}
              lockedNote="Pictures are locked once votes exist, like the options."
              onUpload={(file) => uploadPicture(i, file)}
              onRemove={() => removePicture(i)}
            />
          )}
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            if (locked) return blockedAction();
            setNotice(null);
            setOptions([...options, { label: "", imageUrl: null, pendingPath: null }]);
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

      {imagesSupported && (
        <p className="text-[11px] text-muted">
          Picture changes on existing options apply right away; they don&apos;t wait for Save.
        </p>
      )}
      {notice && <p className="text-sm text-ink">{notice}</p>}
      {error && <p className="text-sm text-amber">{error}</p>}
    </div>
  );
}
