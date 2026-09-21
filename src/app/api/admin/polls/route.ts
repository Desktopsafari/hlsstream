import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = createServiceRoleClient();

  const { data: polls, error } = await supabase
    .from("polls")
    .select("id, question, status, opens_at, closes_at, created_at")
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

  const pollsWithResults = polls.map((poll) => ({
    ...poll,
    options: (results ?? [])
      .filter((r) => r.poll_id === poll.id)
      .sort((a, b) => a.display_order - b.display_order),
  }));

  return NextResponse.json({ polls: pollsWithResults });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const question = body?.question;
  const options = body?.options;

  if (
    typeof question !== "string" ||
    question.trim().length === 0 ||
    !Array.isArray(options) ||
    options.length < 2 ||
    options.some((o) => typeof o !== "string" || o.trim().length === 0)
  ) {
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

  const { data: poll, error: pollError } = await supabase
    .from("polls")
    .insert({
      question: question.trim(),
      status: "scheduled",
      // Placeholder timestamps -- the open/close crons overwrite these
      // with the real timestamps when they actually flip the status.
      opens_at: new Date().toISOString(),
      closes_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (pollError || !poll) {
    return NextResponse.json({ error: pollError?.message ?? "Failed to create poll" }, { status: 500 });
  }

  const { error: optionsError } = await supabase.from("poll_options").insert(
    options.map((label: string, index: number) => ({
      poll_id: poll.id,
      label: label.trim(),
      display_order: index,
    })),
  );

  if (optionsError) {
    return NextResponse.json({ error: optionsError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, pollId: poll.id });
}

type OptionInput = { id?: string; label: string };

// Edit a queued or open poll.
// - No votes yet: question and options can be changed freely.
// - Has votes: only the question text may change. Changing options would
//   orphan or misattribute the existing votes, so that's refused with an
//   explanation rather than silently allowed or silently ignored.
// - Closed: read-only.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const pollId = body?.pollId;
  const question = body?.question;
  const optionsInput: unknown = body?.options;

  if (typeof pollId !== "string" || !pollId) {
    return NextResponse.json({ error: "Missing pollId." }, { status: 400 });
  }
  if (typeof question !== "string" || question.trim().length === 0) {
    return NextResponse.json({ error: "The question can't be empty." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data: poll } = await supabase
    .from("polls")
    .select("id, question, status")
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

  if (question.trim() !== poll.question) {
    const { error } = await supabase
      .from("polls")
      .update({ question: question.trim() })
      .eq("id", pollId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
