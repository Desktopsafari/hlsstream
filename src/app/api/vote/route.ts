import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { castVote } from "@/lib/data/polls";

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

  const result = await castVote(createServiceRoleClient(), { pollId, optionId, sessionId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
