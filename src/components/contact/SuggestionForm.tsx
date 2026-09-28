"use client";

import { useState } from "react";

const MAX_LENGTH = 2000;

export default function SuggestionForm() {
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot -- real visitors never see this
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (message.trim().length === 0) {
      setError("Message can't be empty.");
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/contact/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, website }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong.");
      return;
    }

    setSent(true);
    setMessage("");
  }

  return (
    <section className="rounded-xl border border-moss bg-card p-5 shadow-sm">
      <h2 className="mb-1 font-heading text-lg font-semibold text-forest">
        Suggest a stream or feature
      </h2>
      <p className="mb-4 text-sm text-muted">Have an idea? Let us know.</p>

      {sent ? (
        <p className="text-sm text-forest">Thanks for the suggestion!</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          {/* Honeypot: off-screen, never focusable/visible to a real visitor. */}
          <div className="absolute left-[-9999px]" aria-hidden="true">
            <label htmlFor="website">Website</label>
            <input
              id="website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={MAX_LENGTH}
            rows={4}
            placeholder="What would you like to see?"
            className="rounded-md border border-moss bg-parchment px-3 py-2 text-sm text-ink outline-none focus:border-forest"
          />
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-forest px-3 py-2 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50"
          >
            {submitting ? "Sending…" : "Send suggestion"}
          </button>
          {error && <p className="text-sm text-amber">{error}</p>}
        </form>
      )}
    </section>
  );
}
