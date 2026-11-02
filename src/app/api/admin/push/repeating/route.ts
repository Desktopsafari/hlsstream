import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { STREAM_ID } from "@/config/constants";
import { easternDate, parseRepeatingInput, type RepeatingRule } from "@/lib/push";
import { REPEATING_COLUMNS, categoryExists, nextFor } from "@/lib/pushAdmin";

// Repeating notifications. Every change works out next_send_at again (in
// Eastern Time), which is what the every-minute job looks at.

async function load(supabase: ReturnType<typeof createServiceRoleClient>, id: unknown) {
  if (typeof id !== "string" || !id) return null;
  const { data } = await supabase.from("push_repeating").select(REPEATING_COLUMNS).eq("id", id).maybeSingle();
  return data as (RepeatingRule & { id: string }) | null;
}

export async function POST(request: Request) {
  const parsed = parseRepeatingInput(await request.json().catch(() => null), new URL(request.url).host);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const supabase = createServiceRoleClient();
  if (!(await categoryExists(supabase, parsed.value.category_id))) {
    return NextResponse.json({ error: "That category doesn't exist." }, { status: 400 });
  }
  const now = new Date();
  const fields = { ...parsed.value, skip_date: null, last_sent_date: null };
  const { error } = await supabase.from("push_repeating").insert({
    ...fields,
    stream_id: STREAM_ID,
    next_send_at: nextFor(fields, now),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = parseRepeatingInput(body, new URL(request.url).host);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const supabase = createServiceRoleClient();
  const existing = await load(supabase, body?.id);
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!(await categoryExists(supabase, parsed.value.category_id))) {
    return NextResponse.json({ error: "That category doesn't exist." }, { status: 400 });
  }
  const now = new Date();
  const rule = { ...existing, ...parsed.value };
  const { error } = await supabase
    .from("push_repeating")
    .update({ ...parsed.value, next_send_at: nextFor(rule, now), updated_at: now.toISOString() })
    .eq("id", existing.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// action "skip" (skip today), "unskip" (undo), "active" (with isActive).
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const supabase = createServiceRoleClient();
  const existing = await load(supabase, body?.id);
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const now = new Date();
  const changes: Partial<RepeatingRule> = {};
  if (body?.action === "skip") changes.skip_date = easternDate(now);
  else if (body?.action === "unskip") changes.skip_date = null;
  else if (body?.action === "active" && typeof body?.isActive === "boolean") changes.is_active = body.isActive;
  else return NextResponse.json({ error: "Unknown action." }, { status: 400 });

  const { error } = await supabase
    .from("push_repeating")
    .update({ ...changes, next_send_at: nextFor({ ...existing, ...changes }, now), updated_at: now.toISOString() })
    .eq("id", existing.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  const { error } = await createServiceRoleClient().from("push_repeating").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
