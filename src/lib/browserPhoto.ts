"use client";

// "Take photo" for visitors: the frame the player is showing right now,
// drawn onto a canvas in the browser with the watermark added. Nothing is
// sent anywhere and nothing is stored. When the browser can't do it (canvas
// blocked or blank, very old browser), the caller falls back to the capture
// server's photo path.

export type BrowserPhoto = { blob: Blob; width: number; height: number };
export type BrowserPhotoFailure = "not-ready" | "blocked" | "blank" | "encode";

const WATERMARK = "desktopsafari.com";

export async function takeBrowserPhoto(video: HTMLVideoElement | null): Promise<BrowserPhoto | BrowserPhotoFailure> {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return "not-ready";
  const width = video.videoWidth;
  const height = video.videoHeight;

  let canvas: HTMLCanvasElement;
  try {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "blocked";
    ctx.drawImage(video, 0, 0, width, height);
    const check = frameCheck(canvas);
    if (check) return check;

    // Same look as the server watermark: small, semi-transparent, bottom right.
    const size = Math.max(12, Math.round(height / 32));
    const pad = Math.round(height / 40);
    ctx.font = `bold ${size}px "DejaVu Sans", Verdana, Arial, sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.fillText(WATERMARK, width - pad, height - pad);
  } catch {
    // A tainted canvas throws on read (SecurityError); some old browsers
    // throw on drawImage of a video at all.
    return "blocked";
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    } catch {
      resolve(null);
    }
  });
  if (!blob || blob.size < 1000) return "encode";
  return { blob, width, height };
}

// Reads a small copy of the frame: throws if the canvas is tainted, and
// spots the all-black / transparent frame some mobile browsers hand back for
// HLS video instead of refusing. A real night-time frame from the camera is
// dark but never exactly 0,0,0 everywhere.
function frameCheck(canvas: HTMLCanvasElement): BrowserPhotoFailure | null {
  const probe = document.createElement("canvas");
  probe.width = 32;
  probe.height = 18;
  const pctx = probe.getContext("2d");
  if (!pctx) return "blocked";
  pctx.drawImage(canvas, 0, 0, 32, 18);
  const px = pctx.getImageData(0, 0, 32, 18).data; // throws when tainted
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] !== 0 && (px[i] !== 0 || px[i + 1] !== 0 || px[i + 2] !== 0)) return null;
  }
  return "blank";
}

export function photoFileName(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `desktopsafari-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.jpg`;
}
