import { z } from "zod";
import { apiRequest } from "@/lib/api/client";

const nullableStr = z.string().nullish().transform((v) => v ?? null);
const userSchema = z.object({
  id: z.string(), email: nullableStr, full_name: nullableStr, avatar_url: nullableStr, wallet_address: nullableStr, role: z.string(), created_at: z.string(),
});

export interface Profile { id: string; email: string | null; fullName: string | null; avatarUrl: string | null; walletAddress: string | null; role: "user" | "admin" | string; createdAt: string }

const toProfile = (u: z.infer<typeof userSchema>): Profile => ({ id: u.id, email: u.email, fullName: u.full_name, avatarUrl: u.avatar_url, walletAddress: u.wallet_address, role: u.role, createdAt: u.created_at });

/** GET /api/v1/users/me — the role always comes from the backend, never from the token or the client. */
export async function fetchMe(): Promise<Profile> {
  return toProfile(await apiRequest("/api/v1/users/me", { schema: userSchema }));
}

/** PATCH /api/v1/users/me — only full_name, avatar_url and wallet_address are writable (the backend rejects anything else). */
export async function updateMe(patch: { fullName?: string; walletAddress?: string }): Promise<Profile> {
  const body: Record<string, unknown> = {};
  if (patch.fullName !== undefined) body["full_name"] = patch.fullName;
  if (patch.walletAddress !== undefined) body["wallet_address"] = patch.walletAddress;
  return toProfile(await apiRequest("/api/v1/users/me", { method: "PATCH", body, schema: userSchema }));
}
