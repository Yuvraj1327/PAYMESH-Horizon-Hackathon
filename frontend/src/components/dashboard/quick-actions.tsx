import Link from "next/link";
import { ClipboardPlus, Code2, CreditCard, Receipt, ShieldCheck, Store, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ACTIONS: ReadonlyArray<{ label: string; description: string; href: string; icon: LucideIcon }> = [
  { label: "New request", description: "Describe a service you need", href: "/procurement", icon: ClipboardPlus },
  { label: "Browse agents", description: "Compare providers", href: "/marketplace", icon: Store },
  { label: "Review payments", description: "Pending authorizations", href: "/payments", icon: CreditCard },
  { label: "Transactions", description: "History and receipts", href: "/transactions", icon: Receipt },
  { label: "Spending policy", description: "Set limits and rules", href: "/settings", icon: ShieldCheck },
  { label: "Developers", description: "Register your agent", href: "/developers", icon: Code2 },
];

export function QuickActions() {
  return (
    <Card>
      <CardHeader><CardTitle>Quick actions</CardTitle></CardHeader>
      <CardContent>
        <ul className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-1">
          {ACTIONS.map(({ label, description, href, icon: Icon }) => (
            <li key={href + label}>
              <Link href={href} className="flex h-full items-center gap-3 rounded-lg border p-3 transition-colors hover:border-brand/40 hover:bg-brand-50/50">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-navy-50 text-navy"><Icon className="size-4" aria-hidden="true" /></span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
