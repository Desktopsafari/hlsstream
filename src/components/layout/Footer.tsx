import { SITE_NAME } from "@/config/constants";

export default function Footer() {
  return (
    <footer className="border-t border-moss">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span>
          &copy; {new Date().getFullYear()} {SITE_NAME}
        </span>
        <span>Live stream availability may vary.</span>
      </div>
    </footer>
  );
}
