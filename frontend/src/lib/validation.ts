import { z } from "zod";
import { CATEGORY_IDS, DELIVERY_OPTIONS, PAYMENT_ASSETS } from "@/constants/categories";
import type { NewRequestInput } from "@/types/procurement";

const budget = z
  .string()
  .trim()
  .min(1, "Enter a maximum budget")
  .regex(/^\d+(\.\d{1,6})?$/, "Use a positive number with up to 6 decimals, e.g. 1 or 0.50")
  .refine((v) => Number(v) > 0, "Budget must be greater than 0")
  .refine((v) => Number(v) <= 1_000_000, "Budget is too large");

/** Single source of truth for request validation (form, assistant and service layer all use it). */
export const requestFormSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(120, "Title is too long (120 max)"),
  category: z.enum(CATEGORY_IDS, { error: "Choose a service category" }),
  description: z.string().trim().min(20, "Describe the task in at least 20 characters").max(2000, "Description is too long (2000 max)"),
  capabilities: z.array(z.string().trim().min(2, "Capability is too short").max(40, "Capability is too long")).max(10, "Add at most 10 capabilities"),
  maxBudget: budget,
  asset: z.enum(PAYMENT_ASSETS, { error: "Choose a payment asset" }),
  preferredDelivery: z.enum(DELIVERY_OPTIONS.map((d) => d.value) as [string, ...string[]]),
  additionalInstructions: z.string().trim().max(1000, "Instructions are too long (1000 max)"),
});

export type RequestFormValues = z.infer<typeof requestFormSchema>;

export function formValuesToInput(v: RequestFormValues, preferredAgentId: string | null, origin: "form" | "assistant" = "form"): NewRequestInput {
  return {
    title: v.title,
    description: v.description,
    category: v.category,
    requiredCapabilities: dedupeCaps(v.capabilities),
    maxBudget: normalizeAmount(v.maxBudget),
    asset: v.asset,
    preferredDeliveryMinutes: v.preferredDelivery === "none" ? null : Number(v.preferredDelivery),
    additionalInstructions: v.additionalInstructions,
    preferredAgentId,
    origin,
  };
}

export function dedupeCaps(caps: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of caps.map((x) => x.trim()).filter(Boolean)) {
    const k = c.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(c); }
  }
  return out;
}

/** "1.500000" -> "1.5", "01" -> "1". Keeps decimals as strings (no float rounding). */
export function normalizeAmount(v: string): string {
  const [i = "0", f = ""] = v.trim().split(".");
  const frac = f.replace(/0+$/, "");
  const int = i.replace(/^0+(?=\d)/, "");
  return frac ? `${int}.${frac}` : int;
}

/** Validates a service-layer input with the same rules as the form. Throws ZodError on invalid data. */
export function assertValidInput(input: NewRequestInput): void {
  requestFormSchema.parse({
    title: input.title,
    category: input.category,
    description: input.description,
    capabilities: input.requiredCapabilities,
    maxBudget: input.maxBudget,
    asset: input.asset,
    preferredDelivery: input.preferredDeliveryMinutes === null ? "none" : String(input.preferredDeliveryMinutes),
    additionalInstructions: input.additionalInstructions,
  });
}
