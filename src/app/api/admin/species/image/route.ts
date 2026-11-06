import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { clearSpeciesImage, parseImageKind, setSpeciesImage } from "@/lib/data/species";
import { resolveStream, streamRefFrom } from "@/lib/data/streams";

// The species card's photo or range map, on the stream named by `stream_id`
// (form) or `?stream=` (the frog stream when neither is given). An unknown
// stream is refused (404); no other stream's card is touched.

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const kind = parseImageKind(formData?.get("kind"));
  const file = formData?.get("file");

  if (!kind || !(file instanceof File)) {
    return NextResponse.json({ error: "Need a kind and a file." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request, formData ?? undefined));
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });
  const result = await setSpeciesImage(supabase, found.stream.id, kind, file);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, url: result.url });
}

export async function DELETE(request: Request) {
  const kind = parseImageKind(new URL(request.url).searchParams.get("kind"));
  if (!kind) {
    return NextResponse.json({ error: "Invalid kind." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const found = await resolveStream(supabase, streamRefFrom(request));
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });
  const result = await clearSpeciesImage(supabase, found.stream.id, kind);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
