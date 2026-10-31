"use client";

export interface CurrentUser {
  name: string;
  email: string | null;
  /** True until Supabase authentication is connected. */
  isPreview: boolean;
}

/**
 * Integration boundary for the signed-in user. Step 1 has no authentication, so this returns a clearly marked
 * preview identity. Later: read the Supabase session and `GET /api/v1/users/me` (role always comes from the backend).
 */
export function useCurrentUser(): CurrentUser {
  return { name: "Preview User", email: null, isPreview: true };
}
