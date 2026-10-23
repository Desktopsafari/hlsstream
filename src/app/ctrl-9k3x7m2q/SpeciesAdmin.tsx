"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  CONSERVATION_STATUSES,
  RESIDENT_LABEL_MAX,
  RESIDENT_NAME_MAX,
  RESIDENTS_MAX,
  type InfoBlock,
  type Resident,
  type SpeciesCardData,
} from "@/lib/species";

type ImageKind = "photo" | "range";

function ImageField({
  label,
  kind,
  url,
  onChanged,
}: {
  label: string;
  kind: ImageKind;
  url: string | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file);
    const res = await fetch("/api/admin/species/image", { method: "POST", body: form });
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
    await fetch(`/api/admin/species/image?kind=${kind}`, { method: "DELETE" });
    setBusy(false);
    onChanged();
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-ink">{label}</p>
      <div className="relative aspect-[4/3] overflow-hidden rounded-md border border-moss bg-moss/40">
        {url ? (
          <Image src={url} alt={label} fill sizes="240px" className="object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted">
            No image
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <label className="cursor-pointer rounded-md border border-moss px-3 py-1.5 text-sm text-forest hover:bg-parchment">
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
            className="rounded-md border border-moss px-3 py-1.5 text-sm text-muted hover:bg-parchment"
          >
            Remove
          </button>
        )}
      </div>
      {error && <p className="text-xs text-amber">{error}</p>}
      <p className="text-[11px] text-muted">JPG, PNG, or WebP, up to 4MB.</p>
    </div>
  );
}

export default function SpeciesAdmin() {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [speciesName, setSpeciesName] = useState("");
  const [scientificName, setScientificName] = useState("");
  const [status, setStatus] = useState("");
  const [blocks, setBlocks] = useState<InfoBlock[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [residentsSupported, setResidentsSupported] = useState(true);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [rangeUrl, setRangeUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(includeText: boolean) {
    const res = await fetch("/api/admin/species");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setLoadError(data.error ?? "Couldn't load the species card.");
      setLoaded(true);
      return;
    }
    const { card, residentsSupported: supported }: { card: SpeciesCardData | null; residentsSupported?: boolean } =
      await res.json();
    setResidentsSupported(supported !== false);
    setPhotoUrl(card?.photoUrl ?? null);
    setRangeUrl(card?.rangeMapUrl ?? null);
    if (includeText) {
      setSpeciesName(card?.speciesName ?? "");
      setScientificName(card?.scientificName ?? "");
      setStatus(card?.conservationStatus ?? "");
      setBlocks(card?.infoBlocks ?? []);
      setResidents(card?.residents ?? []);
    }
    setLoaded(true);
  }

  useEffect(() => {
    load(true);
  }, []);

  function moveBlock(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    setBlocks(next);
  }

  function moveResident(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= residents.length) return;
    const next = [...residents];
    [next[index], next[target]] = [next[target], next[index]];
    setResidents(next);
  }

  function editResident(index: number, change: Partial<Resident>) {
    const next = [...residents];
    next[index] = { ...next[index], ...change };
    setResidents(next);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);

    const res = await fetch("/api/admin/species", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        speciesName,
        scientificName,
        conservationStatus: status || null,
        infoBlocks: blocks,
        ...(residentsSupported ? { residents } : {}),
      }),
    });

    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to save.");
      return;
    }
    setMessage("Saved. The card on the site is updated.");
  }

  const inputClass =
    "rounded-md border border-moss bg-parchment px-3 py-2 text-sm text-ink outline-none focus:border-forest";

  return (
    <section className="rounded-xl border border-moss bg-card p-5 shadow-sm">
      <h2 className="mb-3 font-heading text-lg font-semibold text-forest">Meet the Resident</h2>

      {!loaded && <p className="text-sm text-muted">Loading…</p>}
      {loadError && (
        <p className="text-sm text-amber">
          {loadError} (If this says a table doesn&apos;t exist, run supabase/species.sql in the
          Supabase SQL Editor first.)
        </p>
      )}

      {loaded && !loadError && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={speciesName}
              onChange={(e) => setSpeciesName(e.target.value)}
              placeholder="Species name (required)"
              maxLength={80}
              className={inputClass}
            />
            <input
              value={scientificName}
              onChange={(e) => setScientificName(e.target.value)}
              placeholder="Scientific name (optional)"
              maxLength={100}
              className={inputClass}
            />
          </div>

          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
            <option value="">Conservation status: none</option>
            {CONSERVATION_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          <div className="grid gap-4 sm:grid-cols-2">
            <ImageField label="Species photo" kind="photo" url={photoUrl} onChanged={() => load(false)} />
            <ImageField label="Range map" kind="range" url={rangeUrl} onChanged={() => load(false)} />
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-ink">Info blocks</p>
            {blocks.length === 0 && (
              <p className="text-sm text-muted">No blocks yet (e.g. LOCATION, DIET).</p>
            )}
            {blocks.map((block, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-md border border-moss p-3">
                <div className="flex gap-2">
                  <input
                    value={block.title}
                    onChange={(e) => {
                      const next = [...blocks];
                      next[i] = { ...next[i], title: e.target.value };
                      setBlocks(next);
                    }}
                    placeholder="Title (e.g. DIET)"
                    maxLength={40}
                    className={`${inputClass} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={() => moveBlock(i, -1)}
                    disabled={i === 0}
                    aria-label="Move up"
                    className="rounded-md border border-moss px-2 text-muted hover:bg-parchment disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveBlock(i, 1)}
                    disabled={i === blocks.length - 1}
                    aria-label="Move down"
                    className="rounded-md border border-moss px-2 text-muted hover:bg-parchment disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => setBlocks(blocks.filter((_, idx) => idx !== i))}
                    aria-label="Remove block"
                    className="rounded-md border border-moss px-2 text-muted hover:bg-parchment"
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  value={block.body}
                  onChange={(e) => {
                    const next = [...blocks];
                    next[i] = { ...next[i], body: e.target.value };
                    setBlocks(next);
                  }}
                  placeholder="Text"
                  maxLength={500}
                  rows={2}
                  className={inputClass}
                />
              </div>
            ))}
            <div>
              <button
                type="button"
                onClick={() => setBlocks([...blocks, { title: "", body: "" }])}
                disabled={blocks.length >= 12}
                className="rounded-md border border-moss px-3 py-1.5 text-sm text-forest hover:bg-parchment disabled:opacity-40"
              >
                + Add block
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-medium text-ink">Residents</p>
              <p className="text-[11px] text-muted">
                Optional. Who lives here: frogs, fish, plants, anything. Shown on the card as
                &quot;Label: Name&quot;, or &quot;Name coming soon!&quot; while the name is blank.
              </p>
            </div>
            {!residentsSupported ? (
              <p className="text-sm text-amber">
                The residents list needs its database column first: run
                supabase/species_residents.sql in the Supabase SQL Editor, then reload this page.
              </p>
            ) : (
              <>
                {residents.length === 0 && (
                  <p className="text-sm text-muted">No residents listed (the card shows none).</p>
                )}
                {residents.map((resident, i) => (
                  <div key={i} className="flex flex-wrap gap-2 rounded-md border border-moss p-3 sm:flex-nowrap">
                    <input
                      value={resident.label}
                      onChange={(e) => editResident(i, { label: e.target.value })}
                      placeholder="Label (e.g. Frog 1, Neon tetras)"
                      aria-label={`Resident ${i + 1} label`}
                      maxLength={RESIDENT_LABEL_MAX}
                      className={`${inputClass} min-w-0 flex-1`}
                    />
                    <input
                      value={resident.name}
                      onChange={(e) => editResident(i, { name: e.target.value })}
                      placeholder="Name (optional)"
                      aria-label={`Resident ${i + 1} name`}
                      maxLength={RESIDENT_NAME_MAX}
                      className={`${inputClass} min-w-0 flex-1`}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => moveResident(i, -1)}
                        disabled={i === 0}
                        aria-label="Move up"
                        className="rounded-md border border-moss px-2 text-muted hover:bg-parchment disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveResident(i, 1)}
                        disabled={i === residents.length - 1}
                        aria-label="Move down"
                        className="rounded-md border border-moss px-2 text-muted hover:bg-parchment disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => setResidents(residents.filter((_, idx) => idx !== i))}
                        aria-label="Remove resident"
                        className="rounded-md border border-moss px-2 text-muted hover:bg-parchment"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
                <div>
                  <button
                    type="button"
                    onClick={() => setResidents([...residents, { label: "", name: "" }])}
                    disabled={residents.length >= RESIDENTS_MAX}
                    className="rounded-md border border-moss px-3 py-1.5 text-sm text-forest hover:bg-parchment disabled:opacity-40"
                  >
                    + Add resident
                  </button>
                  {residents.length >= RESIDENTS_MAX && (
                    <span className="ml-2 text-[11px] text-muted">Up to {RESIDENTS_MAX}.</span>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-forest px-4 py-2 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save species card"}
            </button>
            {message && <p className="text-sm text-forest">{message}</p>}
            {error && <p className="text-sm text-amber">{error}</p>}
          </div>
          <p className="text-[11px] text-muted">
            Images upload immediately when chosen. Text, status, block and resident changes apply
            when you press Save.
          </p>
        </div>
      )}
    </section>
  );
}
