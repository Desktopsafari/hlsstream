import { createClient } from "@supabase/supabase-js";

// Server-only: uses the service_role key, which bypasses RLS entirely.
// Never import this from a "use client" component or anything that ends
// up in the browser bundle.
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
