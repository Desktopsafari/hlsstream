"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AnnouncementCard from "./AnnouncementCard";
import type { PublicAnnouncement } from "@/lib/announcementLinks";

const REFRESH_INTERVAL_MS = 60000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

// The announcement cards above the suggestion event card. The first list is
// rendered on the server (so the cards are in the HTML and don't shift the
// page in after load); after that it refreshes every minute and each card
// disappears the moment its end time passes, like the event card. Renders
// nothing at all (no wrapper, no spacing) when there are none.
export default function AnnouncementCards({
  initial,
  serverTime,
}: {
  initial: PublicAnnouncement[];
  serverTime: string;
}) {
  const [list, setList] = useState(initial);
  const [nowTick, setNowTick] = useState(0);
  const clockSkewMs = useRef(Date.parse(serverTime) - Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/announcements", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      clockSkewMs.current = Date.parse(data.serverTime) - Date.now();
      setList(Array.isArray(data.announcements) ? data.announcements : []);
    } catch {
      // Stay as we are; the next refresh will try again.
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const now = () => Date.now() + clockSkewMs.current;
  const visible = list.filter((a) => !a.endsAt || Date.parse(a.endsAt) > now());

  // Re-render at the next end time so that card goes away on time even if
  // this tab has been open a long time. (A card that was waiting behind the
  // 3-card limit shows up on the next refresh.)
  useEffect(() => {
    const ends = list
      .map((a) => (a.endsAt ? Date.parse(a.endsAt) - now() : Infinity))
      .filter((ms) => ms > 0 && ms !== Infinity);
    if (ends.length === 0) return;
    const timer = setTimeout(() => {
      setNowTick((n) => n + 1);
      load();
    }, Math.min(Math.min(...ends) + 50, MAX_TIMEOUT_MS));
    return () => clearTimeout(timer);
  }, [list, nowTick, load]);

  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-8">
      {visible.map((a) => (
        <AnnouncementCard key={a.id} announcement={a} />
      ))}
    </div>
  );
}
