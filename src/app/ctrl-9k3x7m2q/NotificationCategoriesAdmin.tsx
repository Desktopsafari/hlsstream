"use client";

import { useEffect, useState } from "react";

type Category = {
  id: string;
  display_name: string;
  resend_audience_id: string;
  is_active: boolean;
  created_at: string;
};

export default function NotificationCategoriesAdmin() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function load() {
    const res = await fetch("/api/admin/notification-categories");
    if (res.ok) {
      const data = await res.json();
      setCategories(data.categories);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);

    const res = await fetch("/api/admin/notification-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: newName }),
    });
    setCreating(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to create category.");
      return;
    }

    setNewName("");
    load();
  }

  async function saveRename(id: string) {
    const res = await fetch("/api/admin/notification-categories", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, displayName: editName }),
    });
    if (res.ok) {
      setEditingId(null);
      load();
    }
  }

  async function toggleActive(cat: Category) {
    await fetch("/api/admin/notification-categories", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: cat.id, isActive: !cat.is_active }),
    });
    load();
  }

  return (
    <section className="rounded-xl border border-moss bg-card p-5 shadow-sm">
      <h2 className="mb-3 font-heading text-lg font-semibold text-forest">
        Notification Categories
      </h2>

      <form onSubmit={create} className="mb-4 flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="e.g. Website Updates"
          className="flex-1 rounded-md border border-moss bg-parchment px-3 py-2 text-sm text-ink outline-none focus:border-forest"
        />
        <button
          type="submit"
          disabled={creating}
          className="rounded-md bg-forest px-3 py-2 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50"
        >
          {creating ? "Creating…" : "+ Add category"}
        </button>
      </form>
      {error && <p className="mb-3 text-sm text-amber">{error}</p>}

      <div className="flex flex-col gap-2">
        {categories.length === 0 && (
          <p className="text-sm text-muted">No categories yet.</p>
        )}
        {categories.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 border-b border-moss pb-2 last:border-0">
            {editingId === c.id ? (
              <div className="flex flex-1 items-center gap-2">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 rounded-md border border-moss bg-parchment px-2 py-1 text-sm text-ink outline-none focus:border-forest"
                />
                <button
                  onClick={() => saveRename(c.id)}
                  className="rounded-md border border-moss px-2 py-1 text-xs text-forest hover:bg-parchment"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="rounded-md border border-moss px-2 py-1 text-xs text-muted hover:bg-parchment"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <span className={`text-sm ${c.is_active ? "text-ink" : "text-muted line-through"}`}>
                {c.display_name}
              </span>
            )}

            {editingId !== c.id && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setEditingId(c.id);
                    setEditName(c.display_name);
                  }}
                  className="rounded-md border border-moss px-2 py-1 text-xs text-forest hover:bg-parchment"
                >
                  Rename
                </button>
                <button
                  onClick={() => toggleActive(c)}
                  className="rounded-md border border-moss px-2 py-1 text-xs text-muted hover:bg-parchment"
                >
                  {c.is_active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted">
        Deactivating hides a category from the public signup form -- it doesn&apos;t delete the
        Resend audience or its subscribers.
      </p>
    </section>
  );
}
