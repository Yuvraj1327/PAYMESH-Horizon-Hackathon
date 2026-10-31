import { z } from "zod";
import type { PolicyInput, SpendingPolicy } from "@/types/payment";

const amount = (label: string) => z.string().trim().min(1, `Enter the ${label}`)
  .regex(/^\d+(\.\d{1,6})?$/, "Use a positive number with up to 6 decimals, e.g. 5 or 0.50")
  .refine((v) => Number(v) > 0, `${label[0]?.toUpperCase()}${label.slice(1)} must be greater than 0`)
  .refine((v) => Number(v) <= 1_000_000_000, "That amount is too large");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9_-]{1,63}$/i;

export const ASSET_CHOICES = ["USDT", "USDC"] as const;
export const NETWORK_CHOICES = [{ id: "133", label: "HashKey Testnet (133)" }, { id: "177", label: "HashKey Mainnet (177)" }] as const;

/** Input validation only. Whether a policy is acceptable (supported assets/networks) is decided by the backend on save. */
export function policyFormSchema(opts: { demo: boolean }) {
  return z.object({
    maxTransactionAmount: amount("per-transaction limit"),
    dailySpendingLimit: amount("daily limit"),
    enabled: z.boolean(),
    allowAllAgents: z.boolean(),
    permittedAgentIds: z.string().trim().max(10_000, "List is too long"),
    allowedAssets: z.array(z.string()).min(1, "Choose at least one payment asset").max(10),
    allowedChainIds: z.array(z.string()).min(1, "Choose at least one network").max(5),
  }).superRefine((v, ctx) => {
    const ids = parseIds(v.permittedAgentIds);
    if (ids.length > 200) ctx.addIssue({ code: "custom", path: ["permittedAgentIds"], message: "At most 200 providers" });
    const re = opts.demo ? SLUG : UUID;
    const bad = ids.find((i) => !re.test(i));
    if (bad) ctx.addIssue({ code: "custom", path: ["permittedAgentIds"], message: `“${bad.slice(0, 40)}” is not a valid provider ID${opts.demo ? "" : " (expected a UUID)"}` });
    if (!v.allowAllAgents && ids.length === 0) ctx.addIssue({ code: "custom", path: ["permittedAgentIds"], message: "Add at least one provider ID, or allow all providers" });
  });
}

export type PolicyFormValues = z.infer<ReturnType<typeof policyFormSchema>>;

export function parseIds(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
}

export function policyToForm(p: SpendingPolicy | null, defaultChain: number): PolicyFormValues {
  return p
    ? { maxTransactionAmount: p.maxTransactionAmount, dailySpendingLimit: p.dailySpendingLimit, enabled: p.enabled, allowAllAgents: p.allowAllAgents, permittedAgentIds: p.permittedAgentIds.join("\n"), allowedAssets: p.allowedAssets, allowedChainIds: p.allowedChainIds.map(String) }
    : { maxTransactionAmount: "", dailySpendingLimit: "", enabled: true, allowAllAgents: false, permittedAgentIds: "", allowedAssets: ["USDT"], allowedChainIds: [String(defaultChain)] };
}

export function formToPolicy(v: PolicyFormValues): PolicyInput {
  return {
    maxTransactionAmount: v.maxTransactionAmount.trim(), dailySpendingLimit: v.dailySpendingLimit.trim(), enabled: v.enabled, allowAllAgents: v.allowAllAgents,
    permittedAgentIds: parseIds(v.permittedAgentIds), allowedAssets: v.allowedAssets, allowedChainIds: v.allowedChainIds.map(Number),
  };
}
