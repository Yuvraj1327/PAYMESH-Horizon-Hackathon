export type DataSource = "demo" | "live";

export type RequestStatus = "awaiting_quotes" | "quotes_ready" | "provider_selected" | "payment_pending";

export interface Kpi {
  key: "totalRequests" | "activeProcurement" | "totalPayments" | "connectedAgents";
  label: string;
  value: string;
  hint: string;
}

export interface ActivityItem {
  id: string;
  kind: "request" | "quotation" | "selection" | "payment" | "agent";
  title: string;
  detail: string;
  /** Human-readable relative time (demo only). */
  when: string;
}

export interface ActiveRequest {
  id: string;
  title: string;
  category: string;
  budget: string;
  asset: string;
  status: RequestStatus;
  quotations: number;
}

export interface FeaturedAgent {
  id: string;
  name: string;
  category: string;
  description: string;
  capabilities: string[];
  startingPrice: string;
  asset: string;
  isDemo: boolean;
}

export interface PaymentSummary {
  asset: string;
  pending: { count: number; amount: string };
  completed: { count: number; amount: string };
  /** Settlements independently verified on-chain. Always 0 for demo data. */
  verifiedOnChain: number;
}

export interface QuickAction {
  id: string;
  label: string;
  description: string;
  href: string;
}

export interface DashboardData {
  source: DataSource;
  user: { name: string; email: string | null };
  kpis: Kpi[];
  activity: ActivityItem[];
  activeRequests: ActiveRequest[];
  featuredAgents: FeaturedAgent[];
  payments: PaymentSummary;
}
