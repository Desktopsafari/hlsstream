import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { pollId, optionId, sessionId } = body ?? {};

  if (
    typeof pollId !== "string" ||
    typeof optionId !== "string" ||
    typeof sessionId !== "string" ||
    !pollId ||
    !optionId ||
    !sessionId
  ) {
    return NextResponse.json({ error: "Missing pollId, optionId, or sessionId" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data: poll } = await supabase
    .from("polls")
    .select("id, status")
    .eq("id", pollId)
    .maybeSingle();

  if (!poll || poll.status !== "open") {
    return NextResponse.json({ error: "This poll isn't open for voting." }, { status: 400 });
  }

  const { data: option } = await supabase
    .from("poll_options")
    .select("id")
    .eq("id", optionId)
    .eq("poll_id", pollId)
    .maybeSingle();

  if (!option) {
    return NextResponse.json({ error: "Invalid option." }, { status: 400 });
  }

  const { error } = await supabase.from("votes").insert({
    poll_id: pollId,
    option_id: optionId,
    session_id: sessionId,
  });

  if (error) {
    // Unique constraint violation (poll_id, session_id) -> already voted.
    if (error.code === "23505") {
      return NextResponse.json({ error: "You've already voted in this poll." }, { status: 409 });
    }
    console.error("Vote insert failed:", error.message);
    return NextResponse.json({ error: "Failed to record vote." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
