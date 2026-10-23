"use client";

import { useEffect } from "react";
import { POLL_ANCHOR_ID } from "@/lib/announcementLinks";

// Arriving at /#todays-vote from another page: the browser scrolls to the
// poll card straight away, but the cards above it (event, species ...) load a
// moment later and push it down. Re-aim a couple of times while the page
// settles, unless the visitor has started scrolling themselves. Renders
// nothing.
export default function PollAnchorScroll() {
  useEffect(() => {
    if (window.location.hash !== `#${POLL_ANCHOR_ID}`) return;
    let userMoved = false;
    const stop = () => {
      userMoved = true;
    };
    const opts = { passive: true, once: true } as const;
    window.addEventListener("wheel", stop, opts);
    window.addEventListener("touchstart", stop, opts);
    window.addEventListener("keydown", stop, opts);
    const aim = () => {
      if (!userMoved) document.getElementById(POLL_ANCHOR_ID)?.scrollIntoView({ block: "start" });
    };
    const timers = [0, 400, 1200, 2500].map((ms) => setTimeout(aim, ms));
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
  }, []);
  return null;
}
