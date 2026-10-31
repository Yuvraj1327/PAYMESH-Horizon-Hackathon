import type { DashboardData } from "@/types/dashboard";

/**
 * DEMO DATA — illustrative only. Nothing here comes from the backend, HSP or HashKey Chain.
 * There are deliberately no transaction hashes, wallet addresses or block data in this file.
 * Prices mirror the backend's demonstration provider agents so screens stay consistent during the hackathon.
 */
export const DEMO_DASHBOARD: DashboardData = {
  source: "demo",
  user: { name: "Preview User", email: null },
  kpis: [
    { key: "totalRequests", label: "Total Requests", value: "12", hint: "+3 this week" },
    { key: "activeProcurement", label: "Active Procurement", value: "3", hint: "1 awaiting your decision" },
    { key: "totalPayments", label: "Total Payments", value: "7", hint: "5 completed · 2 pending" },
    { key: "connectedAgents", label: "Connected Agents", value: "3", hint: "Demonstration providers" },
  ],
  activity: [
    { id: "a1", kind: "quotation", title: "Quotation received", detail: "Crypto Research Agent (Demo) quoted 0.25 USDT for “Q4 market research brief”.", when: "12 min ago" },
    { id: "a2", kind: "quotation", title: "Quotation received", detail: "Market Data Agent (Demo) quoted 0.40 USDT for the same request.", when: "14 min ago" },
    { id: "a3", kind: "request", title: "Procurement request created", detail: "“Q4 market research brief” — budget 1.00 USDT.", when: "20 min ago" },
    { id: "a4", kind: "selection", title: "Provider selected", detail: "AI Analytics Agent (Demo) chosen for “Token trend analysis”.", when: "2 h ago" },
    { id: "a5", kind: "payment", title: "Payment awaiting authorization", detail: "Review the Payment Guardian summary before signing with your wallet.", when: "2 h ago" },
    { id: "a6", kind: "agent", title: "Agent connected", detail: "Market Data Agent (Demo) joined your workspace.", when: "Yesterday" },
  ],
  activeRequests: [
    { id: "r1", title: "Q4 market research brief", category: "Crypto research", budget: "1.00", asset: "USDT", status: "quotes_ready", quotations: 3 },
    { id: "r2", title: "Token trend analysis", category: "AI analytics", budget: "0.75", asset: "USDT", status: "payment_pending", quotations: 2 },
    { id: "r3", title: "Daily market data snapshot", category: "Market data", budget: "0.50", asset: "USDT", status: "awaiting_quotes", quotations: 0 },
  ],
  featuredAgents: [
    { id: "f1", name: "Crypto Research Agent", category: "Crypto research", description: "Produces concise market research briefs on tokens and sectors.", capabilities: ["Market research", "Risk summary"], startingPrice: "0.25", asset: "USDT", isDemo: true },
    { id: "f2", name: "Market Data Agent", category: "Market data", description: "Delivers structured market-data snapshots and volume summaries.", capabilities: ["Price data", "Volume summary"], startingPrice: "0.40", asset: "USDT", isDemo: true },
    { id: "f3", name: "AI Analytics Agent", category: "AI analytics", description: "Runs AI-driven trend and scenario analysis on a crypto topic.", capabilities: ["Trend analysis", "Scenarios"], startingPrice: "0.60", asset: "USDT", isDemo: true },
  ],
  payments: {
    asset: "USDT",
    pending: { count: 2, amount: "1.15" },
    completed: { count: 5, amount: "2.30" },
    verifiedOnChain: 0,
  },
};
