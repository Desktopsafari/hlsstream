import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { closePollNow } from "@/lib/data/polls";

// Closes an open poll right now (see closePollNow in src/lib/data/polls/manage.ts).
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const pollId = typeof body?.pollId === "string" ? body.pollId : "";
  if (!pollId) return NextResponse.json({ error: "Missing pollId." }, { status: 400 });

  const result = await closePollNow(createServiceRoleClient(), pollId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  return NextResponse.json({ ok: true, message: result.message });
}
