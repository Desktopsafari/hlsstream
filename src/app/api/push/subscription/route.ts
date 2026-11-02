import { NextResponse } from "next/server";
import { STREAM_ID } from "@/config/constants";
import { cleanEndpoint, parseCategoryIds, parseSubscription } from "@/lib/push";
import { openPublicPushRequest, pushDbError, validCategoryIds } from "@/lib/pushPublic";

// A browser's push subscription. Only the endpoint, its two keys and the
// chosen categories are stored: no name, email or browser ID. The endpoint is
// the subscription's only handle, and it's sent in the body, never the URL.

// Turn on (or re-save) notifications for this device.
export async function POST(request: Request) {
  const opened = await openPublicPushRequest(request);
  if (opened instanceof NextResponse) return opened;
  const { supabase, body } = opened;

  const sub = parseSubscription(body.subscription);
  if (!sub) return NextResponse.json({ error: "That subscription isn't valid." }, { status: 400 });
  const ids = parseCategoryIds(body.categoryIds);
  if (!ids) return NextResponse.json({ error: "Pick at least one category." }, { status: 400 });
  const kept = await validCategoryIds(supabase, ids);
  if (kept === "missing") return pushDbError({ code: "42P01" });
  if (!kept) return NextResponse.json({ error: "Those categories aren't available anymore." }, { status: 400 });

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      stream_id: STREAM_ID,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      category_ids: kept,
      failure_count: 0,
    },
    { onConflict: "endpoint" },
  );
  if (error) return pushDbError(error);
  return NextResponse.json({ ok: true, categoryIds: kept });
}

// Change which categories this device gets.
export async function PUT(request: Request) {
  const opened = await openPublicPushRequest(request);
  if (opened instanceof NextResponse) return opened;
  const { supabase, body } = opened;

  const endpoint = cleanEndpoint(body.endpoint);
  if (!endpoint) return NextResponse.json({ error: "That subscription isn't valid." }, { status: 400 });
  const ids = parseCategoryIds(body.categoryIds);
  if (!ids) return NextResponse.json({ error: "Pick at least one category." }, { status: 400 });
  const kept = await validCategoryIds(supabase, ids);
  if (kept === "missing") return pushDbError({ code: "42P01" });
  if (!kept) return NextResponse.json({ error: "Those categories aren't available anymore." }, { status: 400 });

  const { data, error } = await supabase
    .from("push_subscriptions")
    .update({ category_ids: kept })
    .eq("endpoint", endpoint)
    .select("id");
  if (error) return pushDbError(error);
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Notifications aren't on for this device anymore." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, categoryIds: kept });
}

// Turn off: the row is deleted.
export async function DELETE(request: Request) {
  const opened = await openPublicPushRequest(request);
  if (opened instanceof NextResponse) return opened;
  const { supabase, body } = opened;

  const endpoint = cleanEndpoint(body.endpoint);
  if (!endpoint) return NextResponse.json({ error: "That subscription isn't valid." }, { status: 400 });
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) return pushDbError(error);
  return NextResponse.json({ ok: true });
}
