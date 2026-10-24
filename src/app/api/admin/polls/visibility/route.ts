import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { setPollHidden } from "@/lib/pollVisibility";

// "Hide from site" / "Show on site" for a closed poll. Never deletes anything.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const pollId = typeof body?.pollId === "string" ? body.pollId : "";
  const action = body?.action;
  if (!pollId || (action !== "hide" && action !== "show")) {
    return NextResponse.json({ error: "Need a pollId and an action (hide or show)." }, { status: 400 });
  }

  const result = await setPollHidden(createServiceRoleClient(), pollId, action === "hide");
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  return NextResponse.json({ ok: true, message: result.message });
}
