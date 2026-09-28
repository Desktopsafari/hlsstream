import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Public list of active categories for the Contact page's signup form.
export async function GET() {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("notification_categories")
    .select("id, display_name")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ categories: data });
}
