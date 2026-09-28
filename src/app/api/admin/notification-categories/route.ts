import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getResendClient } from "@/lib/resend";

export async function GET() {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("notification_categories")
    .select("id, display_name, resend_audience_id, is_active, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ categories: data });
}

// Creates a category and its matching Resend audience together -- the admin
// never needs to touch Resend's own dashboard to set one up.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";

  if (displayName.length === 0 || displayName.length > 80) {
    return NextResponse.json(
      { error: "Category name is required (80 characters max)." },
      { status: 400 },
    );
  }

  const resend = getResendClient();
  if (!resend) {
    return NextResponse.json({ error: "Email signup isn't configured right now." }, { status: 500 });
  }

  const { data: audience, error: audienceError } = await resend.audiences.create({
    name: displayName,
  });
  if (audienceError || !audience) {
    return NextResponse.json(
      { error: audienceError?.message ?? "Failed to create the Resend audience." },
      { status: 500 },
    );
  }

  const supabase = createServiceRoleClient();
  const { data: category, error } = await supabase
    .from("notification_categories")
    .insert({ display_name: displayName, resend_audience_id: audience.id })
    .select("id, display_name, resend_audience_id, is_active, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, category });
}

// Rename and/or activate/deactivate a category. Deactivating only hides it
// from the public signup form -- the Resend audience and its subscribers
// are left untouched.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const id = body?.id;
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : undefined;
  const isActive = typeof body?.isActive === "boolean" ? body.isActive : undefined;

  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }
  if (displayName !== undefined && (displayName.length === 0 || displayName.length > 80)) {
    return NextResponse.json(
      { error: "Category name must be 1-80 characters." },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();
  const { data: existing } = await supabase
    .from("notification_categories")
    .select("id, resend_audience_id")
    .eq("id", id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Category not found." }, { status: 404 });
  }

  if (displayName !== undefined) {
    const resend = getResendClient();
    if (resend) {
      const { error: renameError } = await resend.audiences.update(existing.resend_audience_id, {
        name: displayName,
      });
      if (renameError) {
        console.error("Failed to rename Resend audience:", renameError);
      }
    }
  }

  const updates: { display_name?: string; is_active?: boolean } = {};
  if (displayName !== undefined) updates.display_name = displayName;
  if (isActive !== undefined) updates.is_active = isActive;

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase.from("notification_categories").update(updates).eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
