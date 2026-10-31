import { z } from "zod";

/**
 * Public (browser-visible) configuration, validated once. Only NEXT_PUBLIC_* values may be read on the client,
 * and they must never contain secrets. Server-only secrets do not belong in this app at all (the FastAPI backend
 * holds the Anthropic, Supabase service-role and HSP credentials).
 */
const schema = z.object({
  appName: z.string().min(1),
  apiBaseUrl: z.string().url().or(z.literal("")),
  supabaseUrl: z.string().url().or(z.literal("")),
  supabaseAnonKey: z.string(),
  chainId: z.union([z.literal(133), z.literal(177)]),
});

const parsed = schema.safeParse({
  appName: process.env.NEXT_PUBLIC_APP_NAME || "PayMesh",
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  chainId: Number(process.env.NEXT_PUBLIC_HSK_CHAIN_ID || 133),
});

if (!parsed.success) {
  // Fail loudly at build/start: a wrong chain id must never silently point users at the wrong network.
  throw new Error(`Invalid public environment configuration: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
}

export const env = parsed.data;
/** True while no backend is configured: pages render clearly-labelled demo data. */
export const isDemoMode = env.apiBaseUrl === "";
