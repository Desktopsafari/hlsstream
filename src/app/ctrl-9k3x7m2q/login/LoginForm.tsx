"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ADMIN_PATH } from "@/config/constants";

export default function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    setLoading(false);

    if (!res.ok) {
      setError("Incorrect password.");
      return;
    }

    router.push(ADMIN_PATH);
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto mt-20 flex w-full max-w-sm flex-col gap-3 rounded-xl border border-moss bg-card p-6 shadow-sm"
    >
      <h1 className="font-heading text-lg font-semibold text-forest">Admin Login</h1>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoFocus
        className="rounded-md border border-moss bg-parchment px-3 py-2 text-sm text-ink outline-none focus:border-forest"
      />
      {error && <p className="text-sm text-amber">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-forest px-3 py-2 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50"
      >
        {loading ? "Checking…" : "Log in"}
      </button>
    </form>
  );
}
