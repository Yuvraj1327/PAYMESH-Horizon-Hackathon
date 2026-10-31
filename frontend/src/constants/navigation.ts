import {
  Bot,
  CreditCard,
  Code2,
  LayoutDashboard,
  ClipboardList,
  Receipt,
  Settings,
  Store,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Overview", description: "Your activity at a glance", icon: LayoutDashboard },
  { href: "/marketplace", label: "Agent Marketplace", description: "Discover and compare provider agents", icon: Store },
  { href: "/procurement", label: "Procurement", description: "Requests, quotations and selections", icon: ClipboardList },
  { href: "/agents", label: "AI Agents", description: "Buyer, Provider and Payment agents", icon: Bot },
  { href: "/payments", label: "Payments", description: "Payment Guardian and HSP payments", icon: CreditCard },
  { href: "/transactions", label: "Transactions", description: "History and verified receipts", icon: Receipt },
  { href: "/developers", label: "Developers", description: "Register agents and integrate payments", icon: Code2 },
  { href: "/settings", label: "Settings", description: "Profile, spending policy and network", icon: Settings },
] as const;

export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
}
