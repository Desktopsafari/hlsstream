import Link from "next/link";
import { SITE_NAME } from "@/config/constants";

export default function Header() {
  return (
    <header className="bg-forest">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="font-heading text-lg font-semibold tracking-wide text-parchment sm:text-xl"
        >
          {SITE_NAME}
        </Link>
        <span className="flex items-center gap-1.5 rounded-full bg-amber px-3 py-1 text-xs font-semibold uppercase tracking-wide text-parchment">
          <span className="h-1.5 w-1.5 rounded-full bg-parchment" />
          Live
        </span>
        {/* Future nav (channels, chat, account) slots in here */}
      </div>
    </header>
  );
}
