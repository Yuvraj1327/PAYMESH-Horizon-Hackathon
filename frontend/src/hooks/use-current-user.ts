"use client";

import { useAuth } from "@/components/auth/auth-provider";

export interface CurrentUser {
  name: string;
  email: string | null;
  role: string | null;
  isAdmin: boolean;
  /** True only in demo mode (no backend): a labelled preview identity, not a real account. */
  isPreview: boolean;
}

/** The signed-in user. The role always comes from the backend profile (`GET /users/me`), never from the client. */
export function useCurrentUser(): CurrentUser {
  const { status, profile, session } = useAuth();
  if (status === "preview") return { name: "Preview User", email: null, role: null, isAdmin: false, isPreview: true };
  const email = profile?.email ?? session?.user.email ?? null;
  const name = profile?.fullName || (email ? email.split("@")[0]! : "Account");
  return { name, email, role: profile?.role ?? null, isAdmin: profile?.role === "admin", isPreview: false };
}
