import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/ip";
import { allowAttempt } from "@/lib/rateLimit";
import {
  PUSH_FORM,
  PUSH_RATE_LIMIT_MAX,
  PUSH_RATE_LIMIT_WINDOW_MS,
  isMissingPushTable,
  loadCategories,
  pushKeys,
} from "@/lib/push";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// Shared start of every public push route: push must be configured, then the
// "push" rate limit is checked (before any other validation, so junk counts).
export async function openPublicPushRequest(
  request: Request,
): Promise<{ supabase: Supabase; body: Record<string, unknown> } | NextResponse> {
  if (!pushKeys()) {
    return NextResponse.json({ error: "Notifications aren't available right now." }, { status: 503 });
  }
  const supabase = createServiceRoleClient();
  const allowed = await allowAttempt(supabase, getClientIp(request), PUSH_FORM, PUSH_RATE_LIMIT_MAX, PUSH_RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests from this connection recently. Try again later." }, { status: 429 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  return { supabase, body: body as Record<string, unknown> };
}

// Only active categories of this stream are kept; null if none are left.
export async function validCategoryIds(supabase: Supabase, ids: string[]): Promise<string[] | null | "missing"> {
  const { categories, missing, error } = await loadCategories(supabase);
  if (missing) return "missing";
  if (error) return null;
  const known = new Set(categories.map((c) => c.id));
  const kept = ids.filter((id) => known.has(id));
  return kept.length > 0 ? kept : null;
}

export function pushDbError(error: { code?: string; message?: string }) {
  if (isMissingPushTable(error)) {
    return NextResponse.json({ error: "Notifications aren't available right now." }, { status: 503 });
  }
  console.error("Push subscription error:", error.message);
  return NextResponse.json({ error: "Something went wrong, please try again." }, { status: 500 });
}
