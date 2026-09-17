import type { ReactNode } from "react";

export default function Card({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-moss bg-card p-5 shadow-sm ${className}`}
    >
      {title && (
        <h2 className="mb-3 font-heading text-lg font-semibold text-forest">
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}
