import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/config/constants";

// Web app manifest: lets the site be added to a phone's Home Screen, which
// iPhones (iOS 16.4+) require before they allow web push. The icons are
// src/app/icon.png padded to a square on the parchment background.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: `Watch the ${SITE_NAME} live stream.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f3ea",
    theme_color: "#2f4b3c",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
