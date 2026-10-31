import { z } from "zod";
import { env } from "@/lib/env";

/** Error envelope returned by the PayMesh FastAPI backend: { error: { code, message, details, request_id } }. */
const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    request_id: z.string().optional(),
  }),
});

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type TokenProvider = () => Promise<string | null> | string | null;
let tokenProvider: TokenProvider = () => null;

/** The auth layer (Supabase) registers itself here later; the client never stores or logs tokens. */
export function registerAccessTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

export interface ApiRequestOptions<T> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  /** Validates the response; untrusted network data is never cast to a type. */
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, opts: ApiRequestOptions<T>): Promise<T> {
  if (!env.apiBaseUrl) throw new ApiError("Backend is not configured (NEXT_PUBLIC_API_BASE_URL).", 0, "api_not_configured");
  const token = await tokenProvider();
  const res = await fetch(`${env.apiBaseUrl.replace(/\/$/, "")}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "omit",
    cache: "no-store", // never let the HTTP cache keep authenticated or payment responses
    signal: opts.signal,
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = errorEnvelope.safeParse(json);
    if (e.success) throw new ApiError(e.data.error.message, res.status, e.data.error.code, e.data.error.request_id);
    throw new ApiError(`Request failed (${res.status})`, res.status, "http_error");
  }
  return opts.schema.parse(json);
}
