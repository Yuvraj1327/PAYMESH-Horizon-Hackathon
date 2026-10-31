import type { GuardianCheck, GuardianResult, GuardianState, RuleFailure } from "@/types/payment";

/**
 * Presentation only: groups the backend's rule failures into the Payment Guardian checks shown to the user.
 * The backend decides pass/fail; this file never evaluates a policy. A rule that is absent from the backend's
 * failure list was evaluated and passed (the backend collects every failure before answering).
 */
interface Group { id: string; label: string; rules: string[]; passedDetail: string; core: boolean }

const GROUPS: Group[] = [
  { id: "max_amount", label: "Maximum transaction amount", core: true, rules: ["max_transaction_amount", "amount_positive", "budget_exceeded"], passedDetail: "Within your per-transaction limit and the request budget." },
  { id: "daily_limit", label: "Daily spending limit", core: true, rules: ["daily_limit"], passedDetail: "Within your daily spending limit." },
  { id: "providers", label: "Allowed providers", core: true, rules: ["policy_agent"], passedDetail: "This provider is permitted by your policy." },
  { id: "assets", label: "Supported payment assets", core: true, rules: ["policy_asset", "asset_supported", "asset_mismatch"], passedDetail: "The payment asset is supported and permitted." },
  { id: "networks", label: "Allowed networks", core: true, rules: ["policy_network", "network_supported"], passedDetail: "The network is supported and permitted." },
  { id: "expiry", label: "Payment expiry", core: true, rules: ["request_expired", "quotation_expired"], passedDetail: "The request and quotation are still valid." },
  { id: "recipient", label: "Provider & recipient integrity", core: false, rules: ["provider_exists", "provider_active", "recipient_changed", "recipient_valid", "self_payment"], passedDetail: "Recipient matches the provider's current wallet." },
  { id: "selection", label: "Request & quotation state", core: false, rules: ["request_ownership", "quotation_association", "provider_selection", "request_status", "quotation_status", "conditions_changed", "snapshot_integrity"], passedDetail: "The selected quotation is current." },
  { id: "policy", label: "Spending policy", core: false, rules: ["policy_missing", "policy_disabled"], passedDetail: "A spending policy is active." },
];

const POLICY_CORE = new Set(["max_amount", "daily_limit", "providers", "assets", "networks"]);
const EXPIRY_WARNING_MS = 5 * 60_000;

export function buildGuardianChecks(result: GuardianResult | null, opts: { expiresAt?: string | null; now?: number } = {}): GuardianCheck[] {
  const now = opts.now ?? Date.now();
  const evaluated = !!result?.evaluated;
  const failures: RuleFailure[] = result?.failures ?? [];
  const policyFault = failures.find((f) => f.rule === "policy_missing" || f.rule === "policy_disabled");
  const known = new Set(GROUPS.flatMap((g) => g.rules));
  const unknown = failures.filter((f) => !known.has(f.rule));

  const checks: GuardianCheck[] = [];
  for (const g of GROUPS) {
    const hits = failures.filter((f) => g.rules.includes(f.rule));
    let state: GuardianState; let detail: string;
    if (!evaluated) { state = "not_evaluated"; detail = "Not checked yet. The backend evaluates this when the payment is created."; }
    else if (hits.length) { state = "blocked"; detail = hits.map((h) => h.message).join(" "); }
    else if (policyFault && POLICY_CORE.has(g.id)) { state = "blocked"; detail = `Not evaluated: ${policyFault.message}.`; }
    else { state = "passed"; detail = g.passedDetail; }
    if (g.id === "expiry" && state === "passed" && opts.expiresAt) {
      const left = new Date(opts.expiresAt).getTime() - now;
      if (Number.isFinite(left) && left <= 0) { state = "blocked"; detail = "This payment's authorization window has ended."; }
      else if (Number.isFinite(left) && left < EXPIRY_WARNING_MS) { state = "warning"; detail = `Expires in under ${Math.max(1, Math.ceil(left / 60_000))} min. Authorize soon or the payment will expire.`; }
    }
    if (g.core || hits.length || (policyFault && g.id === "policy")) checks.push({ id: g.id, label: g.label, state, detail });
  }
  if (unknown.length) checks.push({ id: "other", label: "Other checks", state: "blocked", detail: unknown.map((u) => u.message).join(" ") });
  if (evaluated && result?.hspConfigured === false) checks.push({ id: "hsp", label: "HSP gateway", state: "warning", detail: "The backend reports that HSP is not configured, so an order cannot be registered yet." });
  return checks;
}

export function isBlocked(checks: GuardianCheck[]): boolean {
  return checks.some((c) => c.state === "blocked");
}
