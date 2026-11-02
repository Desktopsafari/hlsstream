"use client";

import { useEffect } from "react";

// The web app manifest (src/app/manifest.ts) is there so iPhones can add the
// site to the Home Screen for push notifications, but it also makes Chrome
// offer to "install" the site on its own. Cancelling beforeinstallprompt stops
// that automatic prompt/banner. The event is not kept or shown again later.
// Renders nothing.
export default function SuppressInstallPrompt() {
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    window.addEventListener("beforeinstallprompt", block);
    return () => window.removeEventListener("beforeinstallprompt", block);
  }, []);
  return null;
}
