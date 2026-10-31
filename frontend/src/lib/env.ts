import { z } from "zod";

/**
 * Public (browser-visible) configuration, validated once. Only NEXT_PUBLIC_* values may be read on the client,
 * and they must never contain secrets. Server-only secrets do not belong in this app at all (the FastAPI backend
 * holds the Anthropic, Supabase service-role and HSP credentials).
 */
const schema = z.object({
  appName: z.string().min(1),
  // https required except for local development (a bearer token must never travel over plain http to a remote host).
  apiBaseUrl: z.string().url().refine((u) => u.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u), "must be https (http is allowed only for localhost)").or(z.literal("")),
  supabaseUrl: z.string().url().or(z.literal("")),
  supabaseAnonKey: z.string(),
  chainId: z.union([z.literal(133), z.literal(177)]),
  /** Optional block-explorer base URLs (https). Not hardcoded: set only values you have verified. */
  explorerUrl133: z.string().url().startsWith("https://").or(z.literal("")),
  explorerUrl177: z.string().url().startsWith("https://").or(z.literal("")),
});

const parsed = schema.safeParse({
  appName: process.env.NEXT_PUBLIC_APP_NAME || "PayMesh",
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  chainId: Number(process.env.NEXT_PUBLIC_HSK_CHAIN_ID || 133),
  explorerUrl133: process.env.NEXT_PUBLIC_EXPLORER_URL_133 ?? "",
  explorerUrl177: process.env.NEXT_PUBLIC_EXPLORER_URL_177 ?? "",
});

if (!parsed.success) {
  // Fail loudly at build/start: a wrong chain id must never silently point users at the wrong network.
  throw new Error(`Invalid public environment configuration: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
}

export const env = parsed.data;
/** True while no backend is configured: pages render clearly-labelled demo data. */
export const isDemoMode = env.apiBaseUrl === "";

/** Supabase-backed sign-in is available only when both public values are set. */
export const authConfigured = env.supabaseUrl !== "" && env.supabaseAnonKey !== "";
/**
 * "preview": no backend configured (demo mode) → no sign-in, labelled preview identity.
 * "supabase": backend configured → every API call needs a Supabase session (the backend verifies the JWT).
 * "unconfigured": backend configured but Supabase public values missing → cannot authenticate; the UI says so.
 */
export const authMode: "preview" | "supabase" | "unconfigured" = isDemoMode ? "preview" : authConfigured ? "supabase" : "unconfigured";
