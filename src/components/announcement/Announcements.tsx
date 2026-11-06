import { connection } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getVisibleAnnouncements } from "@/lib/data/announcements";
import { resolveStream } from "@/lib/data/streams";
import type { PublicAnnouncement } from "@/lib/announcementLinks";
import AnnouncementCards from "./AnnouncementCards";

// Don't let a slow database hold the whole page up; the cards' own refresh
// picks them up a minute later instead.
const SERVER_WAIT_MS = 1500;

// Server part of the announcement cards: works out what's visible from the
// real clock on every request, so the cards arrive in the page's HTML instead
// of popping in (and pushing everything down) after load.
export default async function Announcements() {
  await connection();
  let initial: PublicAnnouncement[] = [];
  try {
    const supabase = createServiceRoleClient();
    initial = await Promise.race([
      // The frog stream until stream pages pass their own stream in.
      resolveStream(supabase, null).then((found) => (found.ok ? getVisibleAnnouncements(supabase, found.stream.id) : [])),
      new Promise<PublicAnnouncement[]>((resolve) => setTimeout(() => resolve([]), SERVER_WAIT_MS)),
    ]);
  } catch {
    // e.g. missing env vars in a local build: just no cards.
  }
  return <AnnouncementCards initial={initial} serverTime={new Date().toISOString()} />;
}
