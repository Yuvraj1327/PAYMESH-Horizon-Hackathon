import { z } from "zod";
import { ApiError, apiRequest } from "@/lib/api/client";
import { NotFoundError } from "@/services/errors";
import { agentDto, extractedDto, messageDto, page, quotationDto, requestDto, serviceDto } from "@/services/live/schemas";

/** Thin typed wrappers over the real FastAPI endpoints (backend/app/api/v1). 404/422-on-bad-id become NotFoundError. */
const MAX = 100; // backend maximum page size

export const liveApi = {
  agents: () => apiRequest(`/api/v1/agents?limit=${MAX}`, { schema: page(agentDto) }).then((p) => p.items),
  myAgents: () => apiRequest(`/api/v1/agents?mine=true&limit=${MAX}`, { schema: page(agentDto) }).then((p) => p.items),
  agent: (id: string) => apiRequest(`/api/v1/agents/${encodeURIComponent(id)}`, { schema: agentDto }).catch(notFound("Agent")),
  services: (agentId?: string) => apiRequest(`/api/v1/services?limit=${MAX}${agentId ? `&agent_id=${encodeURIComponent(agentId)}` : ""}`, { schema: page(serviceDto) }).then((p) => p.items),
  requests: () => apiRequest(`/api/v1/procurement/requests?limit=${MAX}`, { schema: page(requestDto) }).then((p) => p.items),
  request: (id: string) => apiRequest(`/api/v1/procurement/requests/${encodeURIComponent(id)}`, { schema: requestDto }).catch(notFound("Procurement request")),
  requestQuotations: (id: string) => apiRequest(`/api/v1/procurement/requests/${encodeURIComponent(id)}/quotations`, { schema: z.array(quotationDto) }),
  allQuotations: () => apiRequest(`/api/v1/quotations?limit=${MAX}`, { schema: page(quotationDto) }).then((p) => p.items),
  messages: (id: string) => apiRequest(`/api/v1/ai/requests/${encodeURIComponent(id)}/messages?limit=${MAX}`, { schema: page(messageDto) }).then((p) => p.items),
  create: (body: Record<string, unknown>) => apiRequest("/api/v1/procurement/requests", { method: "POST", body, schema: requestDto }),
  broadcast: (id: string) => apiRequest(`/api/v1/procurement/requests/${encodeURIComponent(id)}/quotations`, { method: "POST", schema: z.object({ created_quotations: z.array(z.unknown()).default([]), awaiting_external_agents: z.array(z.string()).default([]) }) }),
  recommend: (id: string) => apiRequest(`/api/v1/procurement/requests/${encodeURIComponent(id)}/recommend`, { method: "POST", schema: z.record(z.string(), z.unknown()) }),
  select: (id: string, quotationId: string) => apiRequest(`/api/v1/procurement/requests/${encodeURIComponent(id)}/select`, { method: "POST", body: { quotation_id: quotationId }, schema: requestDto }),
  cancel: (id: string) => apiRequest(`/api/v1/procurement/requests/${encodeURIComponent(id)}/cancel`, { method: "POST", schema: requestDto }),
  extract: (text: string) => apiRequest("/api/v1/ai/extract-requirements", { method: "POST", body: { text }, schema: extractedDto }),
  aiStatus: () => apiRequest("/api/v1/ai/status", { schema: z.object({ configured: z.boolean(), model: z.string().nullish() }) }),
  registerAgent: (body: Record<string, unknown>) => apiRequest("/api/v1/agents", { method: "POST", body, schema: agentDto }),
  createService: (body: Record<string, unknown>) => apiRequest("/api/v1/services", { method: "POST", body, schema: serviceDto }),
  seedDemoAgents: () => apiRequest("/api/v1/agents/demo/seed", { method: "POST", schema: z.record(z.string(), z.unknown()) }),
};

function notFound(what: string) {
  return (e: unknown): never => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 422)) throw new NotFoundError(what);
    throw e;
  };
}
