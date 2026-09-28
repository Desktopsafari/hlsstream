import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getResendClient } from "@/lib/resend";
import { SITE_NAME } from "@/config/constants";

const PAGE_SIZE = 100;
const MAX_PAGES = 20; // safety cap -- 2000 contacts is far past this site's scale

async function countSubscribers(
  resend: NonNullable<ReturnType<typeof getResendClient>>,
  audienceId: string,
) {
  let count = 0;
  let after: string | undefined;
  let approxOnly = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await resend.contacts.list({
      segmentId: audienceId,
      limit: PAGE_SIZE,
      ...(after ? { after } : {}),
    });
    if (error || !data) break;

    count += data.data.length;
    if (!data.has_more) {
      after = undefined;
      break;
    }
    after = data.data[data.data.length - 1]?.id;
    if (page === MAX_PAGES - 1) approxOnly = true;
  }

  return { count, approxOnly };
}

// Preview step: how many subscribers would this send reach.
export async function GET(request: Request) {
  const categoryId = new URL(request.url).searchParams.get("categoryId");
  if (!categoryId) {
    return NextResponse.json({ error: "Missing categoryId." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data: category } = await supabase
    .from("notification_categories")
    .select("resend_audience_id")
    .eq("id", categoryId)
    .maybeSingle();

  if (!category) {
    return NextResponse.json({ error: "Category not found." }, { status: 404 });
  }

  const resend = getResendClient();
  if (!resend) {
    return NextResponse.json({ error: "Email isn't configured right now." }, { status: 500 });
  }

  const { count, approxOnly } = await countSubscribers(resend, category.resend_audience_id);
  return NextResponse.json({ count, approxOnly });
}

// Actually sends the broadcast -- no separate draft/confirm state on
// Resend's side, so the admin UI's own confirm step is what stands between
// filling this out and a real send to real subscribers.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const categoryId = body?.categoryId;
  const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  if (typeof categoryId !== "string" || !categoryId) {
    return NextResponse.json({ error: "Missing categoryId." }, { status: 400 });
  }
  if (subject.length === 0 || subject.length > 200) {
    return NextResponse.json({ error: "Subject is required (200 characters max)." }, { status: 400 });
  }
  if (message.length === 0) {
    return NextResponse.json({ error: "Message can't be empty." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data: category } = await supabase
    .from("notification_categories")
    .select("resend_audience_id, display_name")
    .eq("id", categoryId)
    .maybeSingle();

  if (!category) {
    return NextResponse.json({ error: "Category not found." }, { status: 404 });
  }

  const resend = getResendClient();
  if (!resend) {
    return NextResponse.json({ error: "Email isn't configured right now." }, { status: 500 });
  }

  const { error } = await resend.broadcasts.create({
    segmentId: category.resend_audience_id,
    from: `${SITE_NAME} <updates@mail.desktopsafari.com>`,
    subject,
    text: message,
    send: true,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
