import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Cancel a scheduled send. Only while it's still pending, so it can't race a
// send that has already been claimed.
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  const { data, error } = await createServiceRoleClient()
    .from("push_scheduled")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "It's already been sent or cancelled." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
