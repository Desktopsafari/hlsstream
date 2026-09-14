import Link from "next/link";
import { SITE_NAME } from "@/config/constants";

export default function Header() {
  return (
    <header className="border-b border-neutral-800">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-sm font-semibold tracking-wide sm:text-base">
          {SITE_NAME}
        </Link>
        {/* Future nav (channels, chat, account) slots in here */}
      </div>
    </header>
  );
}
