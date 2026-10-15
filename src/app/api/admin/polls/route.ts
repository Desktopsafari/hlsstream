import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createPollWithOptions, parseNewOptions } from "@/lib/pollAdmin";
import {
  attachPendingImage,
  IMAGES_SQL_HINT,
  imagesSupported,
  isPendingPath,
  loadOptionImagePaths,
  pollImageUrl,
  removeFilesIfUnreferenced,
} from "@/lib/pollImages";
import { easternHour } from "@/lib/pollSchedule";

export async function GET() {
  const supabase = createServiceRoleClient();

  const { data: polls, error } = await supabase
    .from("polls")
    .select("id, question, status, opens_at, closes_at, created_at, repeat_daily, repeat_paused")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const pollIds = polls.map((p) => p.id);
  const { data: results } = await supabase
    .from("poll_results")
    .select("poll_id, option_id, label, display_order, vote_count")
    .in("poll_id", pollIds.length > 0 ? pollIds : ["00000000-0000-0000-0000-000000000000"]);

  // Pictures need supabase/poll_option_images.sql; until it's run there is no
  // column to read and everything below simply has no pictures.
  const picturesAvailable = await imagesSupported(supabase);
  const imagePaths = picturesAvailable ? await loadOptionImagePaths(supabase, pollIds) : null;

  const pollsWithResults = polls.map((poll) => ({
    ...poll,
    // The daily open always lands in the noon hour (Eastern). A poll that went
    // live at any other time was started by hand with "Open now".
    opened_early: poll.status !== "scheduled" && easternHour(poll.opens_at) !== 12,
    options: (results ?? [])
      .filter((r) => r.poll_id === poll.id)
      .sort((a, b) => a.display_order - b.display_order)
      .map((r) => {
        const path = imagePaths?.get(r.option_id) ?? null;
        return { ...r, image_url: pollImageUrl(path) };
      }),
  }));

  return NextResponse.json({ polls: pollsWithResults, imagesSupported: picturesAvailable });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const question = body?.question;
  const options = parseNewOptions(body?.options);
  const repeatDaily = body?.repeatDaily === true;

  if (typeof question !== "string" || question.trim().length === 0 || !options) {
    return NextResponse.json(
      { error: "Need a question and at least 2 non-empty options." },
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

  const created = await createPollWithOptions(supabase, { question, options, repeatDaily });
  if (!created.ok) {
    return NextResponse.json({ error: created.error }, { status: created.status });
  }

  return NextResponse.json({ ok: true, pollId: created.pollId });
}

type OptionInput = { id?: string; label: string; imagePath?: string };

// Edit a queued or open poll.
// - No votes yet: question and options can be changed freely.
// - Has votes: only the question text may change. Changing options would
//   orphan or misattribute the existing votes, so that's refused with an
//   explanation rather than silently allowed or silently ignored.
// - Closed: read-only.
// Pictures on existing options are changed through /api/admin/polls/image
// (which applies the same lock); only a brand-new option can arrive here with
// a picture, as a pending upload.
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
        (o) =>
          typeof o?.label !== "string" ||
          o.label.trim().length === 0 ||
          (o.imagePath != null && !isPendingPath(o.imagePath)),
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
      imagePath: typeof o.imagePath === "string" ? o.imagePath : undefined,
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
    if (options.some((o) => o.imagePath) && !(await imagesSupported(supabase))) {
      return NextResponse.json({ error: IMAGES_SQL_HINT }, { status: 400 });
    }

    const keptIds = new Set(options.filter((o) => o.id).map((o) => o.id));
    const removedIds = existing.filter((o) => !keptIds.has(o.id)).map((o) => o.id);

    if (removedIds.length > 0) {
      // Remember the pictures first; the files go once the rows are gone and
      // only if no other poll's option still uses them.
      const paths = await loadOptionImagePaths(supabase, [pollId]);
      const { error } = await supabase.from("poll_options").delete().in("id", removedIds);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (paths) await removeFilesIfUnreferenced(supabase, removedIds.map((id) => paths.get(id)));
    }

    for (let i = 0; i < options.length; i++) {
      const o = options[i];
      if (o.id) {
        const { error } = await supabase
          .from("poll_options")
          .update({ label: o.label, display_order: i })
          .eq("id", o.id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        continue;
      }
      const { data: created, error } = await supabase
        .from("poll_options")
        .insert({ poll_id: pollId, label: o.label, display_order: i })
        .select("id")
        .single();
      if (error || !created) {
        return NextResponse.json({ error: error?.message ?? "Failed to add the option." }, { status: 500 });
      }
      if (o.imagePath) {
        const attached = await attachPendingImage(supabase, pollId, created.id, o.imagePath);
        if (!attached.ok) {
          return NextResponse.json({ error: attached.error }, { status: attached.status });
        }
      }
    }
  }

  // The repeat-daily flag never touches votes or options, so it's editable
  // regardless of the options lock above -- turning it off just means this
  // poll's current cycle finishes normally without spawning a continuation.
  const pollUpdates: { question?: string; repeat_daily?: boolean } = {};
  if (question.trim() !== poll.question) {
    pollUpdates.question = question.trim();
  }
  if (typeof repeatDailyInput === "boolean" && repeatDailyInput !== poll.repeat_daily) {
    pollUpdates.repeat_daily = repeatDailyInput;
  }

  if (Object.keys(pollUpdates).length > 0) {
    const { error } = await supabase.from("polls").update(pollUpdates).eq("id", pollId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
