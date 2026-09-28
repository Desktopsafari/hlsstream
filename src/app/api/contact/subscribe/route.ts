import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getResendClient } from "@/lib/resend";

// Simple, deliberately non-strict format check -- Resend itself is the
// real validator (it rejects malformed addresses when we call contacts.create).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const categoryIds: unknown = body?.categoryIds;

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!Array.isArray(categoryIds) || categoryIds.length === 0 || categoryIds.some((c) => typeof c !== "string")) {
    return NextResponse.json({ error: "Pick at least one category." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data: categories, error } = await supabase
    .from("notification_categories")
    .select("id, resend_audience_id")
    .eq("is_active", true)
    .in("id", categoryIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!categories || categories.length === 0) {
    return NextResponse.json({ error: "Those categories aren't available anymore." }, { status: 400 });
  }

  const resend = getResendClient();
  if (!resend) {
    return NextResponse.json({ error: "Email signup isn't configured right now." }, { status: 500 });
  }

  const results = await Promise.all(
    categories.map((c) =>
      resend.contacts.create({
        email,
        segments: [{ id: c.resend_audience_id }],
      }),
    ),
  );

  const failed = results.find((r) => r.error);
  if (failed?.error) {
    console.error("Failed to add contact:", failed.error);
    return NextResponse.json({ error: "Failed to sign up, please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
