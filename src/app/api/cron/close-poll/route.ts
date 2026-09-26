import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { sendPollResultsEmail } from "@/lib/email";

// Triggered daily by Vercel Cron at a fixed UTC time approximating 8pm
// Eastern -- see vercel.json for the schedule and the DST note there.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: openPoll } = await supabase
    .from("polls")
    .select("id, question, repeat_daily")
    .eq("status", "open")
    .order("opens_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!openPoll) {
    return NextResponse.json({ message: "No open poll to close." });
  }

  const { error } = await supabase
    .from("polls")
    .update({ status: "closed", closes_at: new Date().toISOString() })
    .eq("id", openPoll.id);

  if (error) {
    console.error("Failed to close poll:", error.message);
    return NextResponse.json({ error: "Failed to close poll" }, { status: 500 });
  }

  const { data: results } = await supabase
    .from("poll_results")
    .select("label, vote_count")
    .eq("poll_id", openPoll.id);

  await sendPollResultsEmail(openPoll.question, results ?? []);

  let repeatMessage = "";
  if (openPoll.repeat_daily) {
    repeatMessage = await continueRepeatingPoll(supabase, openPoll.id, openPoll.question);
  }

  return NextResponse.json({
    message: `Poll closed and results emailed.${repeatMessage}`,
    pollId: openPoll.id,
  });
}

// Runs after a repeat_daily poll closes. Mirrors the same "only one poll
// scheduled at a time" rule the admin create endpoint enforces: if the
// admin already manually queued a different poll for the next cycle (which
// can only have happened while this poll was still open, since a poll
// can't be queued once one is already scheduled), that manual choice wins.
// The repeating poll is marked repeat_paused instead of silently losing its
// flag, so the admin panel can explain what happened.
async function continueRepeatingPoll(
  supabase: ReturnType<typeof createServiceRoleClient>,
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

  const { data: nextPoll, error: insertError } = await supabase
    .from("polls")
    .insert({
      question,
      status: "scheduled",
      repeat_daily: true,
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
