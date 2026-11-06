import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { setPollEndTime } from "@/lib/data/polls";
import { emailNoteFor } from "@/lib/pollDuration";
import { formatEasternDay, parseEasternDateTime } from "@/lib/pollSchedule";

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

  const result = await setPollEndTime(createServiceRoleClient(), pollId, end);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    endsAt: end.toISOString(),
    message: `Voting now ends ${formatEasternDay(end, "long")} ET.`,
    emailNote: emailNoteFor(end),
  });
}
