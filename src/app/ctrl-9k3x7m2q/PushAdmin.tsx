"use client";

import { useCallback, useEffect, useState } from "react";
import CollapsibleSection from "./CollapsibleSection";
import { ALL_DAYS, PUSH_MESSAGE_MAX, PUSH_TITLE_MAX, WEEKDAY_LABELS } from "@/lib/pushShared";

type Category = { id: string; name: string; subscribers: number };
type Repeating = {
  id: string;
  title: string;
  message: string;
  url: string;
  categoryId: string;
  categoryName: string;
  timeOfDay: string;
  daysOfWeek: number[];
  isActive: boolean;
  skippedToday: boolean;
  status: string;
};
type Scheduled = { id: string; title: string; categoryName: string; when: string };
type LogRow = {
  id: string;
  title: string;
  category_name: string | null;
  source: string;
  status: string;
  recipients: number;
  sent: number;
  failed: number;
  created_at: string;
};
type Overview =
  | { supported: false; hint: string }
  | {
      supported: true;
      hint: string | null;
      paused: boolean;
      categories: Category[];
      repeating: Repeating[];
      scheduled: Scheduled[];
      log: LogRow[];
    };

type Note = { title: string; message: string; url: string; categoryId: string };
const EMPTY_NOTE: Note = { title: "", message: "", url: "", categoryId: "" };

const input =
  "w-full min-w-0 rounded-md border border-moss bg-parchment px-3 py-2 text-sm text-ink outline-none focus:border-forest";
const primary =
  "rounded-md bg-forest px-3 py-1.5 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50";
const secondary = "rounded-md border border-moss px-3 py-1.5 text-sm text-forest hover:bg-parchment disabled:opacity-50";
const small = "rounded-md border border-moss px-2 py-1 text-xs text-forest hover:bg-parchment disabled:opacity-50";

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function formatEastern(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
}

const SOURCE_LABELS: Record<string, string> = { now: "Send now", test: "Test", scheduled: "Scheduled", repeating: "Repeating" };

// Title, message, link and category: the same fields in Compose and Repeating.
function NoteFields({ note, onChange, categories }: { note: Note; onChange: (n: Note) => void; categories: Category[] }) {
  return (
    <>
      <label className="flex flex-col gap-1 text-xs text-muted">
        <span>
          Title ({note.title.length}/{PUSH_TITLE_MAX})
        </span>
        <input
          value={note.title}
          maxLength={PUSH_TITLE_MAX}
          onChange={(e) => onChange({ ...note, title: e.target.value })}
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        <span>
          Message ({note.message.length}/{PUSH_MESSAGE_MAX})
        </span>
        <textarea
          value={note.message}
          maxLength={PUSH_MESSAGE_MAX}
          rows={2}
          onChange={(e) => onChange({ ...note, message: e.target.value })}
          className={input}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
          <span>Link (optional, a page on this site)</span>
          <input
            value={note.url}
            placeholder="/ (home page)"
            onChange={(e) => onChange({ ...note, url: e.target.value })}
            className={input}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
          <span>Category</span>
          <select
            value={note.categoryId}
            onChange={(e) => onChange({ ...note, categoryId: e.target.value })}
            className={input}
          >
            <option value="">Pick a category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.subscribers} subscriber{c.subscribers === 1 ? "" : "s"})
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}

// The Push tab: compose (now / at a time / test), repeating notifications,
// the log, and the pause switch. All of it reads one admin route.
export default function PushAdmin() {
  const [data, setData] = useState<Overview | null>(null);

  const load = useCallback(async () => {
    const res = await call("GET", "/api/admin/push");
    setData(res.ok ? (res.data as Overview) : { supported: false, hint: res.data.error ?? "Couldn't load." });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const ready = data?.supported ? data : null;
  const notice = !data ? (
    <p className="text-sm text-muted">Loading…</p>
  ) : !data.supported ? (
    <p className="text-sm text-amber">{data.hint}</p>
  ) : null;

  return (
    <>
      <CollapsibleSection title="Push Notifications">
        <section className="rounded-xl border border-moss bg-card p-5 shadow-sm">
          <h2 className="mb-3 font-heading text-lg font-semibold text-forest">Push Notifications</h2>
          {notice}
          {ready && <Compose data={ready} reload={load} />}
        </section>
      </CollapsibleSection>
      <CollapsibleSection title="Repeating Notifications">
        <section className="rounded-xl border border-moss bg-card p-5 shadow-sm">
          <h2 className="mb-3 font-heading text-lg font-semibold text-forest">Repeating Notifications</h2>
          {notice}
          {ready && <RepeatingAdmin data={ready} reload={load} />}
        </section>
      </CollapsibleSection>
      <CollapsibleSection title="Push Log">
        <section className="rounded-xl border border-moss bg-card p-5 shadow-sm">
          <h2 className="mb-3 font-heading text-lg font-semibold text-forest">Push Log</h2>
          {notice}
          {ready && <PushLog data={ready} reload={load} />}
        </section>
      </CollapsibleSection>
    </>
  );
}

type Ready = Extract<Overview, { supported: true }>;

function Compose({ data, reload }: { data: Ready; reload: () => void }) {
  const [note, setNote] = useState<Note>(EMPTY_NOTE);
  const [mode, setMode] = useState<"now" | "at">("now");
  const [sendAtLocal, setSendAtLocal] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const category = data.categories.find((c) => c.id === note.categoryId);

  async function submit(sendMode: "now" | "at" | "test") {
    setError(null);
    setMessage(null);
    setConfirming(false);
    setBusy(true);
    let endpoint: string | undefined;
    if (sendMode === "test") {
      const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/") : undefined;
      endpoint = (await reg?.pushManager.getSubscription().catch(() => null))?.endpoint;
      if (!endpoint) {
        setBusy(false);
        return setError("This browser isn't subscribed. Turn on notifications with Notify me on the home page first.");
      }
    }
    const res = await call("POST", "/api/admin/push/send", { ...note, mode: sendMode, sendAtLocal, endpoint });
    setBusy(false);
    if (!res.ok) return setError(res.data.error ?? "Failed.");
    if (sendMode === "at") setMessage("Scheduled. It's listed in the Push Log below.");
    else setMessage(`Sent to ${res.data.sent} of ${res.data.recipients}${res.data.failed ? ` (${res.data.failed} failed)` : ""}.`);
    if (sendMode !== "test") {
      setNote(EMPTY_NOTE);
      setSendAtLocal("");
    }
    reload();
  }

  async function setPaused(paused: boolean) {
    setBusy(true);
    const res = await call("POST", "/api/admin/push/pause", { paused });
    setBusy(false);
    if (!res.ok) return setError(res.data.error ?? "Failed.");
    reload();
  }

  function startSend() {
    setError(null);
    setMessage(null);
    if (!note.title.trim() || !note.message.trim()) return setError("A title and a message are required.");
    if (!category) return setError("Pick a category.");
    if (mode === "at") return submit("at");
    setConfirming(true);
  }

  return (
    <div className="flex flex-col gap-3">
      {data.hint && <p className="text-sm text-amber">{data.hint}</p>}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
          data.paused ? "border-amber text-amber" : "border-moss text-ink"
        }`}
      >
        <span>{data.paused ? "⏸ All push sending is paused." : "Push sending is on."}</span>
        <button type="button" onClick={() => setPaused(!data.paused)} disabled={busy} className={small}>
          {data.paused ? "Resume sending" : "Pause all push sending"}
        </button>
      </div>

      <NoteFields note={note} onChange={setNote} categories={data.categories} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink">
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === "now"} onChange={() => setMode("now")} /> Send now
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === "at"} onChange={() => setMode("at")} /> Send at
        </label>
        {mode === "at" && (
          <label className="flex min-w-0 items-center gap-2 text-xs text-muted">
            <input
              type="datetime-local"
              value={sendAtLocal}
              onChange={(e) => setSendAtLocal(e.target.value)}
              className={`${input} w-auto`}
            />
            ET
          </label>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={startSend} disabled={busy || confirming} className={primary}>
          {mode === "now" ? "Send now…" : "Schedule"}
        </button>
        <button type="button" onClick={() => submit("test")} disabled={busy} className={secondary}>
          Send test to this device only
        </button>
      </div>

      {confirming && category && (
        <div className="flex flex-col gap-2 rounded-md border border-amber bg-parchment p-3 text-sm text-ink">
          <p>
            Send &ldquo;{note.title.trim()}&rdquo; now to{" "}
            <strong>
              {category.subscribers} subscriber{category.subscribers === 1 ? "" : "s"}
            </strong>{" "}
            of {category.name}?
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => submit("now")} disabled={busy} className={primary}>
              Yes, send
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={secondary}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {message && <p className="text-sm text-forest">{message}</p>}
      {error && <p className="text-sm text-amber">{error}</p>}
      <p className="text-[11px] text-muted">
        Notifications that can&rsquo;t be delivered within 2 hours (a phone that&rsquo;s off) are dropped, so nobody gets a
        stale one. A scheduled or repeating send that&rsquo;s more than 30 minutes late is marked missed, not sent.
      </p>
    </div>
  );
}

type RepeatingForm = Note & { timeOfDay: string; daysOfWeek: number[]; isActive: boolean };
const EMPTY_REPEATING: RepeatingForm = { ...EMPTY_NOTE, timeOfDay: "18:00", daysOfWeek: ALL_DAYS, isActive: true };

function RepeatingAdmin({ data, reload }: { data: Ready; reload: () => void }) {
  const [form, setForm] = useState<RepeatingForm>(EMPTY_REPEATING);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await call(editingId ? "PUT" : "POST", "/api/admin/push/repeating", { ...form, id: editingId ?? undefined });
    setBusy(false);
    if (!res.ok) return setError(res.data.error ?? "Failed.");
    setForm(EMPTY_REPEATING);
    setEditingId(null);
    reload();
  }

  async function act(body: Record<string, unknown>) {
    setError(null);
    setBusy(true);
    const res = await call("PATCH", "/api/admin/push/repeating", body);
    setBusy(false);
    if (!res.ok) setError(res.data.error ?? "Failed.");
    reload();
  }

  async function remove(r: Repeating) {
    if (!window.confirm(`Delete the repeating notification “${r.title}”?`)) return;
    setBusy(true);
    const res = await call("DELETE", `/api/admin/push/repeating?id=${encodeURIComponent(r.id)}`);
    setBusy(false);
    if (!res.ok) setError(res.data.error ?? "Failed.");
    if (editingId === r.id) {
      setEditingId(null);
      setForm(EMPTY_REPEATING);
    }
    reload();
  }

  function edit(r: Repeating) {
    setEditingId(r.id);
    setForm({
      title: r.title,
      message: r.message,
      url: r.url === "/" ? "" : r.url,
      categoryId: r.categoryId,
      timeOfDay: r.timeOfDay,
      daysOfWeek: r.daysOfWeek,
      isActive: r.isActive,
    });
  }

  function toggleDay(d: number) {
    const days = form.daysOfWeek.includes(d) ? form.daysOfWeek.filter((x) => x !== d) : [...form.daysOfWeek, d].sort();
    setForm({ ...form, daysOfWeek: days });
  }

  return (
    <div className="flex flex-col gap-4">
      {data.repeating.length === 0 && <p className="text-sm text-muted">No repeating notifications yet.</p>}
      {data.repeating.map((r) => (
        <div key={r.id} className="flex flex-col gap-1 border-b border-moss pb-3 last:border-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <p className="text-sm font-semibold text-ink">{r.title}</p>
              <p className="text-xs text-muted">{r.message}</p>
              <p className="text-xs text-muted">
                {r.categoryName} · {r.timeOfDay} ET ·{" "}
                {r.daysOfWeek.length === 7 ? "every day" : r.daysOfWeek.map((d) => WEEKDAY_LABELS[d]).join(", ")}
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              <label className="flex items-center gap-1 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={r.isActive}
                  disabled={busy}
                  onChange={(e) => act({ id: r.id, action: "active", isActive: e.target.checked })}
                />
                Active
              </label>
              {r.isActive && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act({ id: r.id, action: r.skippedToday ? "unskip" : "skip" })}
                  className={small}
                >
                  {r.skippedToday ? "Undo skip" : "Skip today"}
                </button>
              )}
              <button type="button" onClick={() => edit(r)} disabled={busy} className={small}>
                Edit
              </button>
              <button type="button" onClick={() => remove(r)} disabled={busy} className={small}>
                Delete
              </button>
            </div>
          </div>
          <p className={`text-xs font-semibold ${r.isActive ? "text-forest" : "text-muted"}`}>{r.status}</p>
        </div>
      ))}

      <form onSubmit={save} className="flex flex-col gap-3 rounded-md border border-moss p-3">
        <p className="text-sm font-semibold text-forest">{editingId ? "Edit repeating notification" : "New repeating notification"}</p>
        <NoteFields note={form} onChange={(n) => setForm({ ...form, ...n })} categories={data.categories} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-xs text-muted">
            Time
            <input
              type="time"
              value={form.timeOfDay}
              onChange={(e) => setForm({ ...form, timeOfDay: e.target.value })}
              className={`${input} w-auto`}
            />
            ET
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Active
          </label>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {WEEKDAY_LABELS.map((label, d) => (
            <label key={label} className="flex items-center gap-1 text-sm text-ink">
              <input type="checkbox" checked={form.daysOfWeek.includes(d)} onChange={() => toggleDay(d)} />
              {label}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className={primary}>
            {editingId ? "Save changes" : "Add repeating notification"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(EMPTY_REPEATING);
              }}
              className={secondary}
            >
              Cancel
            </button>
          )}
        </div>
        {error && <p className="text-sm text-amber">{error}</p>}
        <p className="text-[11px] text-muted">
          Sends at most once a day. Skip today only skips today&rsquo;s send; it resumes on the next chosen day.
        </p>
      </form>
    </div>
  );
}

function PushLog({ data, reload }: { data: Ready; reload: () => void }) {
  const [error, setError] = useState<string | null>(null);

  async function cancel(id: string) {
    setError(null);
    const res = await call("DELETE", `/api/admin/push/scheduled?id=${encodeURIComponent(id)}`);
    if (!res.ok) setError(res.data.error ?? "Failed.");
    reload();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button type="button" onClick={reload} className={small}>
          Refresh
        </button>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-forest">Scheduled</h3>
        {data.scheduled.length === 0 && <p className="text-sm text-muted">Nothing scheduled.</p>}
        {data.scheduled.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-2 border-b border-moss py-2 text-sm last:border-0">
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-semibold text-ink">{s.title}</span>{" "}
              <span className="text-muted">
                · {s.categoryName} · {s.when}
              </span>
            </span>
            <button type="button" onClick={() => cancel(s.id)} className={small}>
              Cancel
            </button>
          </div>
        ))}
        {error && <p className="text-sm text-amber">{error}</p>}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-forest">Last 50 sends</h3>
        {data.log.length === 0 && <p className="text-sm text-muted">Nothing sent yet.</p>}
        {data.log.map((l) => (
          <div key={l.id} className="border-b border-moss py-2 text-sm last:border-0">
            <p className="font-semibold text-ink [overflow-wrap:anywhere]">{l.title}</p>
            <p className="text-xs text-muted">
              {formatEastern(l.created_at)} ET · {l.category_name ?? "this device"} · {SOURCE_LABELS[l.source] ?? l.source} ·{" "}
              {l.status === "missed" ? (
                <span className="text-amber">missed (window passed or paused), not sent</span>
              ) : (
                `${l.recipients} recipients, ${l.sent} sent, ${l.failed} failed`
              )}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
