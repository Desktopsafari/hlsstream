import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { SPECIES_BUCKET, STREAM_ID } from "@/config/constants";
import { publicImageUrl } from "@/lib/species";

// Vercel serverless request bodies max out around 4.5MB, so stay under it.
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const KINDS = {
  photo: "photo_path",
  range: "range_map_path",
} as const;

type Kind = keyof typeof KINDS;

function parseKind(value: string | null): Kind | null {
  return value === "photo" || value === "range" ? value : null;
}

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const kind = parseKind(formData?.get("kind") as string | null);
  const file = formData?.get("file");

  if (!kind || !(file instanceof File)) {
    return NextResponse.json({ error: "Need a kind and a file." }, { status: 400 });
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

  const column = KINDS[kind];
  const supabase = createServiceRoleClient();

  const { data: existing } = await supabase
    .from("species_cards")
    .select(column)
    .eq("stream_id", STREAM_ID)
    .maybeSingle();
  const oldPath = (existing as Record<string, string | null> | null)?.[column] ?? null;

  // Unique name per upload so the CDN/image optimizer never serves a stale copy.
  const path = `${STREAM_ID}/${kind}-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(SPECIES_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { error: dbError } = await supabase.from("species_cards").upsert(
    { stream_id: STREAM_ID, [column]: path, updated_at: new Date().toISOString() },
    { onConflict: "stream_id" },
  );
  if (dbError) {
    await supabase.storage.from(SPECIES_BUCKET).remove([path]);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  if (oldPath) {
    await supabase.storage.from(SPECIES_BUCKET).remove([oldPath]);
  }

  return NextResponse.json({ ok: true, url: publicImageUrl(path) });
}

export async function DELETE(request: Request) {
  const kind = parseKind(new URL(request.url).searchParams.get("kind"));
  if (!kind) {
    return NextResponse.json({ error: "Invalid kind." }, { status: 400 });
  }

  const column = KINDS[kind];
  const supabase = createServiceRoleClient();

  const { data: existing } = await supabase
    .from("species_cards")
    .select(column)
    .eq("stream_id", STREAM_ID)
    .maybeSingle();
  const oldPath = (existing as Record<string, string | null> | null)?.[column] ?? null;

  if (!oldPath) {
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabase
    .from("species_cards")
    .update({ [column]: null, updated_at: new Date().toISOString() })
    .eq("stream_id", STREAM_ID);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.storage.from(SPECIES_BUCKET).remove([oldPath]);
  return NextResponse.json({ ok: true });
}
