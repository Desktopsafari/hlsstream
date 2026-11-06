import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { clearFrogImage, setFrogImage } from "@/lib/data/events";
import { resolveStream, streamRefFrom } from "@/lib/data/streams";

// A frog's picture on an event card, for a frog of an event on the stream
// named by `stream_id` (form) or `?stream=` (the frog stream when neither is
// given). Another stream's frog is "Frog not found."

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const frogId = formData?.get("frogId");
  const file = formData?.get("file");

  if (typeof frogId !== "string" || !frogId || !(file instanceof File)) {
    return NextResponse.json({ error: "Need a frogId and a file." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request, formData ?? undefined));
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });
  const result = await setFrogImage(supabase, found.stream.id, frogId, file);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, url: result.url });
}

export async function DELETE(request: Request) {
  const frogId = new URL(request.url).searchParams.get("frogId");
  if (!frogId) return NextResponse.json({ error: "Missing frogId." }, { status: 400 });

  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request));
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });
  const result = await clearFrogImage(supabase, found.stream.id, frogId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
