"use client";

import { useEffect, useState } from "react";

type Suggestion = { id: string; message: string; created_at: string };

export default function SuggestionsAdmin() {
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/suggestions")
      .then((r) => r.json())
      .then((data) => setSuggestions(data.suggestions ?? []))
      .catch(() => setSuggestions([]));
  }, []);

  return (
    <section className="rounded-xl border border-moss bg-card p-5 shadow-sm">
      <h2 className="mb-3 font-heading text-lg font-semibold text-forest">Suggestions</h2>
      {suggestions === null && <p className="text-sm text-muted">Loading…</p>}
      {suggestions?.length === 0 && <p className="text-sm text-muted">No suggestions yet.</p>}
      <div className="flex flex-col gap-3">
        {suggestions?.map((s) => (
          <div key={s.id} className="border-b border-moss pb-2 last:border-0">
            <p className="text-sm text-ink">{s.message}</p>
            <p className="text-[11px] text-muted">{new Date(s.created_at).toLocaleString()}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
