import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createPollWithOptions, parseNewOptions, parsePendingImage } from "@/lib/pollAdmin";
import { imagesSupported, loadPollImagePaths, pollImageUrl } from "@/lib/pollImages";
import {
  DAILY_COLUMNS,
  DURATION_SQL_HINT,
  isDailyColumns,
  resolveDuration,
  type DurationColumns,
} from "@/lib/pollDuration";
import { durationColumnsExist } from "@/lib/pollTiming";
import { easternHour, getNextNoon, getPollState, isLongPoll } from "@/lib/pollSchedule";

export async function GET() {
  const supabase = createServiceRoleClient();

  // ends_at / open_ended / duration_days exist once supabase/poll_duration.sql has been run.
  const durationsAvailable = await durationColumnsExist(supabase);
  const { data: pollRows, error } = await supabase
    .from("polls")
    .select(
      `id, question, status, opens_at, closes_at, created_at, repeat_daily, repeat_paused${
        durationsAvailable ? ", ends_at, open_ended, duration_days" : ""
      }`,
    )
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const polls = pollRows as unknown as {
    id: string; question: string; status: string; opens_at: string; closes_at: string; created_at: string;
    repeat_daily: boolean; repeat_paused: boolean;
    ends_at?: string | null; open_ended?: boolean | null; duration_days?: number | null;
  }[];

  const pollIds = polls.map((p) => p.id);
  const { data: results } = await supabase
    .from("poll_results")
    .select("poll_id, option_id, label, display_order, vote_count")
    .in("poll_id", pollIds.length > 0 ? pollIds : ["00000000-0000-0000-0000-000000000000"]);

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
    // The daily open always lands in the noon hour (Eastern). A poll that went
    // live at any other time was started by hand with "Open now".
    opened_early: poll.status !== "scheduled" && easternHour(poll.opens_at) !== 12,
    options: (results ?? [])
      .filter((r) => r.poll_id === poll.id)
      .sort((a, b) => a.display_order - b.display_order),
  }));

  return NextResponse.json({
    polls: pollsWithResults,
    imagesSupported: picturesAvailable,
    durationsSupported: durationsAvailable,
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const question = body?.question;
  const options = parseNewOptions(body?.options);
  const imagePath = parsePendingImage(body?.imagePath);
  const repeatDaily = body?.repeatDaily === true;

  if (typeof question !== "string" || question.trim().length === 0 || !options) {
    return NextResponse.json(
      { error: "Need a question and at least 2 non-empty options." },
      { status: 400 },
    );
  }
  if (imagePath === undefined) {
    return NextResponse.json({ error: "That picture isn't a valid upload." }, { status: 400 });
  }

  // How long voting runs. Omitted = the normal daily poll, exactly as before.
  const now = new Date();
  const resolved = resolveDuration(body?.duration, getNextNoon(now), now);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }
  if (repeatDaily && !isDailyColumns(resolved.columns)) {
    return NextResponse.json(
      { error: "A multi-day or open-ended poll can't repeat daily. Turn off Repeat daily or choose Today only." },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();

  const { data: existingScheduled } = await supabase
    .from("polls")
    .select("id")
    .eq("status", "scheduled")
    .limit(1)
    .maybeSingle();

  if (existingScheduled) {
    return NextResponse.json(
      { error: "There's already a scheduled poll queued up. Wait for it to open, or delete it first." },
      { status: 409 },
    );
  }

  const created = await createPollWithOptions(supabase, {
    question,
    options,
    repeatDaily,
    imagePath,
    duration: resolved.columns,
  });
  if (!created.ok) {
    return NextResponse.json({ error: created.error }, { status: created.status });
  }

  return NextResponse.json({ ok: true, pollId: created.pollId });
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
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const pollId = body?.pollId;
  const question = body?.question;
  const optionsInput: unknown = body?.options;
  const repeatDailyInput: unknown = body?.repeatDaily;

  if (typeof pollId !== "string" || !pollId) {
    return NextResponse.json({ error: "Missing pollId." }, { status: 400 });
  }
  if (typeof question !== "string" || question.trim().length === 0) {
    return NextResponse.json({ error: "The question can't be empty." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data: poll } = await supabase
    .from("polls")
    .select("id, question, status, repeat_daily")
    .eq("id", pollId)
    .maybeSingle();

  if (!poll) {
    return NextResponse.json({ error: "Poll not found." }, { status: 404 });
  }
  if (poll.status === "closed") {
    return NextResponse.json(
      { error: "This poll is closed, so it can't be edited anymore." },
      { status: 409 },
    );
  }

  // How long voting runs. Only a queued poll's duration is edited here; an
  // open poll's end is changed with "Change end time" (/polls/end-time), which
  // also refuses to move it into the past.
  const durationsAvailable = await durationColumnsExist(supabase);
  let currentDuration: DurationColumns = DAILY_COLUMNS;
  if (durationsAvailable) {
    const { data: d } = await supabase
      .from("polls")
      .select("ends_at, open_ended, duration_days")
      .eq("id", pollId)
      .maybeSingle();
    const row = d as { ends_at: string | null; open_ended: boolean | null; duration_days: number | null } | null;
    if (row) {
      currentDuration = { ends_at: row.ends_at, open_ended: !!row.open_ended, duration_days: row.duration_days };
    }
  }
  let newDuration: DurationColumns | null = null;
  if (body?.duration !== undefined) {
    if (poll.status !== "scheduled") {
      return NextResponse.json(
        { error: "A poll that is already open can't have its duration changed here. Use Change end time." },
        { status: 409 },
      );
    }
    const now = new Date();
    const resolved = resolveDuration(body.duration, getNextNoon(now), now);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }
    if (!isDailyColumns(resolved.columns) && !durationsAvailable) {
      return NextResponse.json({ error: DURATION_SQL_HINT }, { status: 400 });
    }
    newDuration = resolved.columns;
  }
  const finalRepeat = typeof repeatDailyInput === "boolean" ? repeatDailyInput : poll.repeat_daily;
  if (finalRepeat && !isDailyColumns(newDuration ?? currentDuration)) {
    return NextResponse.json(
      { error: "A multi-day or open-ended poll can't repeat daily. Turn off Repeat daily or choose Today only." },
      { status: 400 },
    );
  }

  const { data: existingOptions } = await supabase
    .from("poll_options")
    .select("id, label, display_order")
    .eq("poll_id", pollId)
    .order("display_order", { ascending: true });
  const existing = existingOptions ?? [];

  const { count: voteCount } = await supabase
    .from("votes")
    .select("id", { count: "exact", head: true })
    .eq("poll_id", pollId);
  const votes = voteCount ?? 0;

  let options: OptionInput[] | null = null;
  if (optionsInput !== undefined) {
    if (
      !Array.isArray(optionsInput) ||
      optionsInput.length < 2 ||
      optionsInput.some(
        (o) => typeof o?.label !== "string" || o.label.trim().length === 0,
      )
    ) {
      return NextResponse.json(
        { error: "A poll needs at least 2 non-empty options." },
        { status: 400 },
      );
    }
    options = optionsInput.map((o: OptionInput) => ({
      id: typeof o.id === "string" && o.id ? o.id : undefined,
      label: o.label.trim(),
    }));
  }

  const optionsChanged =
    options !== null &&
    (options.length !== existing.length ||
      options.some(
        (o, i) => o.id !== existing[i]?.id || o.label !== existing[i]?.label,
      ));

  if (votes > 0 && optionsChanged) {
    return NextResponse.json(
      {
        error: `This poll already has ${votes} vote${votes === 1 ? "" : "s"}. Options can't be added, removed, renamed, or reordered once votes exist, because that would leave existing votes pointing at options that no longer mean the same thing. You can still fix the question text.`,
        code: "options_locked",
      },
      { status: 409 },
    );
  }

  if (optionsChanged && options) {
    const existingIds = new Set(existing.map((o) => o.id));
    if (options.some((o) => o.id && !existingIds.has(o.id))) {
      return NextResponse.json(
        { error: "One of those options doesn't belong to this poll." },
        { status: 400 },
      );
    }

    const keptIds = new Set(options.filter((o) => o.id).map((o) => o.id));
    const removedIds = existing.filter((o) => !keptIds.has(o.id)).map((o) => o.id);

    if (removedIds.length > 0) {
      const { error } = await supabase.from("poll_options").delete().in("id", removedIds);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    for (let i = 0; i < options.length; i++) {
      const o = options[i];
      const result = o.id
        ? await supabase
            .from("poll_options")
            .update({ label: o.label, display_order: i })
            .eq("id", o.id)
        : await supabase
            .from("poll_options")
            .insert({ poll_id: pollId, label: o.label, display_order: i });
      if (result.error) {
        return NextResponse.json({ error: result.error.message }, { status: 500 });
      }
    }
  }

  // The repeat-daily flag never touches votes or options, so it's editable
  // regardless of the options lock above -- turning it off just means this
  // poll's current cycle finishes normally without spawning a continuation.
  const pollUpdates: { question?: string; repeat_daily?: boolean } & Partial<DurationColumns> = {};
  if (question.trim() !== poll.question) {
    pollUpdates.question = question.trim();
  }
  if (typeof repeatDailyInput === "boolean" && repeatDailyInput !== poll.repeat_daily) {
    pollUpdates.repeat_daily = repeatDailyInput;
  }

  if (newDuration && durationsAvailable) {
    Object.assign(pollUpdates, newDuration);
  }

  if (Object.keys(pollUpdates).length > 0) {
    const { error } = await supabase.from("polls").update(pollUpdates).eq("id", pollId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
