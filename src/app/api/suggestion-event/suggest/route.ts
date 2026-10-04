import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getActiveEvent } from "@/lib/events";
import { getClientIp } from "@/lib/ip";
import { allowAttempt } from "@/lib/rateLimit";
import { containsProfanity } from "@/lib/profanity";
import { cleanNameInput, normalizeName } from "@/lib/nameNormalize";
import {
  EVENT_NAME_MAX_LENGTH,
  EVENT_RATE_LIMIT_MAX,
  EVENT_RATE_LIMIT_WINDOW_MS,
} from "@/config/constants";

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

  // Checked here (not just when the card rendered) so a stale open tab can't
  // submit after the event ends or is switched off.
  const active = await getActiveEvent(supabase);
  if (!active || active.event.id !== eventId) {
    return NextResponse.json(
      { error: "Name suggestions aren't open right now.", code: "event_closed" },
      { status: 409 },
    );
  }
  if (!active.frogs.some((f) => f.id === frogId)) {
    return NextResponse.json({ error: "That frog isn't part of this event." }, { status: 400 });
  }

  const normalized = normalizeName(text);
  if (normalized.length === 0) {
    return NextResponse.json({ error: "Please type a name idea first." }, { status: 400 });
  }

  // The word list matches inside words, so it can catch innocent names.
  // Flag rather than reject; flagged ideas are hidden in admin by default.
  const { error } = await supabase.from("name_suggestions").insert({
    event_id: eventId,
    frog_id: frogId,
    text,
    normalized_text: normalized,
    is_flagged: containsProfanity(text),
  });
  if (error) {
    console.error("Failed to save name suggestion:", error.message);
    return NextResponse.json({ error: "Couldn't save that, please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
