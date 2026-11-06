// The captures data layer. Every read and write of the captures table (and
// every call to the capture service on the VPS) lives in this folder; routes,
// the cron, the gallery and the admin call it through this file and never
// query that table themselves.
//
// Server-only. (The capture buttons, the gallery grid and the admin tab are
// client components and import limits, labels and helpers from ./rules
// directly, which has no server imports.)

export {
  CAPTURE_COLUMNS,
  MESSAGES,
  PAUSE_SETTING_KEY,
  captureConfig,
  capturesTableReady,
  checkVisitorLimits,
  isCapturesPaused,
  requesterHash,
  setCapturesPaused,
  visitorBudgetUsed,
  type CaptureConfig,
  type CaptureRow,
} from "@/lib/data/captures/core";
export { createCapture, parseCaptureInput, type CaptureRequest, type PublicCapture } from "@/lib/data/captures/create";
export { cleanupCaptures } from "@/lib/data/captures/cleanup";
export { GALLERY_LIMIT, loadGallery, type GalleryItem } from "@/lib/data/captures/gallery";
export { deleteCapture, loadCaptureOverview, updateCapture } from "@/lib/data/captures/admin";
