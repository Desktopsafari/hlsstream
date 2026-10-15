import type { createServiceRoleClient } from "@/lib/supabase/server";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// The polls table gets ends_at / open_ended / duration_days from
// supabase/poll_duration.sql. Until that's run there are no such columns, so
// every query that wants them first checks, and the site behaves exactly as it
// did before (all polls are normal daily polls).
let confirmed = false;
let lastMissingAt = 0;
const RECHECK_MS = 20_000;

export function resetDurationColumnCache() {
  confirmed = false;
  lastMissingAt = 0;
}

export async function durationColumnsExist(supabase: Supabase): Promise<boolean> {
  if (confirmed) return true;
  if (lastMissingAt && Date.now() - lastMissingAt < RECHECK_MS) return false;
  const { error } = await supabase.from("polls").select("ends_at, open_ended, duration_days").limit(1);
  if (error) {
    lastMissingAt = Date.now();
    return false;
  }
  confirmed = true;
  return true;
}

// Extra columns to append to a polls select when they exist.
export async function timingSelect(supabase: Supabase): Promise<string> {
  return (await durationColumnsExist(supabase)) ? ", ends_at, open_ended" : "";
}
