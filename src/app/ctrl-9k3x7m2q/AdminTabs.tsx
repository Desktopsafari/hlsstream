"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type AdminTab = { id: string; label: string; content: ReactNode };

// The admin panel's tabs: a left sidebar from `lg` up, a top bar that scrolls
// sideways on smaller screens. The selected tab lives in the URL hash
// (#polls, #chat ...), so refresh, back/forward and links to a tab all work.
// Every panel stays mounted (just hidden), so switching tabs never reloads a
// section or loses something half-typed -- each section loads once, as it
// did when they were all on one page.
export default function AdminTabs({ tabs }: { tabs: AdminTab[] }) {
  const [active, setActive] = useState(tabs[0].id);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const ids = tabs.map((t) => t.id).join(",");

  useEffect(() => {
    const known = ids.split(",");
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      setActive(known.includes(id) ? id : known[0]);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [ids]);

  // Keep the selected tab in view in the phone tab bar.
  useEffect(() => {
    buttons.current[active]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  function select(id: string, focus = false) {
    // A hash with no element of that id, so the browser doesn't jump.
    if (window.location.hash.slice(1) !== id) window.location.hash = id;
    setActive(id);
    if (focus) buttons.current[id]?.focus();
  }

  // WAI-ARIA tabs pattern: arrows move (and select), Home/End jump to the
  // ends. Both arrow directions work, since the bar is vertical on desktop
  // and horizontal on phones.
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const i = tabs.findIndex((t) => t.id === active);
    let next = -1;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    select(tabs[next].id, true);
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      <div
        role="tablist"
        aria-label="Admin sections"
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-moss px-4 sm:-mx-6 sm:px-6 lg:sticky lg:top-6 lg:mx-0 lg:flex-col lg:overflow-visible lg:border-b-0 lg:px-0"
      >
        {tabs.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                buttons.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`admin-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`admin-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(t.id)}
              onKeyDown={onKeyDown}
              className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-forest lg:rounded-md lg:border-b-0 ${
                selected
                  ? "border-forest font-semibold text-forest lg:bg-forest lg:text-parchment"
                  : "border-transparent text-muted hover:text-forest lg:hover:bg-card"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`admin-panel-${t.id}`}
          aria-labelledby={`admin-tab-${t.id}`}
          hidden={t.id !== active}
          className="min-w-0 lg:col-start-2 lg:row-start-1"
        >
          <div className="flex flex-col gap-8">{t.content}</div>
        </div>
      ))}
    </div>
  );
}
