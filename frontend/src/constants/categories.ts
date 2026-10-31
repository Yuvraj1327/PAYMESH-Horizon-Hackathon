import { Bot, ChartNoAxesCombined, Code2, Database, Plug, Search, Shapes, type LucideIcon } from "lucide-react";
import { isDemoMode } from "@/lib/env";
import type { CategoryId, PaymentAsset } from "@/types/agent";

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Categories whose providers can plausibly serve a request in this category (relevance 0.6). */
  adjacent: CategoryId[];
}

export const CATEGORIES: readonly CategoryMeta[] = [
  { id: "research", label: "Research", description: "Reports, briefs and investigations", icon: Search, adjacent: ["market_intelligence", "data_services"] },
  { id: "market_intelligence", label: "Market Intelligence", description: "Trends, sentiment and scenarios", icon: ChartNoAxesCombined, adjacent: ["research", "data_services", "ai_automation"] },
  { id: "data_services", label: "Data Services", description: "Market data, feeds and exports", icon: Database, adjacent: ["market_intelligence", "api_services", "research"] },
  { id: "development", label: "Development", description: "Code, reviews and tooling", icon: Code2, adjacent: ["api_services", "ai_automation"] },
  { id: "ai_automation", label: "AI Automation", description: "Workflows and automated tasks", icon: Bot, adjacent: ["development", "market_intelligence"] },
  { id: "api_services", label: "API Services", description: "Integrations and endpoints", icon: Plug, adjacent: ["data_services", "development"] },
  { id: "other", label: "Other", description: "Anything else", icon: Shapes, adjacent: [] },
] as const;

/** Categories the backend actually has (crypto_research, ai_analytics, market_data, other). */
const LIVE_CATEGORY_IDS: readonly CategoryId[] = ["research", "market_intelligence", "data_services", "other"];

/** The categories offered in filters and forms for the current mode (demo: the six demo categories; live: the backend's). */
export const SELECTABLE_CATEGORIES: readonly CategoryMeta[] = CATEGORIES.filter((c) => (isDemoMode ? c.id !== "other" : LIVE_CATEGORY_IDS.includes(c.id)));

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]];

export function getCategory(id: CategoryId): CategoryMeta {
  return CATEGORIES.find((c) => c.id === id) ?? (CATEGORIES[0] as CategoryMeta);
}

export const PAYMENT_ASSETS = ["USDT", "USDC"] as const satisfies readonly PaymentAsset[];

export const DELIVERY_OPTIONS = [
  { value: "none", label: "No preference", minutes: null },
  { value: "5", label: "Within 5 minutes", minutes: 5 },
  { value: "15", label: "Within 15 minutes", minutes: 15 },
  { value: "60", label: "Within 1 hour", minutes: 60 },
  { value: "1440", label: "Within 24 hours", minutes: 1440 },
] as const;

export function deliveryLabel(minutes: number | null): string {
  if (minutes === null) return "No preference";
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${Math.round(minutes / 60)} h`;
}
