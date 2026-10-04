import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { EVENT_BUCKET } from "@/config/constants";
import { eventImageUrl } from "@/lib/events";

// Vercel serverless request bodies max out around 4.5MB, so stay under it.
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const frogId = formData?.get("frogId");
  const file = formData?.get("file");

  if (typeof frogId !== "string" || !frogId || !(file instanceof File)) {
    return NextResponse.json({ error: "Need a frogId and a file." }, { status: 400 });
  }

  const ext = TYPES[file.type];
  if (!ext) {
    return NextResponse.json({ error: "Images must be JPG, PNG, or WebP." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "That image is over 4MB. Please resize/compress it and try again." },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();
  const { data: frog } = await supabase
    .from("suggestion_event_frogs")
    .select("id, event_id, image_path")
    .eq("id", frogId)
    .maybeSingle();
  if (!frog) return NextResponse.json({ error: "Frog not found." }, { status: 404 });

  // Unique name per upload so the CDN/image optimizer never serves a stale copy.
  const path = `${frog.event_id}/${frog.id}-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(EVENT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { error: dbError } = await supabase
    .from("suggestion_event_frogs")
    .update({ image_path: path })
    .eq("id", frog.id);
  if (dbError) {
    await supabase.storage.from(EVENT_BUCKET).remove([path]);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  // Replacing deletes the old file so storage (and the image optimizer's
  // source-image count) doesn't accumulate.
  if (frog.image_path) {
    await supabase.storage.from(EVENT_BUCKET).remove([frog.image_path]);
  }

  return NextResponse.json({ ok: true, url: eventImageUrl(path) });
}

export async function DELETE(request: Request) {
  const frogId = new URL(request.url).searchParams.get("frogId");
  if (!frogId) return NextResponse.json({ error: "Missing frogId." }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data: frog } = await supabase
    .from("suggestion_event_frogs")
    .select("id, image_path")
    .eq("id", frogId)
    .maybeSingle();
  if (!frog?.image_path) return NextResponse.json({ ok: true });

  const { error } = await supabase
    .from("suggestion_event_frogs")
    .update({ image_path: null })
    .eq("id", frog.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.storage.from(EVENT_BUCKET).remove([frog.image_path]);
  return NextResponse.json({ ok: true });
}
