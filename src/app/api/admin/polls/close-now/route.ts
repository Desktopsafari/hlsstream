import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { closePollAndFinish } from "@/lib/pollLifecycle";

// Closes an open poll right now: voting stops, the results email goes out
// immediately (once), and a repeating or paused daily poll is handled exactly
// as if the poll had ended on its own. Safe against double clicks: the status
// flip only succeeds for the first request; any other gets "already closed"
// and sends nothing.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const pollId = typeof body?.pollId === "string" ? body.pollId : "";
  if (!pollId) return NextResponse.json({ error: "Missing pollId." }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data: poll } = await supabase
    .from("polls")
    .select("id, question, status, repeat_daily")
    .eq("id", pollId)
    .maybeSingle();
  if (!poll) return NextResponse.json({ error: "Poll not found." }, { status: 404 });
  if (poll.status !== "open") {
    return NextResponse.json(
      { error: poll.status === "closed" ? "That poll is already closed." : "That poll isn't open.", code: "not_open" },
      { status: 409 },
    );
  }

  const outcome = await closePollAndFinish(supabase, poll);
  if (outcome.state === "error") {
    return NextResponse.json({ error: "Couldn't close the poll." }, { status: 500 });
  }
  if (outcome.state === "already_closed") {
    return NextResponse.json({ error: "That poll was just closed.", code: "not_open" }, { status: 409 });
  }
  console.log(`Poll ${poll.id} closed early by the admin`);
  return NextResponse.json({
    ok: true,
    message: `Closed "${poll.question}" and emailed its results.${outcome.repeatMessage}`,
  });
}
