"use client";

import { useEffect, useState } from "react";

type Category = { id: string; display_name: string; is_active: boolean };

export default function BroadcastComposer() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewApprox, setPreviewApprox] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetch("/api/admin/notification-categories")
      .then((r) => r.json())
      .then((data) => setCategories(data.categories ?? []))
      .catch(() => setCategories([]));
  }, []);

  async function preview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!categoryId || subject.trim().length === 0 || message.trim().length === 0) {
      setError("Pick a category and fill in both the subject and message.");
      return;
    }

    setLoadingPreview(true);
    const res = await fetch(`/api/admin/broadcasts?categoryId=${categoryId}`);
    setLoadingPreview(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to look up subscriber count.");
      return;
    }

    const data = await res.json();
    setPreviewCount(data.count);
    setPreviewApprox(data.approxOnly);
    setConfirming(true);
  }

  async function send() {
    setSending(true);
    setError(null);

    const res = await fetch("/api/admin/broadcasts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId, subject, message }),
    });
    setSending(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to send.");
      return;
    }

    setConfirming(false);
    setSuccess("Sent!");
    setSubject("");
    setMessage("");
  }

  const categoryName = categories.find((c) => c.id === categoryId)?.display_name ?? "";

  return (
    <section className="rounded-xl border border-moss bg-card p-5 shadow-sm">
      <h2 className="mb-3 font-heading text-lg font-semibold text-forest">
        Compose &amp; Send Announcement
      </h2>

      {confirming ? (
        <div className="flex flex-col gap-3 rounded-lg border border-amber/50 bg-parchment p-4">
          <p className="text-sm text-ink">
            You&apos;re about to email{" "}
            <strong>
              {previewApprox ? `${previewCount}+` : previewCount} subscriber
              {previewCount === 1 ? "" : "s"}
            </strong>{" "}
            in <strong>{categoryName}</strong>. This can&apos;t be undone once sent. Send now?
          </p>
          <div className="flex gap-2">
            <button
              onClick={send}
              disabled={sending}
              className="rounded-md bg-forest px-3 py-1.5 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send now"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={sending}
              className="rounded-md border border-moss px-3 py-1.5 text-sm text-muted hover:bg-card"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-sm text-amber">{error}</p>}
        </div>
      ) : (
        <form onSubmit={preview} className="flex flex-col gap-3">
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="rounded-md border border-moss bg-parchment px-3 py-2 text-sm text-ink outline-none focus:border-forest"
          >
            <option value="">Select a category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name}
                {!c.is_active ? " (inactive)" : ""}
              </option>
            ))}
          </select>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            maxLength={200}
            className="rounded-md border border-moss bg-parchment px-3 py-2 text-sm text-ink outline-none focus:border-forest"
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Message"
            rows={6}
            className="rounded-md border border-moss bg-parchment px-3 py-2 text-sm text-ink outline-none focus:border-forest"
          />
          <div>
            <button
              type="submit"
              disabled={loadingPreview}
              className="rounded-md bg-forest px-3 py-2 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50"
            >
              {loadingPreview ? "Checking…" : "Preview & send"}
            </button>
          </div>
          {error && <p className="text-sm text-amber">{error}</p>}
          {success && <p className="text-sm text-forest">{success}</p>}
        </form>
      )}
    </section>
  );
}
