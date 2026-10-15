import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { DURATION_SQL_HINT, emailNoteFor } from "@/lib/pollDuration";
import { formatEasternDay, parseEasternDateTime } from "@/lib/pollSchedule";
import { durationColumnsExist } from "@/lib/pollTiming";

// Change when voting ends on an open poll: later or earlier, but never into
// the past (a past end time would close the poll without its results email;
// use Close now for that). Also turns an open-ended poll into one with an end.
// The update is conditional on the poll still being open and is idempotent, so
// a double click does no harm.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const pollId = typeof body?.pollId === "string" ? body.pollId : "";
  const endsAtLocal = typeof body?.endsAtLocal === "string" ? body.endsAtLocal : "";
  if (!pollId || !endsAtLocal) {
    return NextResponse.json({ error: "Need a poll and an end time." }, { status: 400 });
  }

  const end = parseEasternDateTime(endsAtLocal);
  if (!end) return NextResponse.json({ error: "Pick an end date and time." }, { status: 400 });
  if (end.getTime() <= Date.now()) {
    return NextResponse.json(
      { error: "That time is in the past. Pick a later time, or use Close now to end the poll immediately." },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();
  if (!(await durationColumnsExist(supabase))) {
    return NextResponse.json({ error: DURATION_SQL_HINT }, { status: 400 });
  }

  const { data: poll } = await supabase
    .from("polls")
    .select("id, status, repeat_daily")
    .eq("id", pollId)
    .maybeSingle();
  if (!poll) return NextResponse.json({ error: "Poll not found." }, { status: 404 });
  if (poll.status !== "open") {
    return NextResponse.json({ error: "Only an open poll's end time can be changed here.", code: "not_open" }, { status: 409 });
  }
  if (poll.repeat_daily) {
    return NextResponse.json(
      { error: "This poll repeats daily. Turn off Repeat daily (Edit) before giving it a different end time." },
      { status: 409 },
    );
  }

  const { data: updated, error } = await supabase
    .from("polls")
    .update({ ends_at: end.toISOString(), open_ended: false })
    .eq("id", pollId)
    .eq("status", "open")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "That poll just closed.", code: "not_open" }, { status: 409 });
  }

  console.log(`Poll ${pollId} end time set to ${end.toISOString()} by the admin`);
  return NextResponse.json({
    ok: true,
    endsAt: end.toISOString(),
    message: `Voting now ends ${formatEasternDay(end, "long")} ET.`,
    emailNote: emailNoteFor(end),
  });
}
