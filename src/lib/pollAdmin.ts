import type { createServiceRoleClient } from "@/lib/supabase/server";
import {
  attachPendingImage,
  IMAGES_SQL_HINT,
  imagesSupported,
  isPendingPath,
  loadOptionImagePaths,
  removeFilesIfUnreferenced,
} from "@/lib/pollImages";

type Supabase = ReturnType<typeof createServiceRoleClient>;

export type NewOption = { label: string; imagePath: string | null };

// New-poll options arrive either as plain strings (the original shape) or as
// { label, imagePath } where imagePath is a picture waiting in polls/pending/.
export function parseNewOptions(input: unknown): NewOption[] | null {
  if (!Array.isArray(input) || input.length < 2) return null;
  const parsed: NewOption[] = [];
  for (const raw of input) {
    const label = typeof raw === "string" ? raw : raw?.label;
    if (typeof label !== "string" || label.trim().length === 0) return null;
    const imagePath = typeof raw === "object" && raw !== null ? raw.imagePath : null;
    if (imagePath !== null && imagePath !== undefined && !isPendingPath(imagePath)) return null;
    parsed.push({ label: label.trim(), imagePath: imagePath ?? null });
  }
  return parsed;
}

export type CreatePollResult =
  | { ok: true; pollId: string }
  | { ok: false; status: number; error: string };

// Creates a queued (scheduled) poll with its options. Shared by "Queue poll"
// and "Open now" from the form. Nothing is left half-made: if any step fails
// the poll is removed again.
export async function createPollWithOptions(
  supabase: Supabase,
  input: { question: string; options: NewOption[]; repeatDaily: boolean },
): Promise<CreatePollResult> {
  const wantsImages = input.options.some((o) => o.imagePath);
  if (wantsImages && !(await imagesSupported(supabase))) {
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

  const { data: inserted, error: optionsError } = await supabase
    .from("poll_options")
    .insert(
      input.options.map((o, index) => ({
        poll_id: poll.id,
        label: o.label,
        display_order: index,
      })),
    )
    .select("id, display_order");

  if (optionsError || !inserted) {
    await deletePollWithFiles(supabase, poll.id);
    return { ok: false, status: 500, error: optionsError?.message ?? "Failed to save the options." };
  }

  for (const row of inserted as { id: string; display_order: number }[]) {
    const pending = input.options[row.display_order]?.imagePath;
    if (!pending) continue;
    const attached = await attachPendingImage(supabase, poll.id, row.id, pending);
    if (!attached.ok) {
      await deletePollWithFiles(supabase, poll.id);
      return { ok: false, status: attached.status, error: attached.error };
    }
  }

  return { ok: true, pollId: poll.id };
}

// Removes a poll that never went live (cascade removes its options) plus any
// picture files nothing else uses.
export async function deletePollWithFiles(supabase: Supabase, pollId: string): Promise<void> {
  const { data: options } = await supabase.from("poll_options").select("id").eq("poll_id", pollId);
  const ids = (options ?? []).map((o: { id: string }) => o.id);
  const paths = await loadOptionImagePaths(supabase, [pollId]);
  await supabase.from("polls").delete().eq("id", pollId);
  if (paths && ids.length > 0) {
    await removeFilesIfUnreferenced(supabase, ids.map((id) => paths.get(id)));
  }
}
