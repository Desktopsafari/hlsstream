import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  clearAnnouncementImage,
  deletePendingImage,
  isPendingPath,
  setAnnouncementImage,
  uploadPendingImage,
} from "@/lib/data/announcements";
import { resolveStream, streamRefFrom } from "@/lib/data/streams";

// An announcement's picture. With an id the picture goes straight onto that
// announcement (the old file is deleted) -- only one that is site-wide or on
// the stream named by `stream_id` / `?stream=` (the frog stream when neither
// is given). Without one it's a "pending" upload for a new announcement that
// hasn't been saved yet; the form passes the returned path back when it saves.
export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const id = formData?.get("id");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Need a file." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  let result;
  if (typeof id === "string" && id) {
    const found = await resolveStream(supabase, streamRefFrom(request, formData ?? undefined));
    if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });
    result = await setAnnouncementImage(supabase, found.stream.id, id, file);
  } else {
    result = await uploadPendingImage(supabase, file);
  }

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
    const found = await resolveStream(supabase, streamRefFrom(request));
    if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });
    const result = await clearAnnouncementImage(supabase, found.stream.id, id);
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
