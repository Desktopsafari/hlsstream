import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendSuggestionEmail } from "@/lib/email";
import { getClientIp } from "@/lib/ip";
import { allowAttempt } from "@/lib/rateLimit";

const MAX_MESSAGE_LENGTH = 2000;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  // Hidden field real visitors never see or fill; a non-empty value means a bot.
  const honeypot = typeof body?.website === "string" ? body.website.trim() : "";

  const supabase = createServiceRoleClient();
  const ip = getClientIp(request);

  const allowed = await allowAttempt(supabase, ip, "contact", RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many submissions from this connection recently. Try again later." },
      { status: 429 },
    );
  }

  // Silently accept-and-drop honeypot hits so a bot can't tell it was caught.
  if (honeypot.length > 0) {
    return NextResponse.json({ ok: true });
  }

  if (message.length === 0) {
    return NextResponse.json({ error: "Message can't be empty." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).` },
      { status: 400 },
    );
  }

  const { error } = await supabase.from("suggestions").insert({ message });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await sendSuggestionEmail(message);

  return NextResponse.json({ ok: true });
}
