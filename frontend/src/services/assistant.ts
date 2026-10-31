import { isDemoMode } from "@/lib/env";
import { delay } from "@/services/errors";
import { liveApi } from "@/services/live/api";
import { categoryFromApi } from "@/services/live/mappers";
import { listLiveAgents } from "@/services/marketplace";
import { deriveTitle } from "@/services/live/mappers";
import type { PaymentAsset } from "@/types/agent";
import { DEMO_AGENTS } from "@/services/demo/agents";
import { buildReply, extractRequirements, missingFields, recommendAgents } from "@/services/demo/assistant-engine";
import type { AgentMessage, ExtractedRequirements } from "@/types/procurement";

export interface AssistantRequest {
  message: string;
  /** Requirements gathered earlier in this conversation (so follow-ups refine rather than restart). */
  previous: ExtractedRequirements | null;
}

export const MAX_ASSISTANT_MESSAGE = 1000;

export class AssistantInputError extends Error {}

/**
 * Integration boundary for the AI Buyer Agent. Live mode calls the backend (which runs Claude server-side);
 * the response shape (`AgentMessage`) is already what the UI renders. Demo mode answers with transparent heuristics
 * and labels every reply as a demo response. No model reasoning traces are produced or displayed.
 */
export async function sendAssistantMessage({ message, previous }: AssistantRequest): Promise<AgentMessage> {
  const text = message.trim();
  if (text.length < 5) throw new AssistantInputError("Please describe your task in a few words.");
  if (text.length > MAX_ASSISTANT_MESSAGE) throw new AssistantInputError(`Messages are limited to ${MAX_ASSISTANT_MESSAGE} characters.`);
  if (!isDemoMode) {
    // Genuine backend call: Claude runs server-side (POST /ai/extract-requirements). Follow-ups are folded into the text
    // because the endpoint is stateless. Provider matching then runs on the live marketplace listings.
    const combined = previous ? `${previous.title}\n${previous.description}\n${text}`.slice(0, 4000) : text;
    const dto = await liveApi.extract(combined);
    const { title } = deriveTitle(dto.summary);
    const extracted: ExtractedRequirements = {
      title, category: categoryFromApi(dto.category), requiredCapabilities: previous?.requiredCapabilities ?? [],
      maxBudget: dto.max_budget, asset: ((dto.budget_asset ?? previous?.asset ?? "USDT") as PaymentAsset), preferredDeliveryMinutes: dto.delivery_deadline_minutes,
      description: [dto.summary, ...dto.constraints].join("\n"),
    };
    const missing = missingFields(extracted);
    const recommendations = missing.length ? [] : recommendAgents(await listLiveAgents(), extracted);
    return {
      id: `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, role: "assistant", content: buildReply(extracted, recommendations, missing),
      createdAt: new Date().toISOString(), source: "live", extracted, recommendations, missing,
    };
  }
  await delay(900);
  const extracted = extractRequirements(text, previous);
  const missing = missingFields(extracted);
  const recommendations = missing.length ? [] : recommendAgents(DEMO_AGENTS, extracted);
  return {
    id: `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    role: "assistant", content: buildReply(extracted, recommendations, missing), createdAt: new Date().toISOString(),
    source: "demo", extracted, recommendations, missing,
  };
}
