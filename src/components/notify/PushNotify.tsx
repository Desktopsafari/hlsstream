"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Category = { id: string; name: string };
type View = "loading" | "hidden" | "ios-install" | "unsupported" | "blocked" | "off" | "on";

// iPhones and iPads (iPadOS reports itself as a Mac with a touch screen).
function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isInstalledApp(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "===".slice((base64url.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

async function send(method: string, url: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// The "Phone/browser notifications" part of the Notify me modal. Mounted only
// when the modal opens, so nothing here runs on page load. It never asks for
// permission by itself: only the "Turn on notifications" click does, and the
// service worker is registered only then. When push isn't set up on the site
// (keys or tables missing) it renders nothing.
export default function PushNotify() {
  const [view, setView] = useState<View>("loading");
  const [categories, setCategories] = useState<Category[]>([]);
  const [publicKey, setPublicKey] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const info = await fetch("/api/push")
        .then((r) => r.json())
        .catch(() => null);
      if (cancelled) return;
      if (!info?.supported) return setView("hidden");
      const cats: Category[] = info.categories ?? [];
      setCategories(cats);
      setPublicKey(info.publicKey);
      setSelected(new Set(cats.map((c) => c.id)));

      if (isIos() && !isInstalledApp()) return setView("ios-install");
      if (!pushSupported()) return setView("unsupported");
      if (Notification.permission === "denied") return setView("blocked");

      const sub = await currentSubscription().catch(() => null);
      if (!sub) return !cancelled && setView("off");
      const status = await send("POST", "/api/push/subscription/status", { endpoint: sub.endpoint });
      if (cancelled) return;
      if (status.ok && status.data.subscribed && Notification.permission === "granted") {
        const ids = new Set<string>(status.data.categoryIds);
        setSelected(ids);
        setSaved(ids);
        setView("on");
      } else {
        setView("off");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    setMessage(null);
  }

  async function turnOn() {
    setError(null);
    setMessage(null);
    if (selected.size === 0) return setError("Pick at least one category.");
    setBusy(true);
    try {
      // Asked here, in response to the click, and nowhere else.
      const permission = await Notification.requestPermission();
      if (permission === "denied") return setView("blocked");
      if (permission !== "granted") return setError("Notifications weren't allowed. You can try again any time.");

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const options = { userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) };
      let sub: PushSubscription;
      try {
        sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe(options));
      } catch {
        // An old subscription made with a different key: replace it.
        await (await reg.pushManager.getSubscription())?.unsubscribe();
        sub = await reg.pushManager.subscribe(options);
      }
      const res = await send("POST", "/api/push/subscription", { subscription: sub.toJSON(), categoryIds: [...selected] });
      if (!res.ok) return setError(res.data.error ?? "Something went wrong, please try again.");
      const ids = new Set<string>(res.data.categoryIds);
      setSelected(ids);
      setSaved(ids);
      setView("on");
    } catch {
      setError("Couldn't turn on notifications in this browser. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveChoices() {
    setError(null);
    setMessage(null);
    if (selected.size === 0) return setError("Pick at least one category, or use Turn off.");
    setBusy(true);
    const sub = await currentSubscription().catch(() => null);
    const res = sub ? await send("PUT", "/api/push/subscription", { endpoint: sub.endpoint, categoryIds: [...selected] }) : null;
    setBusy(false);
    if (!res || res.status === 404) {
      setView("off");
      return setError("Notifications aren't on for this device anymore. Turn them on again below.");
    }
    if (!res.ok) return setError(res.data.error ?? "Something went wrong, please try again.");
    const ids = new Set<string>(res.data.categoryIds);
    setSelected(ids);
    setSaved(ids);
    setMessage("Saved.");
  }

  async function turnOff() {
    setError(null);
    setMessage(null);
    setBusy(true);
    const sub = await currentSubscription().catch(() => null);
    if (sub) {
      const res = await send("DELETE", "/api/push/subscription", { endpoint: sub.endpoint });
      if (!res.ok) {
        setBusy(false);
        return setError(res.data.error ?? "Something went wrong, please try again.");
      }
      await sub.unsubscribe().catch(() => {});
    }
    setBusy(false);
    setSelected(new Set(categories.map((c) => c.id)));
    setView("off");
    setMessage("Notifications are off for this device.");
  }

  if (view === "hidden") return null;

  const changed = selected.size !== saved.size || [...selected].some((id) => !saved.has(id));

  return (
    <section className="rounded-xl border border-moss bg-card p-5 shadow-sm">
      <h2 className="mb-1 font-heading text-lg font-semibold text-forest">Phone/browser notifications</h2>

      {view === "loading" && <p className="text-sm text-muted">Loading…</p>}

      {view === "ios-install" && (
        <p className="text-sm text-ink">
          On iPhone and iPad, notifications work once this site is on your Home Screen (iOS 16.4 or later). Tap{" "}
          <strong>Share</strong>, then <strong>Add to Home Screen</strong>, then open it from there.
        </p>
      )}

      {view === "unsupported" && (
        <p className="text-sm text-ink">This browser doesn&rsquo;t support notifications. Email updates above still work.</p>
      )}

      {view === "blocked" && (
        <p className="text-sm text-ink">
          Notifications are blocked for this site. To allow them, open your browser&rsquo;s settings for this site (often
          the icon next to the address bar), set Notifications to Allow, then open this window again. On a phone, also
          check that your browser is allowed to show notifications in the phone&rsquo;s settings.
        </p>
      )}

      {(view === "off" || view === "on") && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            {view === "on" ? (
              <span className="font-semibold text-forest">Notifications are on for this device.</span>
            ) : (
              "Get a notification on this device for:"
            )}
          </p>
          <div className="flex flex-col gap-2">
            {categories.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                  className="h-4 w-4 rounded border-moss"
                />
                {c.name}
              </label>
            ))}
          </div>
          {view === "off" ? (
            <button
              type="button"
              onClick={turnOn}
              disabled={busy}
              className="rounded-md bg-forest px-3 py-2 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50"
            >
              {busy ? "Turning on…" : "Turn on notifications"}
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={saveChoices}
                disabled={busy || !changed}
                className="flex-1 rounded-md bg-forest px-3 py-2 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50"
              >
                Save choices
              </button>
              <button
                type="button"
                onClick={turnOff}
                disabled={busy}
                className="flex-1 rounded-md border border-moss px-3 py-2 text-sm text-forest hover:bg-parchment disabled:opacity-50"
              >
                Turn off
              </button>
            </div>
          )}
        </div>
      )}

      {message && <p className="mt-3 text-sm text-forest">{message}</p>}
      {error && <p className="mt-3 text-sm text-amber">{error}</p>}

      {view !== "loading" && (
        <p className="mt-3 text-[11px] text-muted">
          We store only this device&rsquo;s push address and your choices: no name or email. Turn it off here or in your
          browser or phone settings.{" "}
          <Link href="/privacy#push-notifications" className="underline hover:text-forest">
            Privacy notice
          </Link>
        </p>
      )}
    </section>
  );
}
