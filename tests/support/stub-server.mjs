// Stands in for src/lib/supabase/server.ts during tests: hands out whatever
// in-memory fake database the current test installed on globalThis.
export function createServiceRoleClient() {
  if (!globalThis.__fake) {
    throw new Error("Tests must install a fake database first (see tests/support/helpers.mjs: fresh()).");
  }
  return globalThis.__fake;
}
