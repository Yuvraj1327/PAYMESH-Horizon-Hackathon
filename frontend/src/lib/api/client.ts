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
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type TokenProvider = () => Promise<string | null> | string | null;
let tokenProvider: TokenProvider = () => null;

/** The auth layer (Supabase) registers itself here; the client never stores or logs tokens. */
export function registerAccessTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

/**
 * Called once when a request is answered 401. Resolves true if the session was refreshed (the request is then
 * retried exactly once); false if the user must sign in again.
 */
type UnauthorizedHandler = () => Promise<boolean>;
let unauthorizedHandler: UnauthorizedHandler = async () => false;
export function registerUnauthorizedHandler(h: UnauthorizedHandler): void {
  unauthorizedHandler = h;
}
let sessionExpiredHandler: () => void = () => {};
export function registerSessionExpiredHandler(h: () => void): void {
  sessionExpiredHandler = h;
}

export interface ApiRequestOptions<T> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  /** Validates the response; untrusted network data is never cast to a type. */
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}

async function send(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal }): Promise<Response> {
  const token = await tokenProvider();
  return fetch(`${env.apiBaseUrl.replace(/\/$/, "")}${path}`, {
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
}

export async function apiRequest<T>(path: string, opts: ApiRequestOptions<T>): Promise<T> {
  if (!env.apiBaseUrl) throw new ApiError("Backend is not configured (NEXT_PUBLIC_API_BASE_URL).", 0, "api_not_configured");
  let res = await send(path, opts);
  if (res.status === 401) {
    // The backend rejected the token (expired/invalid). Refresh once and retry once; a 401 means the request was
    // refused before any processing, so retrying cannot double-apply a payment action.
    const refreshed = await unauthorizedHandler().catch(() => false);
    if (refreshed) res = await send(path, opts);
    if (res.status === 401) {
      sessionExpiredHandler();
    }
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = errorEnvelope.safeParse(json);
    if (e.success) throw new ApiError(e.data.error.message, res.status, e.data.error.code, e.data.error.request_id, e.data.error.details);
    throw new ApiError(`Request failed (${res.status})`, res.status, "http_error");
  }
  return opts.schema.parse(json);
}
