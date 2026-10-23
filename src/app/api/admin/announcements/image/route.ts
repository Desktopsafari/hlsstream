import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  clearAnnouncementImage,
  deletePendingImage,
  isPendingPath,
  setAnnouncementImage,
  uploadPendingImage,
} from "@/lib/announcements";

// An announcement's picture. With an id the picture goes straight onto that
// announcement (the old file is deleted). Without one it's a "pending" upload
// for a new announcement that hasn't been saved yet; the form passes the
// returned path back when it saves.
export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const id = formData?.get("id");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Need a file." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const result =
    typeof id === "string" && id
      ? await setAnnouncementImage(supabase, id, file)
      : await uploadPendingImage(supabase, file);

  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  return NextResponse.json({ ok: true, path: result.path, url: result.url });
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const path = params.get("path");
  const supabase = createServiceRoleClient();

  if (id) {
    const result = await clearAnnouncementImage(supabase, id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  }

  if (path && isPendingPath(path)) {
    await deletePendingImage(supabase, path);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Need an id or a pending picture path." }, { status: 400 });
}
