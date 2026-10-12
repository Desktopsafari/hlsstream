import { createServiceRoleClient } from "@/lib/supabase/server";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// The rate limits only look back one hour, so an attempt record is useless
// after that. Keep a small margin, then delete -- these rows hold IP addresses.
export const ATTEMPT_RETENTION_MS = 2 * 60 * 60 * 1000;

function attemptCutoff(): string {
  return new Date(Date.now() - ATTEMPT_RETENTION_MS).toISOString();
}

// Daily cleanup (see /api/cron/cleanup-chat). Also runs opportunistically
// inside allowAttempt, but that only happens when someone submits a form, so
// without this job old rows would sit around on a quiet site.
export async function cleanupOldFormAttempts(): Promise<{ deleted: boolean; error?: string }> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("contact_form_attempts")
    .delete()
    .lt("created_at", attemptCutoff());

  if (error) {
    console.error("Form-attempt cleanup failed:", error.message);
    return { deleted: false, error: error.message };
  }
  return { deleted: true };
}

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
  await supabase.from("contact_form_attempts").delete().lt("created_at", attemptCutoff());

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
