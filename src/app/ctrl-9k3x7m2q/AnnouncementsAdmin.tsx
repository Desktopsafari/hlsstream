"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import AnnouncementCard from "@/components/announcement/AnnouncementCard";
import {
  ANNOUNCEMENT_MAX_VISIBLE,
  announcementHref,
  type AnnouncementButtonKind,
  type PublicAnnouncement,
} from "@/lib/announcementLinks";
import { toEasternDateTimeInput } from "@/lib/pollSchedule";

const TITLE_MAX = 80;
const MESSAGE_MAX = 600;
const BUTTON_LABEL_MAX = 30;
const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

type StatusKind = "showing" | "waiting" | "scheduled" | "ended" | "off";

type AdminAnnouncement = {
  id: string;
  title: string;
  message: string;
  imageUrl: string | null;
  button: { label: string; kind: AnnouncementButtonKind; target: string } | null;
  isOn: boolean;
  startsAtLocal: string;
  endsAtLocal: string;
  createdAt: string;
  status: { kind: StatusKind; text: string };
};

const inputClass =
  "rounded-md border border-moss bg-parchment px-3 py-2 text-sm text-ink outline-none focus:border-forest";

const STATUS_CLASS: Record<StatusKind, string> = {
  showing: "text-forest font-semibold",
  waiting: "text-amber font-semibold",
  scheduled: "text-forest",
  ended: "text-muted",
  off: "text-muted",
};

const nowEastern = () => toEasternDateTimeInput(new Date());

function Counter({ value, max }: { value: string; max: number }) {
  return (
    <span className={`text-[11px] ${value.length > max ? "text-amber" : "text-muted"}`}>
      {value.length}/{max}
    </span>
  );
}

// Picture picker. On a saved announcement the file goes straight onto it
// (Replace/Remove delete the old file at once). On a new one it's a pending
// upload that the Save attaches; replacing or removing it deletes the
// pending file.
function PictureField({
  announcementId,
  url,
  pendingPath,
  onChange,
}: {
  announcementId: string | null;
  url: string | null;
  pendingPath: string | null;
  onChange: (next: { url: string | null; pendingPath: string | null }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File) {
    setError(null);
    if (!IMAGE_TYPES.includes(file.type)) {
      setError("Images must be JPG, PNG, or WebP.");
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      setError("That image is over 4MB. Please resize/compress it and try again.");
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    if (announcementId) form.append("id", announcementId);
    const res = await fetch("/api/admin/announcements/image", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(data.error ?? "Upload failed.");
      return;
    }
    if (!announcementId && pendingPath) {
      await fetch(`/api/admin/announcements/image?path=${encodeURIComponent(pendingPath)}`, { method: "DELETE" });
    }
    setBusy(false);
    onChange({ url: data.url ?? null, pendingPath: announcementId ? null : data.path });
  }

  async function remove() {
    setError(null);
    setBusy(true);
    const query = announcementId
      ? `id=${encodeURIComponent(announcementId)}`
      : pendingPath
        ? `path=${encodeURIComponent(pendingPath)}`
        : null;
    if (query) {
      const res = await fetch(`/api/admin/announcements/image?${query}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setBusy(false);
        setError(data.error ?? "Couldn't remove the picture.");
        return;
      }
    }
    setBusy(false);
    onChange({ url: null, pendingPath: null });
  }

  return (
    <div className="flex items-center gap-3">
      <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-md border border-moss bg-moss/40">
        {url ? (
          <Image src={url} alt="" fill sizes="112px" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-muted">No picture</div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <label
            className={`rounded-md border border-moss px-2 py-1 text-xs focus-within:ring-2 focus-within:ring-forest ${
              busy ? "cursor-not-allowed text-forest/50" : "cursor-pointer text-forest hover:bg-parchment"
            }`}
          >
            {busy ? "Working…" : url ? "Replace" : "Add picture"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="Picture for the announcement"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) pick(file);
              }}
            />
          </label>
          {url && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="rounded-md border border-moss px-2 py-1 text-xs text-muted hover:bg-parchment disabled:cursor-not-allowed disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
        <p className="text-[11px] text-muted">
          Optional. JPG, PNG, or WebP up to 4MB, shown as a 16:9 crop (about 1200 x 675 works best).
          {announcementId && " Changes to a saved announcement's picture apply straight away."}
        </p>
        {error && <p className="text-xs text-amber">{error}</p>}
      </div>
    </div>
  );
}

function Editor({
  existing,
  onDone,
}: {
  existing: AdminAnnouncement | null;
  onDone: (message: string | null) => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [message, setMessage] = useState(existing?.message ?? "");
  const [picture, setPicture] = useState<{ url: string | null; pendingPath: string | null }>({
    url: existing?.imageUrl ?? null,
    pendingPath: null,
  });
  const [hasButton, setHasButton] = useState(!!existing?.button);
  const [buttonLabel, setButtonLabel] = useState(existing?.button?.label ?? "");
  const [buttonKind, setButtonKind] = useState<AnnouncementButtonKind>(existing?.button?.kind ?? "poll");
  const [internalTarget, setInternalTarget] = useState(
    existing?.button?.kind === "internal" ? existing.button.target : "",
  );
  const [externalTarget, setExternalTarget] = useState(
    existing?.button?.kind === "external" ? existing.button.target : "",
  );
  const [startMode, setStartMode] = useState<"now" | "at">(existing?.startsAtLocal ? "at" : "now");
  const [startsAtLocal, setStartsAtLocal] = useState(existing?.startsAtLocal ?? "");
  const [endMode, setEndMode] = useState<"never" | "at">(existing?.endsAtLocal ? "at" : "never");
  const [endsAtLocal, setEndsAtLocal] = useState(existing?.endsAtLocal ?? "");
  const [isOn, setIsOn] = useState(existing?.isOn ?? false);
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = buttonKind === "internal" ? internalTarget : buttonKind === "external" ? externalTarget : "";
  const href = hasButton ? announcementHref(buttonKind, target) : null;

  const preview: PublicAnnouncement = {
    id: existing?.id ?? "preview",
    title: title.trim() || "Your title",
    message: message.trim(),
    imageUrl: picture.url,
    button: hasButton && href && buttonLabel.trim() ? { label: buttonLabel.trim(), ...href } : null,
    endsAt: null,
  };

  async function cancel() {
    // A picture picked for a new announcement that's never saved.
    if (!existing && picture.pendingPath) {
      await fetch(`/api/admin/announcements/image?path=${encodeURIComponent(picture.pendingPath)}`, {
        method: "DELETE",
      });
    }
    onDone(existing && picture.url !== existing.imageUrl ? "Picture updated." : null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/announcements", {
      method: existing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: existing?.id,
        title,
        message,
        isOn,
        startMode,
        startsAtLocal,
        endMode,
        endsAtLocal,
        button: hasButton ? { label: buttonLabel, kind: buttonKind, target } : null,
        pendingImagePath: existing ? undefined : picture.pendingPath,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to save.");
      return;
    }
    onDone(data.warning ?? (isOn ? "Saved and switched on." : "Saved (switched off)."));
  }

  const radio = "flex items-center gap-2 text-sm text-ink";

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-moss bg-parchment/50 p-4">
      <p className="text-sm font-semibold text-ink">{existing ? "Edit announcement" : "New announcement"}</p>

      <label className="flex flex-col gap-1">
        <span className="flex items-baseline justify-between text-sm font-medium text-ink">
          Title <Counter value={title} max={TITLE_MAX} />
        </span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TITLE_MAX} className={inputClass} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="flex items-baseline justify-between text-sm font-medium text-ink">
          Message <Counter value={message} max={MESSAGE_MAX} />
        </span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={MESSAGE_MAX}
          rows={4}
          className={inputClass}
        />
        <span className="text-[11px] text-muted">Plain text. Line breaks are kept; HTML shows as typed.</span>
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-ink">Picture</span>
        <PictureField
          announcementId={existing?.id ?? null}
          url={picture.url}
          pendingPath={picture.pendingPath}
          onChange={setPicture}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <label className={radio}>
          <input type="checkbox" checked={hasButton} onChange={(e) => setHasButton(e.target.checked)} />
          Add a button
        </label>
        {hasButton && (
          <div className="flex flex-col gap-2 pl-6">
            <label className="flex flex-col gap-1">
              <span className="flex items-baseline justify-between text-sm text-ink">
                Button label <Counter value={buttonLabel} max={BUTTON_LABEL_MAX} />
              </span>
              <input
                value={buttonLabel}
                onChange={(e) => setButtonLabel(e.target.value)}
                maxLength={BUTTON_LABEL_MAX}
                placeholder="e.g. Vote now"
                className={inputClass}
              />
            </label>
            <span className="text-sm text-ink">Goes to</span>
            <label className={radio}>
              <input type="radio" checked={buttonKind === "poll"} onChange={() => setButtonKind("poll")} />
              Scroll to the poll
            </label>
            <label className={radio}>
              <input type="radio" checked={buttonKind === "internal"} onChange={() => setButtonKind("internal")} />
              Internal page
            </label>
            {buttonKind === "internal" && (
              <input
                value={internalTarget}
                onChange={(e) => setInternalTarget(e.target.value)}
                placeholder="/contact"
                aria-label="Path on this site"
                className={`${inputClass} ml-6`}
              />
            )}
            <label className={radio}>
              <input type="radio" checked={buttonKind === "external"} onChange={() => setButtonKind("external")} />
              External link (opens in a new tab)
            </label>
            {buttonKind === "external" && (
              <input
                value={externalTarget}
                onChange={(e) => setExternalTarget(e.target.value)}
                placeholder="https://example.com/page"
                aria-label="External https address"
                className={`${inputClass} ml-6`}
              />
            )}
            {target && !href && (
              <p className="text-xs text-amber">
                {buttonKind === "internal"
                  ? "Use a path on this site that starts with / (for example /contact)."
                  : "Use a full https:// address. Other kinds of links aren't allowed."}
              </p>
            )}
          </div>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-ink">Starts (Eastern Time)</legend>
          <label className={radio}>
            <input type="radio" checked={startMode === "now"} onChange={() => setStartMode("now")} />
            Show now
          </label>
          <label className={radio}>
            <input
              type="radio"
              checked={startMode === "at"}
              onChange={() => {
                setStartMode("at");
                if (!startsAtLocal) setStartsAtLocal(nowEastern());
              }}
            />
            Show from
          </label>
          {startMode === "at" && (
            <input
              type="datetime-local"
              value={startsAtLocal}
              onChange={(e) => setStartsAtLocal(e.target.value)}
              aria-label="Start date and time, Eastern Time"
              className={inputClass}
            />
          )}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-ink">Ends (Eastern Time)</legend>
          <label className={radio}>
            <input type="radio" checked={endMode === "never"} onChange={() => setEndMode("never")} />
            Until I remove it
          </label>
          <label className={radio}>
            <input
              type="radio"
              checked={endMode === "at"}
              onChange={() => {
                setEndMode("at");
                if (!endsAtLocal) setEndsAtLocal(nowEastern());
              }}
            />
            Until
          </label>
          {endMode === "at" && (
            <input
              type="datetime-local"
              value={endsAtLocal}
              onChange={(e) => setEndsAtLocal(e.target.value)}
              aria-label="End date and time, Eastern Time"
              className={inputClass}
            />
          )}
        </fieldset>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input type="checkbox" checked={isOn} onChange={(e) => setIsOn(e.target.checked)} />
        On (shows on the site during its time window)
      </label>

      <div>
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          aria-expanded={showPreview}
          className="rounded-md border border-moss px-3 py-1.5 text-sm text-forest hover:bg-parchment"
        >
          {showPreview ? "Hide preview" : "Preview"}
        </button>
      </div>
      {showPreview && (
        <div className="rounded-lg border border-dashed border-moss bg-parchment p-3">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-muted">Preview (not live)</p>
          <AnnouncementCard announcement={preview} />
        </div>
      )}

      {error && <p className="text-sm text-amber">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-forest px-4 py-2 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="rounded-md border border-moss px-4 py-2 text-sm text-muted hover:bg-card"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function AnnouncementsAdmin() {
  const [items, setItems] = useState<AdminAnnouncement[]>([]);
  const [supported, setSupported] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/announcements", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    setLoaded(true);
    if (!res.ok) {
      setLoadError(data.error ?? "Couldn't load announcements.");
      return;
    }
    setLoadError(null);
    setSupported(data.supported !== false);
    setItems(data.announcements ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(item: AdminAnnouncement) {
    if (!window.confirm(`Delete "${item.title}"? This can't be undone.`)) return;
    const res = await fetch(`/api/admin/announcements?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setNotice(data.error ?? "Couldn't delete it.");
      return;
    }
    setNotice("Deleted.");
    if (editing?.id === item.id) setEditing(null);
    load();
  }

  const editingItem = editing?.id ? (items.find((i) => i.id === editing.id) ?? null) : null;

  return (
    <section className="rounded-xl border border-moss bg-card p-5 shadow-sm">
      <h2 className="mb-1 font-heading text-lg font-semibold text-forest">Announcements</h2>
      <p className="mb-4 text-xs text-muted">
        Cards shown above the suggestion event card. Several can be on at once, but at most{" "}
        {ANNOUNCEMENT_MAX_VISIBLE} show, newest (most recently created) first. Any more that are on
        wait, not shown, until one of the {ANNOUNCEMENT_MAX_VISIBLE} ends or is switched off; the
        list marks them &quot;waiting&quot;. Times are Eastern Time.
      </p>

      {!loaded && <p className="text-sm text-muted">Loading…</p>}
      {loadError && <p className="text-sm text-amber">{loadError}</p>}
      {loaded && !supported && (
        <p className="text-sm text-amber">
          Announcements need their database table first: run supabase/announcements.sql in the
          Supabase SQL Editor, then reload this page.
        </p>
      )}

      {loaded && supported && !loadError && (
        <div className="flex flex-col gap-4">
          {notice && <p className="text-sm text-forest">{notice}</p>}

          {editing ? (
            <Editor
              key={editing.id ?? "new"}
              existing={editingItem}
              onDone={(message) => {
                setEditing(null);
                setNotice(message);
                load();
              }}
            />
          ) : (
            <div>
              <button
                type="button"
                onClick={() => {
                  setNotice(null);
                  setEditing({ id: null });
                }}
                className="rounded-md border border-forest px-3 py-1.5 text-sm font-semibold text-forest hover:bg-parchment"
              >
                + New announcement
              </button>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {items.length === 0 && <p className="text-sm text-muted">No announcements yet.</p>}
            {items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 border-b border-moss pb-2 last:border-0">
                <div className="flex min-w-0 items-start gap-2">
                  {item.imageUrl && (
                    <span className="relative mt-0.5 aspect-video w-12 shrink-0 overflow-hidden rounded border border-moss">
                      <Image src={item.imageUrl} alt="" fill sizes="48px" className="object-cover" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{item.title}</p>
                    <p className={`text-xs ${STATUS_CLASS[item.status.kind]}`}>{item.status.text}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setNotice(null);
                      setEditing({ id: item.id });
                    }}
                    disabled={!!editing}
                    className="rounded-md border border-moss px-2 py-1 text-xs text-forest hover:bg-parchment disabled:opacity-40"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(item)}
                    className="rounded-md border border-moss px-2 py-1 text-xs text-muted hover:bg-parchment"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
