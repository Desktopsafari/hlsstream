"use client";

import { useCallback, useEffect, useState } from "react";

type Group = {
  key: string;
  text: string;
  count: number;
  newestAt: string;
  isFlagged: boolean;
  isShortlisted: boolean;
};

type FrogGroups = { frogId: string; label: string; groups: Group[] };

export default function NameSuggestionsReview({
  eventId,
  onChanged,
}: {
  eventId: string;
  onChanged: () => void;
}) {
  const [frogs, setFrogs] = useState<FrogGroups[] | null>(null);
  const [hiddenFlagged, setHiddenFlagged] = useState(0);
  const [showFlagged, setShowFlagged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/admin/name-suggestions?eventId=${eventId}&includeFlagged=${showFlagged ? 1 : 0}`,
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't load the suggestions.");
      return;
    }
    const data = await res.json();
    setFrogs(data.frogs);
    setHiddenFlagged(data.hiddenFlaggedGroups);
    setError(null);
  }, [eventId, showFlagged]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleShortlist(frogId: string, group: Group) {
    const res = await fetch("/api/admin/name-suggestions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId,
        frogId,
        key: group.key,
        shortlisted: !group.isShortlisted,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't update that.");
      return;
    }
    load();
  }

  async function remove(frogId: string, group: Group) {
    const times = group.count === 1 ? "" : ` (and its ${group.count - 1} duplicate${group.count === 2 ? "" : "s"})`;
    if (!window.confirm(`Delete "${group.text}"${times}?`)) return;

    const res = await fetch("/api/admin/name-suggestions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, frogId, key: group.key }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't delete that.");
      return;
    }
    load();
    onChanged();
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-forest/40 bg-parchment p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Name ideas (duplicates merged)
        </p>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={showFlagged}
            onChange={(e) => setShowFlagged(e.target.checked)}
            className="h-4 w-4 rounded border-moss"
          />
          Show flagged{!showFlagged && hiddenFlagged > 0 ? ` (${hiddenFlagged} hidden)` : ""}
        </label>
      </div>

      {error && <p className="text-sm text-amber">{error}</p>}
      {frogs === null && !error && <p className="text-sm text-muted">Loading…</p>}

      {frogs?.map((frog) => {
        const shortlisted = frog.groups.filter((g) => g.isShortlisted);
        return (
          <div key={frog.frogId} className="flex flex-col gap-2">
            <h4 className="font-heading text-base font-semibold text-forest">{frog.label}</h4>

            {shortlisted.length > 0 && (
              <p className="text-sm text-ink">
                <span className="font-semibold">Shortlisted:</span>{" "}
                {shortlisted.map((g) => g.text).join(", ")}
              </p>
            )}

            {frog.groups.length === 0 && <p className="text-sm text-muted">No ideas yet.</p>}

            {frog.groups.map((g) => (
              <div
                key={g.key}
                className="flex items-center justify-between gap-2 border-b border-moss pb-1 last:border-0"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="rounded-full bg-moss px-2 py-0.5 text-xs font-semibold text-ink">
                    ×{g.count}
                  </span>
                  <span className="truncate text-sm text-ink">{g.text}</span>
                  {g.isFlagged && (
                    <span className="rounded-full border border-amber px-2 py-0.5 text-[11px] text-amber">
                      flagged
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => toggleShortlist(frog.frogId, g)}
                    className={`rounded-md border px-2 py-1 text-xs ${
                      g.isShortlisted
                        ? "border-forest bg-forest text-parchment"
                        : "border-moss text-forest hover:bg-card"
                    }`}
                  >
                    {g.isShortlisted ? "Shortlisted" : "Shortlist"}
                  </button>
                  <button
                    onClick={() => remove(frog.frogId, g)}
                    className="rounded-md border border-moss px-2 py-1 text-xs text-muted hover:bg-card"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
