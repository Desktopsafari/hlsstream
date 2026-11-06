import type { createServiceRoleClient } from "@/lib/supabase/server";
import { parseExternalVideoUrl, type ExternalEmbed } from "@/lib/data/captures/rules";
import { captureConfig, mediaUrls, thumbUrl, type CaptureRow } from "@/lib/data/captures/core";

type Supabase = ReturnType<typeof createServiceRoleClient>;

// ---- gallery -----------------------------------------------------------------------

export type GalleryItem = {
  id: string;
  kind: "photo" | "clip";
  seconds: number;
  url: string | null;
  downloadUrl: string | null;
  thumbUrl: string | null;
  embed: ExternalEmbed | null;
  featuredAt: string | null;
};

export const GALLERY_LIMIT = 60;

// Featured captures, newest featured first. Only what the page shows: no
// hashes, no expiry, nothing about who made it.
export async function loadGallery(supabase: Supabase): Promise<GalleryItem[]> {
  const config = captureConfig();
  if (!config) return [];
  const { data, error } = await supabase
    .from("captures")
    .select("id, kind, seconds, file_name, thumb_name, featured_at, external_url, status")
    .eq("featured", true)
    .eq("status", "ready")
    .order("featured_at", { ascending: false })
    .limit(GALLERY_LIMIT);
  if (error) return [];
  return ((data ?? []) as CaptureRow[])
    .map((r) => {
      const embed = r.external_url ? parseExternalVideoUrl(r.external_url) : null;
      return {
        id: r.id,
        kind: r.kind,
        seconds: r.seconds,
        ...(embed ? { url: null, downloadUrl: null } : mediaUrls(config, r.file_name)),
        thumbUrl: thumbUrl(config, r.thumb_name),
        embed,
        featuredAt: r.featured_at,
      };
    })
    .filter((i) => i.embed || i.url);
}
