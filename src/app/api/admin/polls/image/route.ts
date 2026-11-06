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
} from "@/lib/data/polls";
import { resolveStream, streamRefFrom } from "@/lib/data/streams";

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
      ? await setPollImageInStream(supabase, request, formData, pollId, file)
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
    const found = await resolveStream(supabase, streamRefFrom(request));
    if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });
    const result = await clearPollImage(supabase, found.stream.id, pollId);
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

// A picture for an existing poll: only a poll of the stream named in the form
// (`stream_id`) or the URL, the frog stream when neither is given.
async function setPollImageInStream(
  supabase: ReturnType<typeof createServiceRoleClient>,
  request: Request,
  formData: FormData | null,
  pollId: string,
  file: File,
) {
  const found = await resolveStream(supabase, streamRefFrom(request, formData ?? undefined));
  if (!found.ok) return { ok: false as const, status: found.status, error: found.error, code: undefined };
  return setPollImage(supabase, found.stream.id, pollId, file);
}
