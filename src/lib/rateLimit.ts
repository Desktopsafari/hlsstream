import type { createServiceRoleClient } from "@/lib/supabase/server";

type Supabase = ReturnType<typeof createServiceRoleClient>;

const ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;

// Per-connection limit for public forms, stored in Supabase because
// serverless functions don't share memory. `form` gives each form its own
// budget. Returns false (and records nothing more) once the limit is hit;
// otherwise records this attempt and returns true. Callers should call this
// before any other validation so every attempt, including rejected ones,
// counts toward the limit.
export async function allowAttempt(
  supabase: Supabase,
  ip: string,
  form: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  // Opportunistic cleanup keeps the table small without its own cron job.
  await supabase
    .from("contact_form_attempts")
    .delete()
    .lt("created_at", new Date(Date.now() - ATTEMPT_RETENTION_MS).toISOString());

  const { count } = await supabase
    .from("contact_form_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip_address", ip)
    .eq("form", form)
    .gt("created_at", new Date(Date.now() - windowMs).toISOString());

  if ((count ?? 0) >= max) return false;

  await supabase.from("contact_form_attempts").insert({ ip_address: ip, form });
  return true;
}
