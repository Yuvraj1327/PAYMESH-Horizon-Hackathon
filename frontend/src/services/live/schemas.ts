import { z } from "zod";
import { trimDecimal } from "@/lib/decimal";

/** Zod mirrors of the FastAPI response models (backend/app/schemas/*.py). Untrusted data is never cast. */
export const dec = z.union([z.string(), z.number()]).transform((v) => trimDecimal(v));
export const nstr = z.string().nullish().transform((v) => v ?? null);
export const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), total: z.number(), limit: z.number(), offset: z.number() });

export const agentDto = z.object({
  id: z.string(), owner_id: nstr, kind: z.string(), is_demo: z.boolean(), name: z.string(), description: z.string().default(""),
  wallet_address: z.string(), category: z.string(), capabilities: z.array(z.string()).default([]), status: z.string(),
  onchain_registration_reference: nstr, reputation: z.number().nullish().transform((v) => v ?? null), created_at: z.string(),
});
export type AgentDto = z.infer<typeof agentDto>;

export const serviceDto = z.object({
  id: z.string(), provider_agent_id: z.string(), name: z.string(), description: z.string().default(""), price: dec,
  payment_asset: z.string(), is_available: z.boolean(), delivery_estimate_minutes: z.number(), created_at: z.string(),
});
export type ServiceDto = z.infer<typeof serviceDto>;

export const requestDto = z.object({
  id: z.string(), buyer_id: z.string(), description: z.string(), category: z.string(), requirements: z.record(z.string(), z.unknown()).default({}),
  max_budget: dec, budget_asset: z.string(), status: z.string(), selected_provider_id: nstr, selected_quotation_id: nstr,
  recommendation: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? null), delivery_status: z.string().default("not_started"),
  expires_at: nstr, created_at: z.string(),
});
export type RequestDto = z.infer<typeof requestDto>;

export const quotationDto = z.object({
  id: z.string(), request_id: z.string(), provider_agent_id: z.string(), service_id: nstr, price: dec, payment_asset: z.string(), chain_id: z.number(),
  pay_to_address: z.string(), delivery_estimate_minutes: z.number(), response_details: z.record(z.string(), z.unknown()).default({}),
  status: z.string(), expires_at: z.string(), created_at: z.string(),
});
export type QuotationDto = z.infer<typeof quotationDto>;

export const messageDto = z.object({
  id: z.string(), request_id: nstr, sender_role: z.string(), receiver_role: z.string(), message_type: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}), created_at: z.string(),
});
export type MessageDto = z.infer<typeof messageDto>;

export const extractedDto = z.object({
  category: z.string(), summary: z.string(), max_budget: dec.nullish().transform((v) => v ?? null), budget_asset: nstr,
  delivery_deadline_minutes: z.number().nullish().transform((v) => v ?? null), constraints: z.array(z.string()).default([]),
});
export type ExtractedDto = z.infer<typeof extractedDto>;

export const recommendationDto = z.object({
  recommended_quotation_id: nstr,
  ranking: z.array(z.object({ quotation_id: z.string(), score: z.number(), notes: z.string().default("") })).default([]),
  rationale: z.string().default(""), generated_by: z.string().default("deterministic_fallback"), generated_at: nstr,
});
export type RecommendationDto = z.infer<typeof recommendationDto>;
