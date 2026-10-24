import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { saveAutoHideHours } from "@/lib/pollVisibility";

// The "Hide closed polls after" setting: { hours: null | 6 | 12 | 24 | 48 | 72 | 168 }.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const result = await saveAutoHideHours(createServiceRoleClient(), body?.hours);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  return NextResponse.json({ ok: true, message: result.message });
}
