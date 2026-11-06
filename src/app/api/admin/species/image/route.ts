import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { clearSpeciesImage, parseImageKind, setSpeciesImage } from "@/lib/data/species";

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const kind = parseImageKind(formData?.get("kind"));
  const file = formData?.get("file");

  if (!kind || !(file instanceof File)) {
    return NextResponse.json({ error: "Need a kind and a file." }, { status: 400 });
  }

  const result = await setSpeciesImage(createServiceRoleClient(), kind, file);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, url: result.url });
}

export async function DELETE(request: Request) {
  const kind = parseImageKind(new URL(request.url).searchParams.get("kind"));
  if (!kind) {
    return NextResponse.json({ error: "Invalid kind." }, { status: 400 });
  }

  const result = await clearSpeciesImage(createServiceRoleClient(), kind);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
