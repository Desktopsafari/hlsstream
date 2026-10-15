// Shared checks for admin image uploads: JPG/PNG/WebP up to 4MB (Vercel
// serverless request bodies max out around 4.5MB, so stay under it).
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function matchesSignature(type: string, bytes: Uint8Array): boolean {
  const at = (i: number) => bytes[i];
  if (type === "image/jpeg") return at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff;
  if (type === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b);
  }
  if (type === "image/webp") {
    const tag = (from: number) => String.fromCharCode(at(from), at(from + 1), at(from + 2), at(from + 3));
    return tag(0) === "RIFF" && tag(8) === "WEBP";
  }
  return false;
}

export type ImageCheck =
  | { ok: true; ext: string; contentType: string }
  | { ok: false; error: string };

// The browser-supplied type must be an allowed one AND the file's first bytes
// must agree with it, so a text file renamed to .png is refused.
export async function checkImageUpload(file: File): Promise<ImageCheck> {
  const ext = TYPES[file.type];
  if (!ext) return { ok: false, error: "Images must be JPG, PNG, or WebP." };
  if (file.size > IMAGE_MAX_BYTES) {
    return { ok: false, error: "That image is over 4MB. Please resize/compress it and try again." };
  }
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!matchesSignature(file.type, head)) {
    return { ok: false, error: "That file isn't a real JPG, PNG, or WebP image." };
  }
  return { ok: true, ext, contentType: file.type };
}
