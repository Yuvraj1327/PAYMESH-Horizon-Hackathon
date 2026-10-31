import { isDemoMode } from "@/lib/env";
import type { DashboardData } from "@/types/dashboard";
import { DEMO_DASHBOARD } from "@/services/demo-data";

/**
 * Integration boundary for the dashboard. Today it returns labelled demo data.
 * When the backend is wired (next steps) this function composes live responses
 * (procurement requests, agents, payment intents, receipts) via `apiRequest` and returns `source: "live"`.
 * The UI depends only on `DashboardData`, so no component changes when the source switches.
 */
export async function getDashboardData(): Promise<DashboardData> {
  if (isDemoMode) {
    // Simulated latency keeps loading states honest during development; remove when live.
    await new Promise((r) => setTimeout(r, 350));
    return DEMO_DASHBOARD;
  }
  // Live aggregation is intentionally not implemented in this step (no invented endpoints).
  throw new Error("Live dashboard data is not available yet. Unset NEXT_PUBLIC_API_BASE_URL to view demo data.");
}
