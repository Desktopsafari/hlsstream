import type { createServiceRoleClient } from "@/lib/supabase/server";
import { DURATION_SQL_HINT, isDailyColumns, resolveDuration, type DurationColumns } from "@/lib/pollDuration";
import { easternHour, getNextNoon, getPollState, isLongPoll } from "@/lib/pollSchedule";
import { closePollAndFinish } from "@/lib/data/polls/close";
import { imagesSupported, loadPollImagePaths, pollImageUrl } from "@/lib/data/polls/images";
import { DURATION_COLS, durationColumnsExist, loadPollDuration } from "@/lib/data/polls/timing";
import { getPollVisibility, hideColumnsExist, loadAutoHideHours } from "@/lib/data/polls/visibility";
import { countVotes, loadResultsForPolls } from "@/lib/data/polls/votes";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// The admin history, editing, Close now and Change end time.

export type AdminResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; status: number; error: string; code?: string };

// The latest 20 polls with their results, picture, timing and visibility, plus
// which optional features the database supports.
export async function listAdminPolls(supabase: Supabase): Promise<AdminResult<{ body: Record<string, unknown> }>> {
  // ends_at / open_ended / duration_days exist once supabase/poll_duration.sql has been run.
  const durationsAvailable = await durationColumnsExist(supabase);
  // hidden_at / force_shown exist once supabase/poll_hide.sql has been run.
  const hideAvailable = await hideColumnsExist(supabase);
  const { data: pollRows, error } = await supabase
    .from("polls")
    .select(
      `id, question, status, opens_at, closes_at, created_at, repeat_daily, repeat_paused${
        durationsAvailable ? DURATION_COLS : ""
      }${hideAvailable ? ", hidden_at, force_shown" : ""}`,
    )
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return { ok: false, status: 500, error: error.message };
  const polls = pollRows as unknown as {
    id: string; question: string; status: string; opens_at: string; closes_at: string; created_at: string;
    repeat_daily: boolean; repeat_paused: boolean;
    ends_at?: string | null; open_ended?: boolean | null; duration_days?: number | null;
    hidden_at?: string | null; force_shown?: boolean | null;
  }[];
  const autoHide = hideAvailable ? await loadAutoHideHours(supabase) : { supported: false, hours: null };
  const now = new Date();

  const pollIds = polls.map((p) => p.id);
  const results = await loadResultsForPolls(supabase, pollIds);

  // The poll picture needs supabase/poll_question_image.sql; until it's run
  // there is no column to read and every poll simply has no picture.
  const picturesAvailable = await imagesSupported(supabase);
  const imagePaths = picturesAvailable ? await loadPollImagePaths(supabase, pollIds) : null;

  const pollsWithResults = polls.map((poll) => ({
    ...poll,
    ends_at: poll.ends_at ?? null,
    open_ended: !!poll.open_ended,
    duration_days: poll.duration_days ?? null,
    // When voting ends for an open poll: its end instant, or null for no end.
    voting_end: getPollState(poll).end?.toISOString() ?? null,
    is_long: isLongPoll(poll),
    image_url: pollImageUrl(imagePaths?.get(poll.id) ?? null),
    // Whether visitors can see it (closed polls can be hidden by hand or by
    // the auto-hide timer); see src/lib/data/polls/visibility.ts.
    visibility: hideAvailable ? getPollVisibility(poll, autoHide.hours, now) : { hidden: false, hideAt: null },
    force_shown: !!poll.force_shown,
    // The daily open always lands in the noon hour (Eastern). A poll that went
    // live at any other time was started by hand with "Open now".
    opened_early: poll.status !== "scheduled" && easternHour(poll.opens_at) !== 12,
    options: results
      .filter((r) => r.poll_id === poll.id)
      .sort((a, b) => a.display_order - b.display_order),
  }));

  return {
    ok: true,
    body: {
      polls: pollsWithResults,
      imagesSupported: picturesAvailable,
      durationsSupported: durationsAvailable,
      hideSupported: hideAvailable && autoHide.supported,
      autoHideHours: autoHide.hours,
    },
  };
}

// Only one poll waits in the queue at a time.
export async function hasScheduledPoll(supabase: Supabase): Promise<boolean> {
  const { data: existingScheduled } = await supabase
    .from("polls")
    .select("id")
    .eq("status", "scheduled")
    .limit(1)
    .maybeSingle();
  return !!existingScheduled;
}

type OptionInput = { id?: string; label: string };

// Edit a queued or open poll.
// - No votes yet: question and options can be changed freely.
// - Has votes: only the question text may change. Changing options would
//   orphan or misattribute the existing votes, so that's refused with an
//   explanation rather than silently allowed or silently ignored.
// - Closed: read-only.
// The poll's picture follows the question's rule -- editable while the poll is
// queued or open (even with votes), never once it's closed -- and is changed
// through /api/admin/polls/image rather than here.
export async function editPoll(
  supabase: Supabase,
  input: { pollId: string; question: string; options: unknown; repeatDaily: unknown; duration: unknown },
): Promise<AdminResult> {
  const { pollId, question } = input;
  const optionsInput = input.options;
  const repeatDailyInput = input.repeatDaily;

  const { data: poll } = await supabase
    .from("polls")
    .select("id, question, status, repeat_daily")
    .eq("id", pollId)
    .maybeSingle();

  if (!poll) return { ok: false, status: 404, error: "Poll not found." };
  if (poll.status === "closed") {
    return { ok: false, status: 409, error: "This poll is closed, so it can't be edited anymore." };
  }

  // How long voting runs. Only a queued poll's duration is edited here; an
  // open poll's end is changed with "Change end time" (/polls/end-time), which
  // also refuses to move it into the past.
  const durationsAvailable = await durationColumnsExist(supabase);
  const { cols: currentDuration } = await loadPollDuration(supabase, pollId);
  let newDuration: DurationColumns | null = null;
  if (input.duration !== undefined) {
    if (poll.status !== "scheduled") {
      return {
        ok: false,
        status: 409,
        error: "A poll that is already open can't have its duration changed here. Use Change end time.",
      };
    }
    const now = new Date();
    const resolved = resolveDuration(input.duration, getNextNoon(now), now);
    if (!resolved.ok) return { ok: false, status: 400, error: resolved.error };
    if (!isDailyColumns(resolved.columns) && !durationsAvailable) {
      return { ok: false, status: 400, error: DURATION_SQL_HINT };
    }
    newDuration = resolved.columns;
  }
  const finalRepeat = typeof repeatDailyInput === "boolean" ? repeatDailyInput : poll.repeat_daily;
  if (finalRepeat && !isDailyColumns(newDuration ?? currentDuration)) {
    return {
      ok: false,
      status: 400,
      error: "A multi-day or open-ended poll can't repeat daily. Turn off Repeat daily or choose Today only.",
    };
  }

  const { data: existingOptions } = await supabase
    .from("poll_options")
    .select("id, label, display_order")
    .eq("poll_id", pollId)
    .order("display_order", { ascending: true });
  const existing = existingOptions ?? [];

  const votes = await countVotes(supabase, pollId);

  let options: OptionInput[] | null = null;
  if (optionsInput !== undefined) {
    if (
      !Array.isArray(optionsInput) ||
      optionsInput.length < 2 ||
      optionsInput.some((o) => typeof o?.label !== "string" || o.label.trim().length === 0)
    ) {
      return { ok: false, status: 400, error: "A poll needs at least 2 non-empty options." };
    }
    options = optionsInput.map((o: OptionInput) => ({
      id: typeof o.id === "string" && o.id ? o.id : undefined,
      label: o.label.trim(),
    }));
  }

  const optionsChanged =
    options !== null &&
    (options.length !== existing.length ||
      options.some((o, i) => o.id !== existing[i]?.id || o.label !== existing[i]?.label));

  if (votes > 0 && optionsChanged) {
    return {
      ok: false,
      status: 409,
      code: "options_locked",
      error: `This poll already has ${votes} vote${votes === 1 ? "" : "s"}. Options can't be added, removed, renamed, or reordered once votes exist, because that would leave existing votes pointing at options that no longer mean the same thing. You can still fix the question text.`,
    };
  }

  if (optionsChanged && options) {
    const existingIds = new Set(existing.map((o) => o.id));
    if (options.some((o) => o.id && !existingIds.has(o.id))) {
      return { ok: false, status: 400, error: "One of those options doesn't belong to this poll." };
    }

    const keptIds = new Set(options.filter((o) => o.id).map((o) => o.id));
    const removedIds = existing.filter((o) => !keptIds.has(o.id)).map((o) => o.id);

    if (removedIds.length > 0) {
      const { error } = await supabase.from("poll_options").delete().in("id", removedIds);
      if (error) return { ok: false, status: 500, error: error.message };
    }

    for (let i = 0; i < options.length; i++) {
      const o = options[i];
      const result = o.id
        ? await supabase.from("poll_options").update({ label: o.label, display_order: i }).eq("id", o.id)
        : await supabase.from("poll_options").insert({ poll_id: pollId, label: o.label, display_order: i });
      if (result.error) return { ok: false, status: 500, error: result.error.message };
    }
  }

  // The repeat-daily flag never touches votes or options, so it's editable
  // regardless of the options lock above -- turning it off just means this
  // poll's current cycle finishes normally without spawning a continuation.
  const pollUpdates: { question?: string; repeat_daily?: boolean } & Partial<DurationColumns> = {};
  if (question.trim() !== poll.question) pollUpdates.question = question.trim();
  if (typeof repeatDailyInput === "boolean" && repeatDailyInput !== poll.repeat_daily) {
    pollUpdates.repeat_daily = repeatDailyInput;
  }
  if (newDuration && durationsAvailable) Object.assign(pollUpdates, newDuration);

  if (Object.keys(pollUpdates).length > 0) {
    const { error } = await supabase.from("polls").update(pollUpdates).eq("id", pollId);
    if (error) return { ok: false, status: 500, error: error.message };
  }
  return { ok: true };
}

// Closes an open poll right now: voting stops, the results email goes out
// immediately (once), and a repeating or paused daily poll is handled exactly
// as if the poll had ended on its own. Safe against double clicks: the status
// flip only succeeds for the first request; any other gets "already closed"
// and sends nothing.
export async function closePollNow(supabase: Supabase, pollId: string): Promise<AdminResult<{ message: string }>> {
  const { data: poll } = await supabase
    .from("polls")
    .select("id, question, status, repeat_daily")
    .eq("id", pollId)
    .maybeSingle();
  if (!poll) return { ok: false, status: 404, error: "Poll not found." };
  if (poll.status !== "open") {
    return {
      ok: false,
      status: 409,
      code: "not_open",
      error: poll.status === "closed" ? "That poll is already closed." : "That poll isn't open.",
    };
  }

  const outcome = await closePollAndFinish(supabase, poll);
  if (outcome.state === "error") return { ok: false, status: 500, error: "Couldn't close the poll." };
  if (outcome.state === "already_closed") {
    return { ok: false, status: 409, code: "not_open", error: "That poll was just closed." };
  }
  console.log(`Poll ${poll.id} closed early by the admin`);
  return { ok: true, message: `Closed "${poll.question}" and emailed its results.${outcome.repeatMessage}` };
}

// Change when voting ends on an open poll (the route has already checked the
// time is in the future). Conditional on the poll still being open and
// idempotent, so a double click does no harm.
export async function setPollEndTime(supabase: Supabase, pollId: string, end: Date): Promise<AdminResult> {
  if (!(await durationColumnsExist(supabase))) return { ok: false, status: 400, error: DURATION_SQL_HINT };

  const { data: poll } = await supabase
    .from("polls")
    .select("id, status, repeat_daily")
    .eq("id", pollId)
    .maybeSingle();
  if (!poll) return { ok: false, status: 404, error: "Poll not found." };
  if (poll.status !== "open") {
    return { ok: false, status: 409, code: "not_open", error: "Only an open poll's end time can be changed here." };
  }
  if (poll.repeat_daily) {
    return {
      ok: false,
      status: 409,
      error: "This poll repeats daily. Turn off Repeat daily (Edit) before giving it a different end time.",
    };
  }

  const { data: updated, error } = await supabase
    .from("polls")
    .update({ ends_at: end.toISOString(), open_ended: false })
    .eq("id", pollId)
    .eq("status", "open")
    .select("id");
  if (error) return { ok: false, status: 500, error: error.message };
  if (!updated || updated.length === 0) {
    return { ok: false, status: 409, code: "not_open", error: "That poll just closed." };
  }
  console.log(`Poll ${pollId} end time set to ${end.toISOString()} by the admin`);
  return { ok: true };
}
