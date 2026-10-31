import { DEMO_AGENTS } from "@/services/demo/agents";
import { applySelection, createRequestRecords, type DemoDb } from "@/services/demo/engine";
import type { NewRequestInput, ProcurementRequest } from "@/types/procurement";

/**
 * Sample procurement history so the dashboard-style views are not empty in demo mode.
 * Clearly demo data: the "completed" sample does NOT represent a real payment or delivery.
 */
export function createSeedDb(now: Date): DemoDb {
  const db: DemoDb = { version: 1, requests: [], quotations: [], events: [] };
  const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
  const base = { additionalInstructions: "", origin: "form" as const, preferredAgentId: null };

  const add = (input: NewRequestInput, at: Date, after?: (req: ProcurementRequest) => void) => {
    const rec = createRequestRecords(input, DEMO_AGENTS, at);
    rec.request.isSample = true; // seeded history: never counted as the user's own progress
    db.requests.push(rec.request); db.quotations.push(...rec.quotations); db.events.push(...rec.events);
    after?.(rec.request);
  };

  add({ ...base, title: "Q4 market research brief", description: "Need a concise research brief on the current crypto market with key risks.", category: "research", requiredCapabilities: ["Market research"], maxBudget: "1", asset: "USDT", preferredDeliveryMinutes: null }, ago(0.4));
  add({ ...base, title: "Token trend analysis", description: "Trend and sentiment analysis on a mid-cap token for the next week.", category: "market_intelligence", requiredCapabilities: ["Trend analysis", "Sentiment analysis"], maxBudget: "0.75", asset: "USDT", preferredDeliveryMinutes: 15 }, ago(2.5), (r) => {
    const q = db.quotations.find((x) => x.requestId === r.id);
    if (q) applySelection(db, r.id, q.id, DEMO_AGENTS, new Date(ago(2.4)));
  });
  add({ ...base, title: "Daily market data snapshot", description: "Daily snapshot of prices and volumes for a watchlist of ten tokens.", category: "data_services", requiredCapabilities: [], maxBudget: "0.1", asset: "USDT", preferredDeliveryMinutes: null }, ago(5));
  add({ ...base, title: "Weekly sector overview (sample)", description: "Historical sample request kept for demonstration of completed history.", category: "research", requiredCapabilities: ["Sector overview"], maxBudget: "0.5", asset: "USDT", preferredDeliveryMinutes: 60 }, ago(52), (r) => {
    const q = db.quotations.find((x) => x.requestId === r.id);
    if (q) applySelection(db, r.id, q.id, DEMO_AGENTS, new Date(ago(51.9)));
    r.status = "completed"; r.updatedAt = ago(51).toISOString();
    db.events.push({ id: `evt_seed_done`, requestId: r.id, type: "request_completed_sample", actor: "system", title: "Marked completed (sample data)", detail: "Illustrative history only — no payment or delivery took place.", at: ago(51).toISOString() });
  });
  add({ ...base, title: "Contract gas hints", description: "Quick gas optimisation hints for a small Solidity contract.", category: "development", requiredCapabilities: ["Gas hints"], maxBudget: "2", asset: "USDT", preferredDeliveryMinutes: null }, ago(30), (r) => {
    r.status = "cancelled"; r.updatedAt = ago(29).toISOString();
    db.events.push({ id: `evt_seed_cancel`, requestId: r.id, type: "request_cancelled", actor: "user", title: "Request cancelled", detail: "Cancelled by the user (sample data).", at: ago(29).toISOString() });
  });
  return db;
}
