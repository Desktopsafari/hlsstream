import type { createServiceRoleClient } from "@/lib/supabase/server";
import type { PublicAnnouncement } from "@/lib/announcementLinks";
import type { StreamId } from "@/lib/data/streams";
import { ANNOUNCEMENT_COLUMNS, pickVisible, toPublicAnnouncement, type AnnouncementRow } from "@/lib/data/announcements/rules";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// One stream's own announcements plus the site-wide ones (stream_id null),
// newest first. Two simple queries rather than an `or` filter, so the stream
// id never goes into a filter string. Null if either read fails.
export async function loadStreamAnnouncements(
  supabase: Supabase,
  streamId: StreamId,
  { onlyOn = false, limit }: { onlyOn?: boolean; limit: number },
): Promise<{ rows: AnnouncementRow[] } | { error: { code?: string; message?: string } }> {
  const own = supabase.from("announcements").select(ANNOUNCEMENT_COLUMNS).eq("stream_id", streamId);
  const siteWide = supabase.from("announcements").select(ANNOUNCEMENT_COLUMNS).is("stream_id", null);
  const [a, b] = await Promise.all(
    [own, siteWide].map((q) => (onlyOn ? q.eq("is_on", true) : q).order("created_at", { ascending: false }).limit(limit)),
  );
  if (a.error) return { error: a.error };
  if (b.error) return { error: b.error };
  const rows = [...((a.data ?? []) as AnnouncementRow[]), ...((b.data ?? []) as AnnouncementRow[])];
  rows.sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : 0));
  return { rows: rows.slice(0, limit) };
}

// What one stream's page shows right now: its own and the site-wide
// announcements. Any failure (including the table not existing yet) means
// "no announcements", so the page is never broken by it.
export async function getVisibleAnnouncements(
  supabase: Supabase,
  streamId: StreamId,
  now: Date = new Date(),
): Promise<PublicAnnouncement[]> {
  try {
    const loaded = await loadStreamAnnouncements(supabase, streamId, { onlyOn: true, limit: 50 });
    if ("error" in loaded) return [];
    return pickVisible(loaded.rows, now).map(toPublicAnnouncement);
  } catch {
    return [];
  }
}
