import { createClient } from "@supabase/supabase-js";

// Safe for the browser: uses the publishable/anon key, gated by RLS
// policies (see supabase/schema.sql).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabaseBrowser = createClient(url, anonKey, {
  auth: { persistSession: false },
});
