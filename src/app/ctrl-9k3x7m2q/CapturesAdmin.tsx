"use client";

import { useCallback, useEffect, useState } from "react";
import CollapsibleSection from "./CollapsibleSection";
import ClickToPlay from "@/components/capture/ClickToPlay";
import { ADMIN_CLIP_SECONDS, FALLBACK_DELAY_SECONDS, formatBytes } from "@/lib/captureShared";

type Capture = {
  id: string;
  kind: "photo" | "clip";
  createdBy: "admin" | "visitor";
  seconds: number;
  bytes: number;
  status: "pending" | "ready";
  createdAt: string;
  expiresAt: string | null;
  featured: boolean;
  kept: boolean;
  externalUrl: string | null;
  url: string | null;
  downloadUrl: string | null;
  thumbUrl: string | null;
};
type ServerStatus = {
  streams?: Record<string, { live: boolean; heldSeconds: number }>;
  disk?: { freeBytes: number; totalBytes: number; minFreeBytes: number };
  filesBytes?: number;
};
type Overview =
  | { supported: false; hint: string }
  | {
      supported: true;
      paused: boolean;
      captures: Capture[];
      usage: {
        totalBytes: number;
        visitorBytes: number;
        visitorBudgetBytes: number;
        keptBytes: number;
        keptWarningBytes: number;
        keptWarning: boolean;
        listCapped: boolean;
      };
      server: ServerStatus | null;
    };
type Ready = Extract<Overview, { supported: true }>;

const input =
  "w-full min-w-0 rounded-md border border-moss bg-parchment px-3 py-2 text-sm text-ink outline-none focus:border-forest";
const primary =
  "rounded-md bg-forest px-3 py-1.5 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50";
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

function expiryLabel(c: Capture): string {
  if (c.featured && !c.externalUrl) return "Featured (kept for good)";
  if (c.kept) return "Kept for good";
  if (c.featured && c.externalUrl && !c.url) return "Featured via link (VPS file removed)";
  if (!c.expiresAt) return "No expiry";
  return `${c.featured ? "Featured via link; VPS file " : ""}Expires ${formatEastern(c.expiresAt)} ET`;
}

// The Captures tab: capture now, usage and disk, the visitor pause switch,
// and the list with Feature / Keep / Download / Delete.
export default function CapturesAdmin() {
  const [data, setData] = useState<Overview | null>(null);

  const load = useCallback(async () => {
    const res = await call("GET", "/api/admin/captures");
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
      <CollapsibleSection title="Capture">
        <section className="rounded-xl border border-moss bg-card p-5 shadow-sm">
          <h2 className="mb-3 font-heading text-lg font-semibold text-forest">Capture</h2>
          {notice}
          {ready && <CaptureNow data={ready} reload={load} />}
        </section>
      </CollapsibleSection>
      <CollapsibleSection title="Captures">
        <section className="rounded-xl border border-moss bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-heading text-lg font-semibold text-forest">Captures</h2>
            <button type="button" onClick={load} className={small}>
              Refresh
            </button>
          </div>
          {notice}
          {ready && <CaptureList data={ready} reload={load} />}
        </section>
      </CollapsibleSection>
    </>
  );
}

function CaptureNow({ data, reload }: { data: Ready; reload: () => void }) {
  const [seconds, setSeconds] = useState(30);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { usage, server } = data;

  async function capture(kind: "photo" | "clip") {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await call("POST", "/api/admin/captures", { kind, seconds: kind === "clip" ? seconds : undefined });
    setBusy(false);
    if (!res.ok) return setError(res.data.error ?? "Failed.");
    setMessage(kind === "clip" ? `Saved a ${res.data.capture.seconds}-second clip. It's at the top of the list below.` : "Photo saved. It's at the top of the list below.");
    reload();
  }

  async function setPaused(paused: boolean) {
    setBusy(true);
    const res = await call("POST", "/api/admin/captures/pause", { paused });
    setBusy(false);
    if (!res.ok) return setError(res.data.error ?? "Failed.");
    reload();
  }

  const main = server?.streams?.main;
  const budgetPct = Math.min(100, Math.round((usage.visitorBytes / usage.visitorBudgetBytes) * 100));

  return (
    <div className="flex flex-col gap-4">
      <div
        className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
          data.paused ? "border-amber text-amber" : "border-moss text-ink"
        }`}
      >
        <span>{data.paused ? "⏸ Visitor clips and server photos are paused." : "Visitor captures are on."}</span>
        <button type="button" onClick={() => setPaused(!data.paused)} disabled={busy} className={small}>
          {data.paused ? "Resume visitor captures" : "Pause visitor captures"}
        </button>
      </div>
      <p className="text-xs text-muted">
        Visitor photos are taken in their own browser and never reach the server, so pausing doesn&apos;t stop those.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          <span>Clip length</span>
          <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className={input}>
            {ADMIN_CLIP_SECONDS.map((s) => (
              <option key={s} value={s}>
                Last {s} seconds
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => capture("clip")} disabled={busy} className={primary}>
          {busy ? "Working…" : "Save clip"}
        </button>
        <button type="button" onClick={() => capture("photo")} disabled={busy} className={primary}>
          Take photo
        </button>
      </div>
      <p className="text-xs text-muted">
        Captures from here line up with what viewers see (about {FALLBACK_DELAY_SECONDS} s behind live), have no limits,
        and are kept 48 hours unless you Feature or Keep them.
      </p>
      {message && <p className="text-sm text-forest">{message}</p>}
      {error && <p className="text-sm text-amber">{error}</p>}

      <div className="grid gap-2 text-sm text-ink sm:grid-cols-2">
        <div className="rounded-md border border-moss px-3 py-2">
          <div className="text-xs text-muted">Visitor captures (storage budget)</div>
          <div>
            {formatBytes(usage.visitorBytes)} of {formatBytes(usage.visitorBudgetBytes)} ({budgetPct}%)
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-moss/40">
            <div className={`h-full ${budgetPct >= 90 ? "bg-amber" : "bg-forest"}`} style={{ width: `${budgetPct}%` }} />
          </div>
        </div>
        <div className={`rounded-md border px-3 py-2 ${usage.keptWarning ? "border-amber" : "border-moss"}`}>
          <div className="text-xs text-muted">Featured + Kept</div>
          <div className={usage.keptWarning ? "text-amber" : ""}>
            {formatBytes(usage.keptBytes)}
            {usage.keptWarning && ` — over ${formatBytes(usage.keptWarningBytes)}; consider deleting or linking some`}
          </div>
        </div>
        <div className="rounded-md border border-moss px-3 py-2">
          <div className="text-xs text-muted">All captures</div>
          <div>{formatBytes(usage.totalBytes)}</div>
        </div>
        <div className="rounded-md border border-moss px-3 py-2">
          <div className="text-xs text-muted">Capture server</div>
          {server?.disk ? (
            <div>
              {formatBytes(server.disk.freeBytes)} free of {formatBytes(server.disk.totalBytes)}
              {server.disk.freeBytes < server.disk.minFreeBytes && <span className="text-amber"> — refusing new captures</span>}
              <div className="text-xs text-muted">
                {main ? (main.live ? `Live, ${main.heldSeconds} s in the rewind buffer` : "Stream offline (buffer empty)") : "No buffer info"}
              </div>
            </div>
          ) : (
            <div className="text-amber">Not responding</div>
          )}
        </div>
      </div>
    </div>
  );
}

function CaptureList({ data, reload }: { data: Ready; reload: () => void }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [featuring, setFeaturing] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "featured" | "visitor" | "admin">("all");

  async function act(id: string, method: "PATCH" | "DELETE", body: Record<string, unknown>) {
    setBusy(id);
    setError(null);
    const res = await call(method, "/api/admin/captures", { id, ...body });
    setBusy(null);
    if (!res.ok) return setError(res.data.error ?? "Failed.");
    setFeaturing(null);
    setLink("");
    reload();
  }

  const shown = data.captures.filter((c) =>
    filter === "all" ? true : filter === "featured" ? c.featured || c.kept : c.createdBy === filter,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 text-xs">
        {(["all", "featured", "visitor", "admin"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`${small} ${filter === f ? "bg-forest text-parchment hover:bg-forest" : ""}`}
          >
            {f === "all" ? "All" : f === "featured" ? "Featured & kept" : f === "visitor" ? "Visitors" : "Mine"}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-amber">{error}</p>}
      {shown.length === 0 && <p className="text-sm text-muted">No captures.</p>}
      <ul className="grid gap-4 sm:grid-cols-2">
        {shown.map((c) => (
          <li key={c.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-moss p-3">
            {c.status !== "ready" ? (
              <div className="flex aspect-video items-center justify-center rounded-lg bg-forest-dark text-xs text-parchment">
                Being made…
              </div>
            ) : c.kind === "clip" && c.url ? (
              <ClickToPlay
                active={playing === c.id}
                onActivate={() => setPlaying(c.id)}
                thumbUrl={c.thumbUrl}
                videoUrl={c.url}
                label={`Play ${c.seconds}-second clip`}
              />
            ) : (
              c.thumbUrl && <img src={c.thumbUrl} alt="" loading="lazy" className="aspect-video w-full rounded-lg bg-forest-dark object-cover" />
            )}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <span className="font-semibold text-ink">{c.kind === "clip" ? `Clip · ${c.seconds} s` : "Photo"}</span>
              <span>· {c.createdBy === "visitor" ? "Visitor" : "You"}</span>
              <span>· {formatBytes(c.bytes)}</span>
              <span>· {formatEastern(c.createdAt)} ET</span>
              {c.featured && <span className="rounded bg-forest px-1.5 text-parchment">Featured</span>}
              {c.kept && <span className="rounded border border-forest px-1.5 text-forest">Kept</span>}
            </div>
            <div className="text-xs text-muted">{expiryLabel(c)}</div>
            {c.externalUrl && (
              <a href={c.externalUrl} target="_blank" rel="noopener noreferrer" className="truncate text-xs text-forest underline">
                {c.externalUrl}
              </a>
            )}

            {featuring === c.id ? (
              <div className="flex flex-col gap-2 rounded-md border border-moss p-2">
                <label className="flex flex-col gap-1 text-xs text-muted">
                  <span>Optional: a YouTube, TikTok or Instagram link to show instead of the VPS file</span>
                  <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" className={input} />
                </label>
                <p className="text-[11px] text-muted">
                  Without a link the file is kept on the VPS for good. With one, the gallery embeds the link and the VPS file
                  expires as it would have.
                </p>
                <div className="flex gap-2">
                  <button type="button" disabled={busy === c.id} onClick={() => act(c.id, "PATCH", { action: "feature", externalUrl: link })} className={small}>
                    Feature
                  </button>
                  <button type="button" onClick={() => setFeaturing(null)} className={small}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              c.status === "ready" && (
                <div className="flex flex-wrap gap-2">
                  {c.featured ? (
                    <button type="button" disabled={busy === c.id} onClick={() => act(c.id, "PATCH", { action: "unfeature" })} className={small}>
                      Unfeature
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy === c.id}
                      onClick={() => {
                        setFeaturing(c.id);
                        setLink("");
                      }}
                      className={small}
                    >
                      Feature…
                    </button>
                  )}
                  {(c.url || c.kept) && (
                    <button type="button" disabled={busy === c.id} onClick={() => act(c.id, "PATCH", { action: c.kept ? "unkeep" : "keep" })} className={small}>
                      {c.kept ? "Unkeep" : "Keep"}
                    </button>
                  )}
                  {c.downloadUrl && (
                    <a href={c.downloadUrl} className={small}>
                      Download
                    </a>
                  )}
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => {
                      if (window.confirm("Delete this capture for good? Its files are removed from the VPS.")) act(c.id, "DELETE", {});
                    }}
                    className={`${small} text-amber`}
                  >
                    Delete
                  </button>
                </div>
              )
            )}
          </li>
        ))}
      </ul>
      {data.usage.listCapped && <p className="text-xs text-muted">Showing the newest 200.</p>}
    </div>
  );
}
