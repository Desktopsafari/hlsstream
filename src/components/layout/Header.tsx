import Link from "next/link";
import { KOFI_URL, SITE_NAME, SUPPORT_PAGE_LIVE } from "@/config/constants";

const pillClasses =
  "whitespace-nowrap rounded-full border border-parchment/40 px-3 py-1 max-[359px]:px-2.5 text-xs font-semibold text-parchment transition-colors hover:border-amber hover:bg-amber focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-parchment";

export default function Header() {
  return (
    <header className="bg-forest">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 max-[359px]:gap-2 max-[359px]:px-3 sm:px-6">
        <Link href="/" className="font-heading text-lg font-semibold tracking-wide text-parchment sm:text-xl">
          {SITE_NAME}
        </Link>
        <div className="flex items-center gap-2.5 max-[359px]:gap-1.5 sm:gap-4">
          {/* Plain text link, deliberately larger and bolder than the LIVE badge. */}
          <Link
            href="/contact"
            className="whitespace-nowrap rounded-sm text-sm font-bold text-parchment max-[359px]:text-[13px] decoration-2 underline-offset-4 hover:underline focus-visible:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-parchment sm:text-base"
          >
            Contact
          </Link>
          {SUPPORT_PAGE_LIVE ? (
            <a href={KOFI_URL} target="_blank" rel="noopener noreferrer" className={pillClasses}>
              Support us
            </a>
          ) : (
            <Link href="/support" className={pillClasses}>
              Support us
            </Link>
          )}
          <span className="flex items-center gap-1.5 rounded-full bg-amber px-3 py-1 max-[359px]:px-2.5 text-xs font-semibold uppercase tracking-wide text-parchment">
            <span className="h-1.5 w-1.5 rounded-full bg-parchment" />
            Live
          </span>
        </div>
      </div>
    </header>
  );
}
