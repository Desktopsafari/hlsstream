import { connection } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { loadGallery, type GalleryItem } from "@/lib/data/captures";
import GalleryGrid from "@/components/capture/GalleryGrid";
import { SITE_NAME } from "@/config/constants";

export const metadata = {
  title: `Gallery — ${SITE_NAME}`,
};

// Featured photos and clips from the stream, chosen by the admin. Built per
// request (featuring takes effect at once). Thumbnails load lazily; clips
// and embeds only load when clicked (GalleryGrid).
export default async function GalleryPage() {
  await connection();
  let items: GalleryItem[] = [];
  try {
    items = await loadGallery(createServiceRoleClient());
  } catch {
    // e.g. missing env vars in a local build: an empty gallery.
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold text-forest sm:text-3xl">Gallery</h1>
        <p className="text-sm text-muted">Favourite moments from the stream.</p>
      </div>
      {items.length === 0 ? (
        <p className="rounded-xl border border-moss bg-card p-5 text-sm text-muted shadow-sm">
          Nothing here yet. Check back soon.
        </p>
      ) : (
        <GalleryGrid items={items} />
      )}
    </div>
  );
}
