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
