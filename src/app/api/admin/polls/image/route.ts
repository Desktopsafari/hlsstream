import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  clearOptionImage,
  deletePendingImage,
  IMAGES_SQL_HINT,
  imagesSupported,
  isPendingPath,
  setOptionImage,
  uploadPendingImage,
} from "@/lib/pollImages";

// Pictures on poll options. With an optionId the picture goes straight onto
// that option (and is refused once the poll has votes, like the options
// themselves). Without one it's a "pending" upload for a form whose poll or
// option doesn't exist yet; the form passes the returned path back when it
// saves.
export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const optionId = formData?.get("optionId");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Need a file." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  if (!(await imagesSupported(supabase))) {
    return NextResponse.json({ error: IMAGES_SQL_HINT, code: "images_unsupported" }, { status: 400 });
  }

  const result =
    typeof optionId === "string" && optionId
      ? await setOptionImage(supabase, optionId, file)
      : await uploadPendingImage(supabase, file);

  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  return NextResponse.json({ ok: true, path: result.path, url: result.url });
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const optionId = params.get("optionId");
  const path = params.get("path");
  const supabase = createServiceRoleClient();

  if (optionId) {
    const result = await clearOptionImage(supabase, optionId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  }

  if (path && isPendingPath(path)) {
    await deletePendingImage(supabase, path);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Need an optionId or a pending picture path." }, { status: 400 });
}
