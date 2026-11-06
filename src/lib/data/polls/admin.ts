import type { createServiceRoleClient } from "@/lib/supabase/server";
import { DURATION_SQL_HINT, isDailyColumns, type DurationColumns } from "@/lib/pollDuration";
import { durationColumnsExist } from "@/lib/data/polls/timing";
import {
  attachPendingImage,
  IMAGES_SQL_HINT,
  imagesSupported,
  isPendingPath,
  loadPollImagePaths,
  removeFileIfUnreferenced,
} from "@/lib/data/polls/images";
import type { PollStream, StreamId } from "@/lib/data/streams";

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

export const POLLS_OFF_ERROR = "Polls are turned off for this stream.";

type CreatePollResult =
  | { ok: true; pollId: string }
  | { ok: false; status: number; error: string };

// Creates a queued (scheduled) poll with its options and optional picture.
// Shared by "Queue poll" and "Open now" from the form. Nothing is left
// half-made: if any step fails the poll is removed again. The poll is created
// on the given stream, and refused if that stream has polls turned off.
export async function createPollWithOptions(
  supabase: Supabase,
  stream: PollStream,
  input: {
    question: string;
    options: string[];
    repeatDaily: boolean;
    imagePath?: string | null;
    duration?: DurationColumns;
  },
): Promise<CreatePollResult> {
  if (!stream.polls_enabled) return { ok: false, status: 409, error: POLLS_OFF_ERROR };
  if (input.imagePath && !(await imagesSupported(supabase))) {
    return { ok: false, status: 400, error: IMAGES_SQL_HINT };
  }
  // A chosen duration needs its columns; the normal daily poll never does.
  const longDuration = input.duration && !isDailyColumns(input.duration) ? input.duration : null;
  if (longDuration && !(await durationColumnsExist(supabase))) {
    return { ok: false, status: 400, error: DURATION_SQL_HINT };
  }

  const { data: poll, error: pollError } = await supabase
    .from("polls")
    .insert({
      stream_id: stream.id,
      question: input.question.trim(),
      status: "scheduled",
      repeat_daily: input.repeatDaily,
      ...(longDuration ?? {}),
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
    await deletePollWithFiles(supabase, stream.id, poll.id);
    return { ok: false, status: 500, error: optionsError.message };
  }

  if (input.imagePath) {
    const attached = await attachPendingImage(supabase, stream.id, poll.id, input.imagePath);
    if (!attached.ok) {
      await deletePollWithFiles(supabase, stream.id, poll.id);
      return { ok: false, status: attached.status, error: attached.error };
    }
  }

  return { ok: true, pollId: poll.id };
}

// Removes a poll that never went live (cascade removes its options) plus its
// picture file if no other poll uses it. Only a poll of the given stream.
export async function deletePollWithFiles(supabase: Supabase, streamId: StreamId, pollId: string): Promise<void> {
  const { data: owned } = await supabase.from("polls").select("id").eq("id", pollId).eq("stream_id", streamId).maybeSingle();
  if (!owned) return;
  const paths = await loadPollImagePaths(supabase, [pollId]);
  await supabase.from("polls").delete().eq("id", pollId).eq("stream_id", streamId);
  const path = paths?.get(pollId);
  if (path) await removeFileIfUnreferenced(supabase, path);
}
