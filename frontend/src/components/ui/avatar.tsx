import { cn, initials } from "@/lib/utils";

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-semibold text-white", className)}
    >
      {initials(name)}
    </span>
  );
}
