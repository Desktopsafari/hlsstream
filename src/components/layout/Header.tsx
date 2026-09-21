import Link from "next/link";
import { KOFI_URL, SITE_NAME } from "@/config/constants";

export default function Header() {
  return (
    <header className="bg-forest">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="font-heading text-lg font-semibold tracking-wide text-parchment sm:text-xl"
        >
          {SITE_NAME}
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href={KOFI_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-parchment/40 px-3 py-1 text-xs font-semibold text-parchment transition-colors hover:border-amber hover:bg-amber"
          >
            <span className="sm:hidden">Support</span>
            <span className="hidden sm:inline">Support on Ko-fi</span>
          </a>
          <span className="flex items-center gap-1.5 rounded-full bg-amber px-3 py-1 text-xs font-semibold uppercase tracking-wide text-parchment">
            <span className="h-1.5 w-1.5 rounded-full bg-parchment" />
            Live
          </span>
        </div>
      </div>
    </header>
  );
}
