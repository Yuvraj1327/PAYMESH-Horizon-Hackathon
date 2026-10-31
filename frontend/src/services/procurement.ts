import { isDemoMode } from "@/lib/env";
import { assertValidInput } from "@/lib/validation";
import { BackendNotConnectedError, NotFoundError, delay } from "@/services/errors";
import { DEMO_AGENTS } from "@/services/demo/agents";
import { SelectionError, applySelection, createRequestRecords, type DemoDb } from "@/services/demo/engine";
import { getDb, mutateDb, resetDb } from "@/services/demo/store";
import { liveApi } from "@/services/live/api";
import { categoryToApi, composeDescription, mapMessage, mapQuotation, mapRecommendation, mapRequest } from "@/services/live/mappers";
import type { AgentActivity, NewRequestInput, RequestDetail, RequestSummary } from "@/types/procurement";

const nameOf = (id: string | null): string | null => (id ? (DEMO_AGENTS.find((a) => a.id === id)?.name ?? null) : null);
const clone = <T,>(v: T): T => structuredClone(v);

function summarize(db: DemoDb): RequestSummary[] {
  return db.requests
    .map((r) => ({ ...r, quotationCount: db.quotations.filter((q) => q.requestId === r.id).length, selectedAgentName: nameOf(r.selectedAgentId) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function requireDemo(what: string): void {
  if (!isDemoMode) throw new BackendNotConnectedError(what);
}

export async function listRequests(): Promise<RequestSummary[]> {
  if (!isDemoMode) {
    const [requests, quotes, agents] = await Promise.all([liveApi.requests(), liveApi.allQuotations(), liveApi.agents()]);
    const names = new Map(agents.map((a) => [a.id, a.name]));
    return requests
      .map((r) => {
        const mine = quotes.filter((q) => q.request_id === r.id);
        return { ...mapRequest(r, mine), quotationCount: mine.length, selectedAgentName: r.selected_provider_id ? (names.get(r.selected_provider_id) ?? null) : null };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  await delay(200);
  return clone(summarize(getDb()));
}

export async function getRequestDetail(id: string): Promise<RequestDetail> {
  if (!isDemoMode) {
    const req = await liveApi.request(id);
    const [quotes, agents, services, messages] = await Promise.all([
      liveApi.requestQuotations(id), liveApi.agents(), liveApi.services(), liveApi.messages(id).catch(() => []),
    ]);
    const agentById = new Map(agents.map((a) => [a.id, a]));
    const serviceById = new Map(services.map((s) => [s.id, s]));
    const quotations = quotes.map((q) => mapQuotation(q, agentById.get(q.provider_agent_id), q.service_id ? serviceById.get(q.service_id) : undefined))
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    const request = mapRequest(req, quotes);
    if (request.recommendation === null) request.recommendation = mapRecommendation(id, req.recommendation);
    const refs = [...new Set(quotes.map((q) => q.provider_agent_id))].flatMap((aid) => {
      const a = agentById.get(aid);
      return a ? [{ id: a.id, name: a.name, category: request.category }] : [];
    });
    return {
      request, quotations, agents: refs.map((r) => ({ ...r, category: mapAgentCategory(agentById.get(r.id)?.category) })),
      events: messages.map(mapMessage).sort((a, b) => a.at.localeCompare(b.at)),
      selectedAgentName: req.selected_provider_id ? (agentById.get(req.selected_provider_id)?.name ?? null) : null,
    };
  }
  await delay(200);
  const db = getDb();
  const request = db.requests.find((r) => r.id === id);
  if (!request) throw new NotFoundError("Procurement request");
  const quotations = db.quotations.filter((q) => q.requestId === id).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  return clone({
    request,
    quotations,
    agents: [...new Set(quotations.map((q) => q.agentId))].flatMap((aid) => { const a = DEMO_AGENTS.find((x) => x.id === aid); return a ? [{ id: a.id, name: a.name, category: a.category }] : []; }),
    events: db.events.filter((e) => e.requestId === id).sort((a, b) => a.at.localeCompare(b.at)),
    selectedAgentName: nameOf(request.selectedAgentId),
  });
}

import { categoryFromApi } from "@/services/live/mappers";
function mapAgentCategory(c: string | undefined) { return categoryFromApi(c ?? "other"); }

/**
 * Validates (same rules as the form), then creates the request.
 * Live: POST /procurement/requests (the Buyer Agent extracts requirements) → POST …/quotations (broadcast to matching
 * providers; platform demo providers quote immediately) → POST …/recommend (best effort: a failed recommendation never
 * blocks the user from comparing quotations).
 */
export async function createRequest(input: NewRequestInput): Promise<{ id: string }> {
  assertValidInput(input); // throws ZodError before any network call or state change
  if (!isDemoMode) {
    const created = await liveApi.create({
      description: composeDescription(input), max_budget: input.maxBudget, budget_asset: input.asset, category: categoryToApi(input.category), use_ai: true,
    });
    try {
      const r = await liveApi.broadcast(created.id);
      if (r.created_quotations.length > 0) await liveApi.recommend(created.id).catch(() => undefined);
    } catch {
      /* the request exists; the quotations page offers "Request quotations" again, nothing is retried silently */
    }
    return { id: created.id };
  }
  await delay(700);
  return mutateDb((db) => {
    const rec = createRequestRecords(input, DEMO_AGENTS, new Date());
    db.requests.push(rec.request);
    db.quotations.push(...rec.quotations);
    db.events.push(...rec.events);
    return { id: rec.request.id };
  });
}

/** Live only: ask matching providers for quotations (again). Demo requests already hold their quotations. */
export async function requestQuotations(requestId: string): Promise<{ id: string }> {
  requireDemoOff("Requesting quotations");
  const r = await liveApi.broadcast(requestId);
  if (r.created_quotations.length > 0) await liveApi.recommend(requestId).catch(() => undefined);
  return { id: requestId };
}

function requireDemoOff(what: string): void {
  if (isDemoMode) throw new BackendNotConnectedError(what);
}

export async function selectProvider(requestId: string, quotationId: string): Promise<{ id: string }> {
  if (!isDemoMode) {
    await liveApi.select(requestId, quotationId);
    return { id: requestId };
  }
  await delay(350);
  try {
    mutateDb((db) => applySelection(db, requestId, quotationId, DEMO_AGENTS, new Date()));
  } catch (e) {
    if (e instanceof SelectionError) throw e;
    throw e;
  }
  return { id: requestId };
}

export async function cancelRequest(requestId: string): Promise<void> {
  if (!isDemoMode) {
    await liveApi.cancel(requestId);
    return;
  }
  await delay(250);
  mutateDb((db) => {
    const r = db.requests.find((x) => x.id === requestId);
    if (!r) throw new NotFoundError("Procurement request");
    if (r.status === "completed" || r.status === "cancelled") throw new SelectionError("This request can no longer be cancelled.");
    r.status = "cancelled"; r.updatedAt = new Date().toISOString();
    db.events.push({ id: `evt_cancel_${Date.now()}`, requestId, type: "request_cancelled", actor: "user", title: "Request cancelled", detail: "Cancelled by you. Nothing was paid.", at: r.updatedAt });
  });
}

export async function resetDemoData(): Promise<void> {
  requireDemo("Resetting demo data");
  resetDb();
}

/** Agent-console rows are derived from real recorded events/messages — nothing is invented. */
export async function listAgentActivity(): Promise<AgentActivity[]> {
  if (!isDemoMode) {
    const recent = (await liveApi.requests()).slice(0, 5);
    const lists = await Promise.all(recent.map((r) => liveApi.messages(r.id).catch(() => [])));
    return lists.flat().map(mapMessage)
      .filter((e): e is typeof e & { actor: AgentActivity["role"] } => e.actor !== "user" && e.actor !== "system")
      .map((e) => ({ id: e.id, role: e.actor, title: e.title, detail: e.detail, at: e.at, requestId: e.requestId }))
      .sort((a, b) => b.at.localeCompare(a.at));
  }
  await delay(150);
  const db = getDb();
  const rows: AgentActivity[] = [];
  for (const e of db.events) {
    if (e.actor === "user" || e.actor === "system") continue;
    rows.push({ id: e.id, role: e.actor, title: e.title, detail: e.detail, at: e.at, requestId: e.requestId });
  }
  return clone(rows.sort((a, b) => b.at.localeCompare(a.at)));
}
