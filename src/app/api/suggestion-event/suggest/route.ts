import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { submitNameSuggestion } from "@/lib/data/events";
import { getClientIp } from "@/lib/ip";
import { allowAttempt } from "@/lib/rateLimit";
import { cleanNameInput } from "@/lib/nameNormalize";
import {
  EVENT_NAME_MAX_LENGTH,
  EVENT_RATE_LIMIT_MAX,
  EVENT_RATE_LIMIT_WINDOW_MS,
} from "@/config/constants";

// A visitor's name idea for the event that is active on that event's own
// stream (like a vote, the event id says which stream). The rate-limit budget
// is shared by every stream.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const eventId = typeof body?.eventId === "string" ? body.eventId : "";
  const frogId = typeof body?.frogId === "string" ? body.frogId : "";
  const text = typeof body?.text === "string" ? cleanNameInput(body.text) : "";
  // Hidden field real visitors never see or fill; a non-empty value means a bot.
  const honeypot = typeof body?.website === "string" ? body.website.trim() : "";

  const supabase = createServiceRoleClient();
  const ip = getClientIp(request);

  // Every attempt counts, including ones rejected below.
  const allowed = await allowAttempt(
    supabase,
    ip,
    "name-event",
    EVENT_RATE_LIMIT_MAX,
    EVENT_RATE_LIMIT_WINDOW_MS,
  );
  if (!allowed) {
    return NextResponse.json(
      { error: "You've sent a lot of ideas recently. Please try again later." },
      { status: 429 },
    );
  }

  // Silently accept-and-drop honeypot hits so a bot can't tell it was caught.
  if (honeypot.length > 0) {
    return NextResponse.json({ ok: true });
  }

  if (text.length === 0) {
    return NextResponse.json({ error: "Please type a name idea first." }, { status: 400 });
  }
  if (text.length > EVENT_NAME_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Keep it to ${EVENT_NAME_MAX_LENGTH} characters or fewer.` },
      { status: 400 },
    );
  }

  const result = await submitNameSuggestion(supabase, { eventId, frogId, text });
  if (!result.ok) {
    return NextResponse.json(result.code ? { error: result.error, code: result.code } : { error: result.error }, {
      status: result.status,
    });
  }
  return NextResponse.json({ ok: true });
}
