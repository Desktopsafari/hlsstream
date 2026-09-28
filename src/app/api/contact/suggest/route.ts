import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendSuggestionEmail } from "@/lib/email";
import { getClientIp } from "@/lib/ip";

const MAX_MESSAGE_LENGTH = 2000;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  // Hidden field real visitors never see or fill; a non-empty value means a bot.
  const honeypot = typeof body?.website === "string" ? body.website.trim() : "";

  const supabase = createServiceRoleClient();
  const ip = getClientIp(request);

  // Opportunistic cleanup -- cheap, and means this table never needs its
  // own cron job the way chat cleanup does.
  await supabase
    .from("contact_form_attempts")
    .delete()
    .lt("created_at", new Date(Date.now() - ATTEMPT_RETENTION_MS).toISOString());

  const { count } = await supabase
    .from("contact_form_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip_address", ip)
    .gt("created_at", new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString());

  if ((count ?? 0) >= RATE_LIMIT_MAX) {
    return NextResponse.json(
      { error: "Too many submissions from this connection recently. Try again later." },
      { status: 429 },
    );
  }

  await supabase.from("contact_form_attempts").insert({ ip_address: ip });

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
