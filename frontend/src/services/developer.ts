import { liveApi } from "@/services/live/api";
import { categoryToApi, mapAgent } from "@/services/live/mappers";
import type { Agent, CategoryId } from "@/types/agent";

export interface AgentInput { name: string; description: string; walletAddress: string; category: CategoryId; capabilities: string[] }
export interface ServiceInput { agentId: string; name: string; description: string; price: string; asset: string; deliveryMinutes: number }

/** Agents owned by the signed-in user (GET /agents?mine=true) with their services. */
export async function listMyAgents(): Promise<Agent[]> {
  const [agents, services] = await Promise.all([liveApi.myAgents(), liveApi.services()]);
  return agents.map((a) => mapAgent(a, services));
}

/** POST /agents. The backend rejects unknown fields, validates the wallet (EIP-55) and stores ownership from the token. */
export async function registerAgent(i: AgentInput): Promise<Agent> {
  const a = await liveApi.registerAgent({ name: i.name, description: i.description, wallet_address: i.walletAddress, category: categoryToApi(i.category), capabilities: i.capabilities });
  return mapAgent(a, []);
}

/** POST /services. */
export async function createService(i: ServiceInput): Promise<void> {
  await liveApi.createService({ provider_agent_id: i.agentId, name: i.name, description: i.description, price: i.price, payment_asset: i.asset, delivery_estimate_minutes: i.deliveryMinutes, is_available: true });
}

/** Admin only (the backend enforces it): idempotently creates the platform demo providers. */
export async function seedDemoAgents(): Promise<void> {
  await liveApi.seedDemoAgents();
}
