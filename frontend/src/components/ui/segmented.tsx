"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> { value: T; label: string; icon?: ReactNode }

/** Accessible tab-style switcher (role=tablist) for a small number of views. */
export function Segmented<T extends string>({ value, onChange, options, label, idPrefix }: {
  value: T; onChange: (v: T) => void; options: readonly SegmentedOption<T>[]; label: string; idPrefix: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex w-full rounded-lg bg-muted p-1 sm:w-auto">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          id={`${idPrefix}-tab-${o.value}`}
          aria-selected={value === o.value}
          aria-controls={`${idPrefix}-panel-${o.value}`}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors sm:flex-none",
            value === o.value ? "bg-surface text-navy shadow-card" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}
