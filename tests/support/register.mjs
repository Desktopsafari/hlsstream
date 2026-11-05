import { register } from "node:module";

// Loaded with `node --import` before every test file (see "test" in package.json).
// Point everything at obviously fake values so nothing here can mean a real
// Supabase project, even by accident.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-not-a-real-key";
process.env.CRON_SECRET = "test-secret";
delete process.env.RESEND_API_KEY;
// Push: fake keys (web-push itself is stubbed, see hooks.mjs) and test secrets.
process.env.VAPID_PUBLIC_KEY = "test-public-key";
process.env.VAPID_PRIVATE_KEY = "test-private-key";
process.env.VAPID_SUBJECT = "mailto:test@example.com";
process.env.PUSH_CRON_SECRET = "test-push-secret";
process.env.ADMIN_PASSWORD = "test-admin-password";
// Capture: a made-up host that only the stub capture service answers
// (stub-capture-service.mjs), and test secrets.
process.env.CAPTURE_SERVICE_URL = "https://capture.test/capture-api";
process.env.CAPTURE_SECRET = "test-capture-secret-that-is-long-enough";
process.env.CAPTURE_CRON_SECRET = "test-capture-cron-secret";

// No test may reach the network: fetch only answers the stub capture service.
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.hostname === "capture.test" && globalThis.__captureService) return globalThis.__captureService(url, init);
  throw new Error(`Tests may not reach the network (${url.origin}).`);
};

register("./hooks.mjs", import.meta.url);
