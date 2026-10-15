import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  clearPollImage,
  deletePendingImage,
  IMAGES_SQL_HINT,
  imagesSupported,
  isPendingPath,
  setPollImage,
  uploadPendingImage,
} from "@/lib/pollImages";

// The picture above a poll's question. With a pollId the picture goes straight
// onto that poll (allowed whenever the question text could be edited: queued or
// open, not closed). Without one it's a "pending" upload for the Set Next Poll
// form, whose poll doesn't exist yet; the form passes the returned path back
// when it saves.
export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const pollId = formData?.get("pollId");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Need a file." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  if (!(await imagesSupported(supabase))) {
    return NextResponse.json({ error: IMAGES_SQL_HINT, code: "images_unsupported" }, { status: 400 });
  }

  const result =
    typeof pollId === "string" && pollId
      ? await setPollImage(supabase, pollId, file)
      : await uploadPendingImage(supabase, file);

  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  return NextResponse.json({ ok: true, path: result.path, url: result.url });
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const pollId = params.get("pollId");
  const path = params.get("path");
  const supabase = createServiceRoleClient();

  if (pollId) {
    const result = await clearPollImage(supabase, pollId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  }

  if (path && isPendingPath(path)) {
    await deletePendingImage(supabase, path);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Need a pollId or a pending picture path." }, { status: 400 });
}
