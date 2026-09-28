"use client";

import { useEffect, useState } from "react";

type Category = { id: string; display_name: string };

export default function SubscribeForm() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/notification-categories")
      .then((r) => r.json())
      .then((data) => setCategories(data.categories ?? []))
      .catch(() => setCategories([]));
  }, []);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (selected.size === 0) {
      setError("Pick at least one category.");
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/contact/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, categoryIds: [...selected] }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong.");
      return;
    }

    setMessage("You're signed up! Check your inbox for a confirmation from Resend.");
    setEmail("");
    setSelected(new Set());
  }

  return (
    <section className="rounded-xl border border-moss bg-card p-5 shadow-sm">
      <h2 className="mb-1 font-heading text-lg font-semibold text-forest">Stay Updated</h2>
      <p className="mb-4 text-sm text-muted">
        Get an email when there's news. Unsubscribe anytime via the link in any email you
        receive.
      </p>

      {categories === null && <p className="text-sm text-muted">Loading…</p>}
      {categories?.length === 0 && (
        <p className="text-sm text-muted">No notification categories are available right now.</p>
      )}

      {categories && categories.length > 0 && (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="rounded-md border border-moss bg-parchment px-3 py-2 text-sm text-ink outline-none focus:border-forest"
          />
          <div className="flex flex-col gap-2">
            {categories.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                  className="h-4 w-4 rounded border-moss"
                />
                {c.display_name}
              </label>
            ))}
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-forest px-3 py-2 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50"
          >
            {submitting ? "Signing up…" : "Sign up"}
          </button>
          {message && <p className="text-sm text-forest">{message}</p>}
          {error && <p className="text-sm text-amber">{error}</p>}
        </form>
      )}
    </section>
  );
}
