import type { createServiceRoleClient } from "@/lib/supabase/server";
import { DAILY_COLUMNS, type DurationColumns } from "@/lib/pollDuration";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// The polls table gets ends_at / open_ended / duration_days from
// supabase/poll_duration.sql. Until that's run there are no such columns, so
// every query that wants them first checks, and the site behaves exactly as it
// did before (all polls are normal daily polls). This file is the one place
// that knows about that: everything else reads the columns through it.
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

// Column lists to append to a polls select (empty until the columns exist).
// "Timing" is what decides when voting ends; "duration" adds the day count a
// queued N-day poll waits with.
const TIMING_COLS = ", ends_at, open_ended";
export const DURATION_COLS = ", ends_at, open_ended, duration_days";

export async function timingSelect(supabase: Supabase): Promise<string> {
  return (await durationColumnsExist(supabase)) ? TIMING_COLS : "";
}

export async function durationSelect(supabase: Supabase): Promise<string> {
  return (await durationColumnsExist(supabase)) ? DURATION_COLS : "";
}

// One poll's chosen duration and when it opened. A normal daily poll (and
// everything, before the SQL is run) comes back as DAILY_COLUMNS.
export async function loadPollDuration(
  supabase: Supabase,
  pollId: string,
): Promise<{ cols: DurationColumns; opens_at: string | null }> {
  if (!(await durationColumnsExist(supabase))) return { cols: DAILY_COLUMNS, opens_at: null };
  const { data } = await supabase
    .from("polls")
    .select("opens_at, ends_at, open_ended, duration_days")
    .eq("id", pollId)
    .maybeSingle();
  const row = data as {
    opens_at: string;
    ends_at: string | null;
    open_ended: boolean | null;
    duration_days: number | null;
  } | null;
  if (!row) return { cols: DAILY_COLUMNS, opens_at: null };
  return {
    cols: { ends_at: row.ends_at, open_ended: !!row.open_ended, duration_days: row.duration_days },
    opens_at: row.opens_at,
  };
}
