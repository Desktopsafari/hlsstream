import { SITE_NAME } from "@/config/constants";

export default function Footer() {
  return (
    <footer className="border-t border-neutral-800">
      <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-4 text-xs text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
        <span>
          &copy; {new Date().getFullYear()} {SITE_NAME}
        </span>
        <span>Live stream availability may vary.</span>
      </div>
    </footer>
  );
}
