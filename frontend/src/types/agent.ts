export type CategoryId = "research" | "market_intelligence" | "data_services" | "development" | "ai_automation" | "api_services" | "other";
export type Availability = "available" | "busy" | "offline";
export type PaymentAsset = "USDT" | "USDC";
export type DataOrigin = "demo" | "live";

export interface AgentService {
  id: string;
  name: string;
  description: string;
  /** Decimal string; never a float. */
  price: string;
  asset: PaymentAsset;
  deliveryMinutes: number;
}

export interface AgentReview {
  id: string;
  author: string;
  rating: number;
  comment: string;
  date: string;
  /** Reviews in demo mode are illustrative samples, not real customer feedback. */
  isSample: boolean;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  category: CategoryId;
  capabilities: string[];
  services: AgentService[];
  availability: Availability;
  /** PayMesh-operated or reviewed listing. Independent of on-chain registration. */
  verified: boolean;
  rating: number | null;
  reviewCount: number;
  /** Only present when a real payout address exists. Demo agents never carry one. */
  walletAddress?: string;
  registration: { onChain: boolean };
  provider: { name: string; since: string; responseTime: string };
  reviews: AgentReview[];
  /** True for the backend's platform-operated demo providers (real records, flagged by the backend as demo). */
  isPlatformDemo?: boolean;
  source: DataOrigin;
}

export type AgentSort = "price_asc" | "price_desc" | "rating_desc" | "availability";

export interface AgentFilters {
  q?: string;
  category?: CategoryId | "all";
  verifiedOnly?: boolean;
  availableOnly?: boolean;
  sort?: AgentSort;
}
