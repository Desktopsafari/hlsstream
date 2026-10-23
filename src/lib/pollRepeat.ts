import type { createServiceRoleClient } from "@/lib/supabase/server";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// A paused daily poll closed within this long after a long poll opened (or any
// time before it) is the one that was waiting on it.
const RESUME_WINDOW_MS = 60_000;
// The closed poll's picture path, or null if it has none or the image_path
// column on polls doesn't exist yet.
async function pollPictureForCopy(supabase: Supabase, pollId: string): Promise<string | null> {
  const { data, error } = await supabase.from("polls").select("image_path").eq("id", pollId).maybeSingle();
  if (error) return null;
  return (data as { image_path: string | null } | null)?.image_path ?? null;
}

// Runs after a repeat_daily poll closes. Mirrors the same "only one poll
// scheduled at a time" rule the admin create endpoint enforces: if the
// admin already manually queued a different poll for the next cycle (which
// can only have happened while this poll was still open, since a poll
// can't be queued once one is already scheduled), that manual choice wins.
// The repeating poll is marked repeat_paused instead of silently losing its
// flag, so the admin panel can explain what happened.
//
// The copy points at the same question picture file as the original. That's
// safe because a file is only deleted when no poll references it any more
// (see removeFileIfUnreferenced in pollImages.ts).
export async function continueRepeatingPoll(
  supabase: Supabase,
  closedPollId: string,
  question: string,
): Promise<string> {
  const { data: existingScheduled } = await supabase
    .from("polls")
    .select("id")
    .eq("status", "scheduled")
    .limit(1)
    .maybeSingle();

  if (existingScheduled) {
    await supabase.from("polls").update({ repeat_paused: true }).eq("id", closedPollId);
    return " A different poll was already queued for the next cycle, so the repeat was paused.";
  }

  const { data: options } = await supabase
    .from("poll_options")
    .select("label, display_order")
    .eq("poll_id", closedPollId)
    .order("display_order", { ascending: true });

  const imagePath = await pollPictureForCopy(supabase, closedPollId);

  const { data: nextPoll, error: insertError } = await supabase
    .from("polls")
    .insert({
      question,
      status: "scheduled",
      repeat_daily: true,
      // Only sent when there is one, so a poll without a picture inserts the
      // same columns it always did.
      ...(imagePath ? { image_path: imagePath } : {}),
      // Placeholder timestamps -- the open/close crons overwrite these
      // with the real timestamps when they actually flip the status.
      opens_at: new Date().toISOString(),
      closes_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !nextPoll) {
    console.error("Failed to create repeating poll continuation:", insertError?.message);
    return " Failed to queue tomorrow's repeat -- check the logs.";
  }

  const { error: optionsError } = await supabase.from("poll_options").insert(
    (options ?? []).map((o) => ({
      poll_id: nextPoll.id,
      label: o.label,
      display_order: o.display_order,
    })),
  );

  if (optionsError) {
    console.error("Failed to copy options for repeating poll:", optionsError.message);
    return " Failed to copy options for tomorrow's repeat -- check the logs.";
  }

  return " Queued as tomorrow's repeat.";
}

// When a long (multi-day or open-ended) poll closes, a daily poll that was
// paused to make way for it goes back in the queue. The poll that was waiting
// is the one that closed just before the long poll opened. If something else
// is already queued (the admin queued a poll by hand while the long poll ran)
// that poll keeps the slot and the daily poll stays paused -- the same "manual
// queue wins" rule as at any other time.
export async function resumePausedRepeatingPoll(
  supabase: Supabase,
  longPollId: string,
  longPollOpenedAt: string,
): Promise<string> {
  const before = new Date(Date.parse(longPollOpenedAt) + RESUME_WINDOW_MS).toISOString();
  const { data: prev } = await supabase
    .from("polls")
    .select("id, question, repeat_daily, repeat_paused")
    .eq("status", "closed")
    .neq("id", longPollId)
    .lte("closes_at", before)
    .order("closes_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const paused = prev as { id: string; question: string; repeat_daily: boolean; repeat_paused: boolean } | null;
  if (!paused || !paused.repeat_daily || !paused.repeat_paused) return "";

  const { data: queued } = await supabase.from("polls").select("id").eq("status", "scheduled").limit(1).maybeSingle();
  if (queued) return " A different poll is queued, so the paused daily poll stays paused.";

  const message = await continueRepeatingPoll(supabase, paused.id, paused.question);
  if (!/Queued/.test(message)) return message;
  await supabase.from("polls").update({ repeat_paused: false }).eq("id", paused.id);
  return " The paused daily poll was queued to resume.";
}
