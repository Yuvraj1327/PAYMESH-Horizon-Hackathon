import { isDemoMode } from "@/lib/env";
import { formatTokenAmount, trimDecimal } from "@/lib/decimal";
import { toMicro } from "@/lib/money";
import { getCategory } from "@/constants/categories";
import { timeAgo } from "@/components/common/format";
import { listAgents } from "@/services/marketplace";
import { listRequests } from "@/services/procurement";
import { payments } from "@/services/payments";
import { isTerminal, type PaymentRecord } from "@/types/payment";
import type { Agent } from "@/types/agent";
import type { RequestSummary } from "@/types/procurement";
import type { ActiveRequest, ActivityItem, DashboardData, RequestStatus } from "@/types/dashboard";

const OPEN: RequestSummary["status"][] = ["awaiting_quotes", "quotes_ready", "provider_selected"];

const PAYMENT_TITLE: Record<PaymentRecord["status"], string> = {
  DRAFT: "Payment created", VALIDATED: "Payment validated by Guardian", AWAITING_SIGNATURE: "Payment awaiting authorization",
  SIGNED: "Payment signed, processing", SUBMITTED: "Payment submitted to HSP", PENDING: "Payment processing at HSP",
  SETTLED: "Payment verified", FAILED: "Payment failed", EXPIRED: "Payment expired", CANCELLED: "Payment cancelled",
};

/**
 * Pure aggregation of the three real data sources (procurement requests, payments, agents). The same function builds the
 * dashboard in demo mode (from the labelled demo stores) and in live mode (from the backend), so the numbers always
 * agree with the Procurement, Payments and Marketplace pages.
 */
export function buildDashboard(input: { requests: RequestSummary[]; payments: PaymentRecord[]; agents: Agent[]; user: { name: string; email: string | null }; source: "demo" | "live" }): DashboardData {
  const { requests, agents, source } = input;
  const pays = input.payments;
  const open = requests.filter((r) => OPEN.includes(r.status));
  const activePayByRequest = new Set(pays.filter((p) => !isTerminal(p.status)).map((p) => p.requestId));
  const settled = pays.filter((p) => p.status === "SETTLED");
  const inFlight = pays.filter((p) => !isTerminal(p.status));
  const waiting = requests.filter((r) => r.status === "quotes_ready" || r.status === "provider_selected").length;

  const asset = pays[0]?.asset ?? "USDT";
  const sum = (list: PaymentRecord[]) => {
    const t = list.filter((p) => p.asset === asset).reduce((a, p) => a + toMicro(p.amount), 0n);
    const s = t.toString().padStart(7, "0");
    return trimDecimal(`${s.slice(0, -6)}.${s.slice(-6)}`);
  };

  const events: (ActivityItem & { at: string })[] = [
    ...requests.flatMap((r) => [
      { id: `req-${r.id}`, kind: "request" as const, title: "Procurement request created", detail: `“${r.title}” — budget ${formatTokenAmount(r.maxBudget)} ${r.asset}.`, at: r.createdAt },
      ...(r.selectedAgentName ? [{ id: `sel-${r.id}`, kind: "selection" as const, title: "Provider selected", detail: `${r.selectedAgentName} chosen for “${r.title}”.`, at: r.updatedAt }] : []),
    ]),
    ...pays.map((p) => ({ id: `pay-${p.id}`, kind: "payment" as const, title: PAYMENT_TITLE[p.status], detail: `${p.providerName} — ${formatTokenAmount(p.amount)} ${p.asset}.`, at: p.updatedAt })),
  ].map((e) => ({ ...e, when: timeAgo(e.at) })).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);

  const activeRequests: ActiveRequest[] = open.slice(0, 4).map((r) => ({
    id: r.id, title: r.title, category: getCategory(r.category).label, budget: formatTokenAmount(r.maxBudget), asset: r.asset,
    status: (r.status === "provider_selected" && activePayByRequest.has(r.id) ? "payment_pending" : r.status) as RequestStatus, quotations: r.quotationCount,
  }));

  const featured = [...agents].filter((a) => a.services.length).sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1)).slice(0, 3);
  // Walkthrough progress counts only the user's own records (demo seed history is excluded).
  const mine = requests.filter((r) => !r.isSample);
  const minePays = pays.filter((p) => !p.id.startsWith("demo-pay-"));
  const latest = mine[0] ?? null;
  const progress = {
    latestRequestId: latest?.id ?? null, hasRequest: mine.length > 0, maxQuotes: Math.max(0, ...mine.map((r) => r.quotationCount)),
    selected: mine.some((r) => r.status === "provider_selected" || r.status === "completed"), hasPayment: minePays.length > 0,
    authorized: minePays.some((p) => ["SIGNED", "SUBMITTED", "PENDING", "SETTLED"].includes(p.status)), settled: minePays.some((p) => p.status === "SETTLED"),
  };
  return {
    source, progress, user: input.user,
    kpis: [
      { key: "totalRequests", label: "Total Requests", value: String(requests.length), hint: `${open.length} open` },
      { key: "activeProcurement", label: "Active Procurement", value: String(open.length), hint: waiting ? `${waiting} awaiting your decision` : "Nothing waiting on you" },
      { key: "totalPayments", label: "Total Payments", value: String(pays.length), hint: `${settled.length} completed · ${inFlight.length} pending` },
      { key: "connectedAgents", label: "Connected Agents", value: String(agents.length), hint: source === "demo" ? "Demonstration providers" : "Providers in the marketplace" },
    ],
    activity: events,
    activeRequests,
    featuredAgents: featured.map((a) => ({
      id: a.id, name: a.name, category: getCategory(a.category).label, description: a.description, capabilities: a.capabilities.slice(0, 3),
      startingPrice: a.services.reduce((m, s) => (toMicro(s.price) < toMicro(m) ? s.price : m), a.services[0]!.price), asset: a.services[0]!.asset, isDemo: a.source === "demo" || !!a.isPlatformDemo,
    })),
    payments: {
      asset, pending: { count: inFlight.length, amount: sum(inFlight) }, completed: { count: settled.length, amount: sum(settled) },
      // Only backend-verified settlements count; demo records never do.
      verifiedOnChain: source === "live" ? settled.length : 0,
    },
  };
}

/** Real aggregation in both modes; demo mode reads the labelled demo stores, live mode reads the backend. */
export async function getDashboardData(): Promise<DashboardData> {
  const [requests, pays, agents] = await Promise.all([listRequests(), payments.list().then((l) => l.items), listAgents({})]);
  let user = { name: "Preview User", email: null as string | null };
  if (!isDemoMode) {
    const { fetchMe } = await import("@/services/profile");
    const me = await fetchMe();
    user = { name: me.fullName || (me.email ? me.email.split("@")[0]! : "Account"), email: me.email };
  }
  return buildDashboard({ requests, payments: pays, agents, user, source: isDemoMode ? "demo" : "live" });
}
