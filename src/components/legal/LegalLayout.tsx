import type { ReactNode } from "react";
import { SITE_NAME } from "@/config/constants";

// Shared shell for the plain-text legal pages (privacy notice, terms).
export function LegalLayout({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber">{SITE_NAME}</p>
        <h1 className="font-heading text-2xl font-semibold text-forest sm:text-3xl">{title}</h1>
        <p className="text-sm text-muted">Last updated: {updated}</p>
      </div>
      {children}
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 text-sm leading-relaxed text-ink">
      <h2 className="font-heading text-lg font-semibold text-forest">{title}</h2>
      {children}
    </section>
  );
}

export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="flex list-disc flex-col gap-1.5 pl-5">{children}</ul>;
}
