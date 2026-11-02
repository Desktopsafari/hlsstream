import { NextResponse } from "next/server";
import { cleanEndpoint } from "@/lib/push";
import { openPublicPushRequest, pushDbError } from "@/lib/pushPublic";

// Whether this device's subscription is still on file, and its categories,
// so the modal can show "Notifications are on for this device".
export async function POST(request: Request) {
  const opened = await openPublicPushRequest(request);
  if (opened instanceof NextResponse) return opened;
  const { supabase, body } = opened;

  const endpoint = cleanEndpoint(body.endpoint);
  if (!endpoint) return NextResponse.json({ error: "That subscription isn't valid." }, { status: 400 });
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("category_ids")
    .eq("endpoint", endpoint)
    .maybeSingle();
  if (error) return pushDbError(error);
  const row = data as { category_ids: string[] } | null;
  return NextResponse.json({ subscribed: !!row, categoryIds: row?.category_ids ?? [] });
}
