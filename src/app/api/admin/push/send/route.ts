import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { STREAM_ID } from "@/config/constants";
import { parseEasternDateTime } from "@/lib/pollSchedule";
import { cleanEndpoint, isMissingPushTable, isPushPaused, parsePushMessage, pushKeys, sendTest, sendToCategory } from "@/lib/push";
import { categoryExists } from "@/lib/pushAdmin";
import { PUSH_KEYS_HINT, PUSH_SQL_HINT } from "@/lib/pushShared";

const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

// mode "now": send to the category's subscribers right away.
// mode "at": queue a one-time send at an Eastern date and time.
// mode "test": send only to this browser's own subscription (its endpoint).
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const mode = body?.mode;
  const keys = pushKeys();
  if (!keys) return NextResponse.json({ error: PUSH_KEYS_HINT }, { status: 400 });

  // A test goes to one device, not a category.
  const parsed = parsePushMessage(mode === "test" ? { ...body, categoryId: "test" } : body, new URL(request.url).host);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { title, message, url, categoryId } = parsed.value;

  const supabase = createServiceRoleClient();
  const { error: tableError } = await supabase.from("push_settings").select("paused").limit(1);
  if (tableError) {
    return NextResponse.json({ error: isMissingPushTable(tableError) ? PUSH_SQL_HINT : tableError.message }, { status: 400 });
  }

  if (mode === "test") {
    if (await isPushPaused(supabase)) {
      return NextResponse.json({ error: "Push sending is paused. Resume it to send." }, { status: 409 });
    }
    const endpoint = cleanEndpoint(body?.endpoint);
    const counts = endpoint
      ? await sendTest(supabase, endpoint, { title, message, url, category_id: null }, keys)
      : null;
    if (!counts) {
      return NextResponse.json(
        { error: "This browser isn't subscribed. Turn on notifications with Notify me on the home page first." },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, ...counts });
  }

  if (!(await categoryExists(supabase, categoryId))) {
    return NextResponse.json({ error: "That category doesn't exist." }, { status: 400 });
  }

  if (mode === "now") {
    if (await isPushPaused(supabase)) {
      return NextResponse.json({ error: "Push sending is paused. Resume it to send." }, { status: 409 });
    }
    const counts = await sendToCategory(supabase, { title, message, url, category_id: categoryId }, "now", keys);
    return NextResponse.json({ ok: true, ...counts });
  }

  if (mode === "at") {
    const sendAt = typeof body?.sendAtLocal === "string" ? parseEasternDateTime(body.sendAtLocal) : null;
    if (!sendAt) return NextResponse.json({ error: "Pick the date and time to send (Eastern)." }, { status: 400 });
    const now = Date.now();
    if (sendAt.getTime() <= now) return NextResponse.json({ error: "That time has already passed." }, { status: 400 });
    if (sendAt.getTime() - now > MAX_AHEAD_MS) {
      return NextResponse.json({ error: "Pick a time within the next year." }, { status: 400 });
    }
    const { error } = await supabase.from("push_scheduled").insert({
      stream_id: STREAM_ID,
      title,
      message,
      url,
      category_id: categoryId,
      send_at: sendAt.toISOString(),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown send mode." }, { status: 400 });
}
