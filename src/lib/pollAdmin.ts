import type { createServiceRoleClient } from "@/lib/supabase/server";
import {
  attachPendingImage,
  IMAGES_SQL_HINT,
  imagesSupported,
  isPendingPath,
  loadPollImagePaths,
  removeFileIfUnreferenced,
} from "@/lib/pollImages";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// New-poll options arrive as plain strings (what the admin form sends).
export function parseNewOptions(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length < 2) return null;
  const parsed: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string" || raw.trim().length === 0) return null;
    parsed.push(raw.trim());
  }
  return parsed;
}

// The poll picture from a request body: a pending upload path, or none.
// Returns undefined when it's present but not a valid pending path.
export function parsePendingImage(input: unknown): string | null | undefined {
  if (input === undefined || input === null || input === "") return null;
  return isPendingPath(input) ? input : undefined;
}

export type CreatePollResult =
  | { ok: true; pollId: string }
  | { ok: false; status: number; error: string };

// Creates a queued (scheduled) poll with its options and optional picture.
// Shared by "Queue poll" and "Open now" from the form. Nothing is left
// half-made: if any step fails the poll is removed again.
export async function createPollWithOptions(
  supabase: Supabase,
  input: { question: string; options: string[]; repeatDaily: boolean; imagePath?: string | null },
): Promise<CreatePollResult> {
  if (input.imagePath && !(await imagesSupported(supabase))) {
    return { ok: false, status: 400, error: IMAGES_SQL_HINT };
  }

  const { data: poll, error: pollError } = await supabase
    .from("polls")
    .insert({
      question: input.question.trim(),
      status: "scheduled",
      repeat_daily: input.repeatDaily,
      // Placeholder timestamps -- the open/close crons overwrite these
      // with the real timestamps when they actually flip the status.
      opens_at: new Date().toISOString(),
      closes_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (pollError || !poll) {
    return { ok: false, status: 500, error: pollError?.message ?? "Failed to create poll" };
  }

  const { error: optionsError } = await supabase.from("poll_options").insert(
    input.options.map((label, index) => ({
      poll_id: poll.id,
      label,
      display_order: index,
    })),
  );

  if (optionsError) {
    await deletePollWithFiles(supabase, poll.id);
    return { ok: false, status: 500, error: optionsError.message };
  }

  if (input.imagePath) {
    const attached = await attachPendingImage(supabase, poll.id, input.imagePath);
    if (!attached.ok) {
      await deletePollWithFiles(supabase, poll.id);
      return { ok: false, status: attached.status, error: attached.error };
    }
  }

  return { ok: true, pollId: poll.id };
}

// Removes a poll that never went live (cascade removes its options) plus its
// picture file if no other poll uses it.
export async function deletePollWithFiles(supabase: Supabase, pollId: string): Promise<void> {
  const paths = await loadPollImagePaths(supabase, [pollId]);
  await supabase.from("polls").delete().eq("id", pollId);
  const path = paths?.get(pollId);
  if (path) await removeFileIfUnreferenced(supabase, path);
}
