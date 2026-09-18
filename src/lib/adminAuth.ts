// Signed admin session tokens using Web Crypto (works identically in
// middleware's Edge runtime and in regular Node route handlers -- no
// extra secret needed, the HMAC key is derived from ADMIN_PASSWORD).

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const ADMIN_SESSION_COOKIE = "admin_session";

async function getKey(): Promise<CryptoKey> {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("Missing ADMIN_PASSWORD");

  const keyData = new TextEncoder().encode(password);
  return crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSessionToken(): Promise<string> {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `admin:${expires}`;
  const key = await getKey();
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return `${payload}.${toHex(signature)}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;

  const [payload, signatureHex] = token.split(".");
  if (!payload || !signatureHex) return false;

  const [, expiresStr] = payload.split(":");
  const expires = Number(expiresStr);
  if (!expires || Date.now() > expires) return false;

  const key = await getKey();
  const expectedSignature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  const expectedHex = toHex(expectedSignature);

  // Constant-time-ish comparison; lengths are fixed (hex of a SHA-256 HMAC).
  if (expectedHex.length !== signatureHex.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedHex.length; i++) {
    diff |= expectedHex.charCodeAt(i) ^ signatureHex.charCodeAt(i);
  }
  return diff === 0;
}

export function checkAdminPassword(candidate: string): boolean {
  return candidate === process.env.ADMIN_PASSWORD;
}
