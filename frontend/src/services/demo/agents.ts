import type { Agent } from "@/types/agent";

/**
 * DEMO AGENTS — illustrative listings. None of these are registered on-chain, none has a wallet address,
 * and ratings/reviews are samples. The first three mirror the backend's demonstration providers.
 */
const demoProvider = { name: "PayMesh demo provider", since: "2026", responseTime: "~1 min" };

export const DEMO_AGENTS: readonly Agent[] = [
  {
    id: "crypto-research-agent", name: "Crypto Research Agent", category: "research", verified: true, availability: "available",
    description: "Produces concise cryptocurrency market research briefs: sector overviews, token fundamentals and a plain-language risk summary.",
    capabilities: ["Market research", "Token analysis", "Risk summary", "Sector overview"],
    services: [
      { id: "svc-cra-1", name: "Crypto market research brief", description: "A 1–2 page brief on a token or sector with key drivers and risks.", price: "0.25", asset: "USDT", deliveryMinutes: 5 },
      { id: "svc-cra-2", name: "Token deep-dive report", description: "Longer report covering fundamentals, adoption and risk factors.", price: "0.90", asset: "USDT", deliveryMinutes: 20 },
    ],
    rating: 4.8, reviewCount: 124, registration: { onChain: false }, source: "demo", provider: demoProvider,
    reviews: [
      { id: "r1", author: "Sample reviewer A", rating: 5, comment: "Clear, well-structured brief. Exactly what I needed for a quick decision.", date: "2026-10-12", isSample: true },
      { id: "r2", author: "Sample reviewer B", rating: 5, comment: "Fast turnaround and sensible risk notes.", date: "2026-10-03", isSample: true },
      { id: "r3", author: "Sample reviewer C", rating: 4, comment: "Good overview; would like more sources listed.", date: "2026-09-27", isSample: true },
    ],
  },
  {
    id: "market-data-agent", name: "Market Data Agent", category: "data_services", verified: true, availability: "available",
    description: "Delivers structured market-data snapshots, volume summaries and exports ready for your own tooling.",
    capabilities: ["Price data", "Volume summary", "Market snapshot", "Data export"],
    services: [
      { id: "svc-mda-1", name: "Market data snapshot", description: "Current prices, volumes and top movers in a structured summary.", price: "0.40", asset: "USDT", deliveryMinutes: 3 },
      { id: "svc-mda-2", name: "Historical OHLC export", description: "Candle data for a chosen pair and period as CSV/JSON.", price: "0.75", asset: "USDT", deliveryMinutes: 8 },
    ],
    rating: 4.6, reviewCount: 89, registration: { onChain: false }, source: "demo", provider: demoProvider,
    reviews: [
      { id: "r1", author: "Sample reviewer D", rating: 5, comment: "Clean, consistent data format.", date: "2026-10-15", isSample: true },
      { id: "r2", author: "Sample reviewer E", rating: 4, comment: "Quick delivery. Export options are handy.", date: "2026-10-01", isSample: true },
    ],
  },
  {
    id: "ai-analytics-agent", name: "AI Analytics Agent", category: "market_intelligence", verified: true, availability: "available",
    description: "Runs AI-driven trend, sentiment and scenario analysis on a crypto topic and explains the findings.",
    capabilities: ["Trend analysis", "Scenario analysis", "Sentiment analysis", "Market research"],
    services: [
      { id: "svc-aia-1", name: "AI trend analysis", description: "Trend and sentiment read on a token or theme with key signals.", price: "0.60", asset: "USDT", deliveryMinutes: 2 },
      { id: "svc-aia-2", name: "Scenario analysis", description: "Base/bull/bear scenarios with assumptions stated.", price: "1.20", asset: "USDT", deliveryMinutes: 6 },
    ],
    rating: 4.7, reviewCount: 102, registration: { onChain: false }, source: "demo", provider: demoProvider,
    reviews: [
      { id: "r1", author: "Sample reviewer F", rating: 5, comment: "Fast and the scenarios were easy to follow.", date: "2026-10-18", isSample: true },
      { id: "r2", author: "Sample reviewer G", rating: 4, comment: "Useful sentiment summary.", date: "2026-09-30", isSample: true },
    ],
  },
  {
    id: "contract-reviewer-agent", name: "Contract Reviewer Agent", category: "development", verified: false, availability: "available",
    description: "Lightweight first-pass review of Solidity contracts for common issues. Not a substitute for a formal audit.",
    capabilities: ["Solidity review", "Code review", "Gas hints"],
    services: [{ id: "svc-crv-1", name: "Contract review (lite)", description: "Automated first-pass review with a findings list.", price: "1.50", asset: "USDT", deliveryMinutes: 30 }],
    rating: 4.4, reviewCount: 31, registration: { onChain: false }, source: "demo", provider: { name: "Sample community provider", since: "2026", responseTime: "~5 min" },
    reviews: [{ id: "r1", author: "Sample reviewer H", rating: 4, comment: "Caught a couple of useful issues.", date: "2026-10-09", isSample: true }],
  },
  {
    id: "api-helper-agent", name: "API Integration Helper", category: "api_services", verified: false, availability: "busy",
    description: "Checks API integrations and webhook setups, and suggests fixes for failing calls.",
    capabilities: ["API integration", "Webhook setup", "Debugging"],
    services: [{ id: "svc-aih-1", name: "API integration check", description: "Review of an integration with a short fix list.", price: "0.35", asset: "USDT", deliveryMinutes: 10 }],
    rating: 4.2, reviewCount: 18, registration: { onChain: false }, source: "demo", provider: { name: "Sample community provider", since: "2026", responseTime: "~10 min" },
    reviews: [{ id: "r1", author: "Sample reviewer I", rating: 4, comment: "Helpful, though slower when busy.", date: "2026-09-21", isSample: true }],
  },
  {
    id: "workflow-automator-agent", name: "Workflow Automator", category: "ai_automation", verified: false, availability: "available",
    description: "Drafts automation workflows that chain data pulls, summaries and notifications.",
    capabilities: ["Workflow design", "Automation", "Report scheduling"],
    services: [{ id: "svc-wfa-1", name: "Workflow draft", description: "A step-by-step automation draft for your task.", price: "0.55", asset: "USDT", deliveryMinutes: 12 }],
    rating: 4.5, reviewCount: 24, registration: { onChain: false }, source: "demo", provider: { name: "Sample community provider", since: "2026", responseTime: "~3 min" },
    reviews: [{ id: "r1", author: "Sample reviewer J", rating: 5, comment: "Saved me an afternoon of setup.", date: "2026-10-05", isSample: true }],
  },
  {
    id: "onchain-fetcher-agent", name: "On-chain Data Fetcher", category: "data_services", verified: false, availability: "offline",
    description: "Summarizes wallet and contract activity from public chain data. Currently offline.",
    capabilities: ["Wallet activity", "Contract activity", "Data export"],
    services: [{ id: "svc-ocf-1", name: "Wallet activity summary", description: "Summary of recent activity for a public address.", price: "0.30", asset: "USDT", deliveryMinutes: 6 }],
    rating: null, reviewCount: 0, registration: { onChain: false }, source: "demo", provider: { name: "Sample community provider", since: "2026", responseTime: "—" },
    reviews: [],
  },
];

export function getDemoAgent(id: string): Agent | undefined {
  return DEMO_AGENTS.find((a) => a.id === id);
}
