import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { STREAM_ID } from "@/config/constants";
import {
  ANNOUNCEMENT_COLUMNS,
  ANNOUNCEMENTS_SQL_HINT,
  attachPendingImage,
  cleanupPendingAnnouncementImages,
  isMissingTable,
  isPendingPath,
  parseAnnouncementInput,
  pickVisible,
  removeFileIfUnreferenced,
  toAdminAnnouncement,
  type AnnouncementRow,
} from "@/lib/announcements";

const unsupported = () =>
  NextResponse.json({ error: ANNOUNCEMENTS_SQL_HINT, code: "unsupported" }, { status: 400 });

// Every announcement (current, scheduled and past), newest first, each with
// its status line. { supported: false } until supabase/announcements.sql runs.
export async function GET() {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("announcements")
    .select(ANNOUNCEMENT_COLUMNS)
    .eq("stream_id", STREAM_ID)
    .order("created_at", { ascending: false })
    .limit(100);

  if (isMissingTable(error)) return NextResponse.json({ supported: false, announcements: [] });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Housekeeping: pictures picked in the form but never saved.
  const pending = await cleanupPendingAnnouncementImages(supabase);
  if (pending.error) console.error("Pending announcement picture cleanup failed:", pending.error);

  const rows = (data ?? []) as AnnouncementRow[];
  const now = new Date();
  const shown = new Set(pickVisible(rows, now).map((a) => a.id));
  return NextResponse.json({
    supported: true,
    announcements: rows.map((a) => toAdminAnnouncement(a, shown, now)),
  });
}

// Creates an announcement. A picture picked before saving arrives as a
// pending path and is moved into the announcement's folder.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = parseAnnouncementInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const pendingPath = body?.pendingImagePath;
  if (pendingPath != null && pendingPath !== "" && !isPendingPath(pendingPath)) {
    return NextResponse.json({ error: "That picture isn't a valid pending upload." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data: created, error } = await supabase
    .from("announcements")
    .insert({ stream_id: STREAM_ID, ...parsed.fields })
    .select("id")
    .single();
  if (isMissingTable(error)) return unsupported();
  if (error || !created) {
    return NextResponse.json({ error: error?.message ?? "Failed to save the announcement." }, { status: 500 });
  }

  if (pendingPath) {
    const attached = await attachPendingImage(supabase, created.id, pendingPath);
    if (!attached.ok) {
      return NextResponse.json({
        ok: true,
        id: created.id,
        warning: `Saved, but the picture wasn't attached: ${attached.error}`,
      });
    }
  }
  return NextResponse.json({ ok: true, id: created.id });
}

// Saves an existing announcement's text, button, timing and switch. Its
// picture has its own route (/api/admin/announcements/image).
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });

  const parsed = parseAnnouncementInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data: existing, error: loadError } = await supabase
    .from("announcements")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (isMissingTable(loadError)) return unsupported();
  if (!existing) return NextResponse.json({ error: "Announcement not found." }, { status: 404 });

  const { error } = await supabase
    .from("announcements")
    .update({ ...parsed.fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// Deletes an announcement and its picture (unless another announcement uses
// the same file).
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data: existing, error: loadError } = await supabase
    .from("announcements")
    .select("id, image_path")
    .eq("id", id)
    .maybeSingle();
  if (isMissingTable(loadError)) return unsupported();
  if (!existing) return NextResponse.json({ ok: true });

  const { error } = await supabase.from("announcements").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (existing.image_path) await removeFileIfUnreferenced(supabase, existing.image_path);
  return NextResponse.json({ ok: true });
}
