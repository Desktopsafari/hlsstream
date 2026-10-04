"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import NameSuggestionsReview from "./NameSuggestionsReview";

type AdminFrog = {
  id: string;
  label: string;
  imageUrl: string | null;
  suggestionCount: number;
};

type AdminEvent = {
  id: string;
  prompt: string;
  description: string | null;
  isOn: boolean;
  endsAtLocal: string;
  endsAt: string | null;
  isActive: boolean;
  hasEnded: boolean;
  createdAt: string;
  frogs: AdminFrog[];
};

const inputClass =
  "rounded-md border border-moss bg-parchment px-3 py-2 text-sm text-ink outline-none focus:border-forest";

function statusOf(e: AdminEvent): { text: string; className: string } {
  if (e.isActive) return { text: "Live on site", className: "text-forest" };
  if (e.isOn && e.hasEnded) return { text: "Ended", className: "text-muted" };
  if (e.hasEnded) return { text: "Ended", className: "text-muted" };
  return { text: "Off", className: "text-muted" };
}

function FrogImageField({
  frogId,
  url,
  onChanged,
}: {
  frogId: string;
  url: string | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("frogId", frogId);
    form.append("file", file);
    const res = await fetch("/api/admin/suggestion-events/image", { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Upload failed.");
      return;
    }
    onChanged();
  }

  async function remove() {
    setBusy(true);
    await fetch(`/api/admin/suggestion-events/image?frogId=${frogId}`, { method: "DELETE" });
    setBusy(false);
    onChanged();
  }

  return (
    <div className="flex items-center gap-3">
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-moss bg-moss/40">
        {url ? (
          <Image src={url} alt="" fill sizes="64px" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-muted">
            No image
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <label className="cursor-pointer rounded-md border border-moss px-2 py-1 text-xs text-forest hover:bg-parchment">
            {busy ? "Working…" : url ? "Replace" : "Upload"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) upload(file);
              }}
            />
          </label>
          {url && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="rounded-md border border-moss px-2 py-1 text-xs text-muted hover:bg-parchment"
            >
              Remove
            </button>
          )}
        </div>
        {error && <p className="text-xs text-amber">{error}</p>}
      </div>
    </div>
  );
}

function EventEditor({
  event,
  onSaved,
  onFrogsChanged,
  onClose,
}: {
  event: AdminEvent;
  onSaved: () => void;
  onFrogsChanged: () => Promise<AdminEvent | null>;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState(event.prompt);
  const [description, setDescription] = useState(event.description ?? "");
  const [isOn, setIsOn] = useState(event.isOn);
  const [endsAtLocal, setEndsAtLocal] = useState(event.endsAtLocal);
  const [frogs, setFrogs] = useState<AdminFrog[]>(event.frogs);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // After a structural change (add/remove/image), take the server's frog
  // list but keep any label edits that haven't been saved yet.
  async function refreshFrogs() {
    const fresh = await onFrogsChanged();
    if (!fresh) return;
    setFrogs((prev) =>
      fresh.frogs.map((f) => {
        const edited = prev.find((p) => p.id === f.id);
        return edited ? { ...f, label: edited.label } : f;
      }),
    );
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= frogs.length) return;
    const next = [...frogs];
    [next[index], next[target]] = [next[target], next[index]];
    setFrogs(next);
  }

  async function addFrog() {
    setError(null);
    const res = await fetch("/api/admin/suggestion-events/frogs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: event.id }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't add a frog.");
      return;
    }
    refreshFrogs();
  }

  async function removeFrog(frogId: string) {
    setError(null);
    const res = await fetch("/api/admin/suggestion-events/frogs", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frogId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't remove that frog.");
      return;
    }
    refreshFrogs();
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);

    const res = await fetch("/api/admin/suggestion-events", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: event.id,
        prompt,
        description,
        isOn,
        endsAtLocal,
        frogs: frogs.map((f) => ({ id: f.id, label: f.label })),
      }),
    });
    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to save.");
      return;
    }
    setMessage(isOn ? "Saved. The card is live on the site." : "Saved.");
    onSaved();
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-forest/40 bg-parchment p-3">
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Prompt, e.g. What should we name our frogs?"
        maxLength={120}
        className={inputClass}
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Short description (optional)"
        maxLength={300}
        className={inputClass}
      />

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-ink">Frogs</p>
        {frogs.map((frog, i) => (
          <div key={frog.id} className="flex flex-col gap-2 rounded-md border border-moss bg-card p-3">
            <div className="flex gap-2">
              <input
                value={frog.label}
                onChange={(e) => {
                  const next = [...frogs];
                  next[i] = { ...next[i], label: e.target.value };
                  setFrogs(next);
                }}
                placeholder="Label, e.g. Frog A"
                maxLength={40}
                aria-label={`Label for frog ${i + 1}`}
                className={`${inputClass} flex-1`}
              />
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Move up"
                className="rounded-md border border-moss px-2 text-muted hover:bg-parchment disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === frogs.length - 1}
                aria-label="Move down"
                className="rounded-md border border-moss px-2 text-muted hover:bg-parchment disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => removeFrog(frog.id)}
                aria-label="Remove frog"
                className="rounded-md border border-moss px-2 text-muted hover:bg-parchment"
              >
                ✕
              </button>
            </div>
            <FrogImageField frogId={frog.id} url={frog.imageUrl} onChanged={refreshFrogs} />
            {frog.suggestionCount > 0 && (
              <p className="text-[11px] text-muted">
                {frog.suggestionCount} idea{frog.suggestionCount === 1 ? "" : "s"} received
              </p>
            )}
          </div>
        ))}
        <div>
          <button
            type="button"
            onClick={addFrog}
            className="rounded-md border border-moss px-3 py-1.5 text-sm text-forest hover:bg-card"
          >
            + Add frog
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={isOn}
            onChange={(e) => setIsOn(e.target.checked)}
            className="h-4 w-4 rounded border-moss"
          />
          Show this card on the site
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`ends-${event.id}`} className="text-sm text-ink">
            Ends at (Eastern Time, optional)
          </label>
          <input
            id={`ends-${event.id}`}
            type="datetime-local"
            value={endsAtLocal}
            onChange={(e) => setEndsAtLocal(e.target.value)}
            className={inputClass}
          />
          {endsAtLocal && (
            <button
              type="button"
              onClick={() => setEndsAtLocal("")}
              className="rounded-md border border-moss px-2 py-1 text-xs text-muted hover:bg-card"
            >
              Clear
            </button>
          )}
        </div>
        <p className="text-[11px] text-muted">
          Only one event can be on at a time. The card disappears by itself at the end time.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-forest px-4 py-2 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save event"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-moss px-3 py-2 text-sm text-muted hover:bg-card"
        >
          Close
        </button>
        {message && <p className="text-sm text-forest">{message}</p>}
      </div>
      {error && <p className="text-sm text-amber">{error}</p>}
      <p className="text-[11px] text-muted">
        Pictures, adding a frog, and removing a frog happen right away. The prompt, labels, order,
        switch, and end time apply when you press Save.
      </p>
    </div>
  );
}

export default function SuggestionEventAdmin() {
  const [events, setEvents] = useState<AdminEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; mode: "edit" | "review" } | null>(null);

  const [newPrompt, setNewPrompt] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<AdminEvent[] | null> => {
    const res = await fetch("/api/admin/suggestion-events");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setLoadError(data.error ?? "Couldn't load events.");
      setEvents([]);
      return null;
    }
    const data = await res.json();
    setLoadError(null);
    setEvents(data.events);
    return data.events;
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    const res = await fetch("/api/admin/suggestion-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: newPrompt, description: newDescription }),
    });
    setCreating(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setCreateError(data.error ?? "Failed to create the event.");
      return;
    }
    const data = await res.json();
    setNewPrompt("");
    setNewDescription("");
    await load();
    setOpen({ id: data.eventId, mode: "edit" });
  }

  return (
    <section className="rounded-xl border border-moss bg-card p-5 shadow-sm">
      <h2 className="mb-1 font-heading text-lg font-semibold text-forest">Suggestion Events</h2>
      <p className="mb-4 text-sm text-muted">
        A temporary card above the poll where visitors send in name ideas for specific frogs.
        Nothing shows on the site unless an event is switched on.
      </p>

      <form onSubmit={create} className="mb-4 flex flex-col gap-2">
        <input
          value={newPrompt}
          onChange={(e) => setNewPrompt(e.target.value)}
          placeholder="New event prompt, e.g. What should we name our frogs?"
          maxLength={120}
          className={inputClass}
        />
        <input
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
          placeholder="Short description (optional)"
          maxLength={300}
          className={inputClass}
        />
        <div>
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-forest px-3 py-2 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50"
          >
            {creating ? "Creating…" : "+ Create event"}
          </button>
        </div>
        {createError && <p className="text-sm text-amber">{createError}</p>}
      </form>

      {loadError && (
        <p className="text-sm text-amber">
          {loadError} (If this says a table doesn&apos;t exist, run supabase/suggestion_events.sql
          in the Supabase SQL Editor first.)
        </p>
      )}
      {events === null && <p className="text-sm text-muted">Loading…</p>}
      {events?.length === 0 && !loadError && <p className="text-sm text-muted">No events yet.</p>}

      <div className="flex flex-col gap-4">
        {events?.map((ev) => {
          const status = statusOf(ev);
          const total = ev.frogs.reduce((sum, f) => sum + f.suggestionCount, 0);
          const isOpen = open?.id === ev.id;
          return (
            <div key={ev.id} className="flex flex-col gap-3 border-b border-moss pb-4 last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{ev.prompt}</p>
                  <p className="text-xs text-muted">
                    <span className={`font-semibold uppercase ${status.className}`}>
                      {status.text}
                    </span>
                    {" · "}
                    {ev.frogs.length} frog{ev.frogs.length === 1 ? "" : "s"}
                    {" · "}
                    {total} idea{total === 1 ? "" : "s"}
                    {ev.endsAt && (
                      <>
                        {" · ends "}
                        {new Date(ev.endsAt).toLocaleString("en-US", {
                          timeZone: "America/New_York",
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}{" "}
                        ET
                      </>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      setOpen(isOpen && open?.mode === "edit" ? null : { id: ev.id, mode: "edit" })
                    }
                    className="rounded-md border border-moss px-2 py-1 text-xs text-forest hover:bg-parchment"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() =>
                      setOpen(isOpen && open?.mode === "review" ? null : { id: ev.id, mode: "review" })
                    }
                    className="rounded-md border border-moss px-2 py-1 text-xs text-forest hover:bg-parchment"
                  >
                    Review ideas
                  </button>
                </div>
              </div>

              {isOpen && open?.mode === "edit" && (
                <EventEditor
                  key={`${ev.id}-edit`}
                  event={ev}
                  onSaved={() => {
                    load();
                  }}
                  onFrogsChanged={async () => {
                    const fresh = await load();
                    return fresh?.find((e) => e.id === ev.id) ?? null;
                  }}
                  onClose={() => setOpen(null)}
                />
              )}
              {isOpen && open?.mode === "review" && (
                <NameSuggestionsReview
                  key={`${ev.id}-review`}
                  eventId={ev.id}
                  onChanged={() => {
                    load();
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
