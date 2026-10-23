import { register } from "node:module";

// Loaded with `node --import` before every test file (see "test" in package.json).
// Point everything at obviously fake values so nothing here can mean a real
// Supabase project, even by accident.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-not-a-real-key";
process.env.CRON_SECRET = "test-secret";
delete process.env.RESEND_API_KEY;

register("./hooks.mjs", import.meta.url);
