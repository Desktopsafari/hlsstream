import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("chat_bans")
    .select("id, session_id, ip_address, reason, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ bans: data });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const sessionId = body?.sessionId?.trim() || null;
  const ipAddress = body?.ipAddress?.trim() || null;
  const reason = body?.reason?.trim() || null;

  if (!sessionId && !ipAddress) {
    return NextResponse.json(
      { error: "Provide a session id or an IP address." },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("chat_bans").insert({
    session_id: sessionId,
    ip_address: ipAddress,
    reason,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("chat_bans").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
