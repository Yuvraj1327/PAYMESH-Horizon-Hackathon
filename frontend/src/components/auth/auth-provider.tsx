"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { authMode } from "@/lib/env";
import { getSupabase } from "@/lib/auth/supabase";
import { registerAccessTokenProvider, registerSessionExpiredHandler, registerUnauthorizedHandler } from "@/lib/api/client";
import { describeAuthError } from "@/lib/auth/errors";
import { fetchMe, type Profile } from "@/services/profile";
import { useToast } from "@/components/ui/toaster";
import { clearLocalState } from "@/lib/clear-local-state";
import { useDisconnect } from "wagmi";

export type AuthStatus = "loading" | "signed_in" | "signed_out" | "preview" | "unconfigured";

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  profileError: boolean;
  signIn(email: string, password: string): Promise<string | null>;
  signUp(email: string, password: string): Promise<{ error: string | null; needsConfirmation: boolean }>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const supabase = getSupabase();
  const [session, setSession] = useState<Session | null>(null);
  const { mutate: disconnectWallet } = useDisconnect();
  const [ready, setReady] = useState(authMode !== "supabase");

  // Wire the API client to the live Supabase session.
  useEffect(() => {
    if (!supabase) return;
    registerAccessTokenProvider(async () => (await supabase.auth.getSession()).data.session?.access_token ?? null);
    registerUnauthorizedHandler(async () => {
      const { data, error } = await supabase.auth.refreshSession();
      return !error && !!data.session;
    });
    registerSessionExpiredHandler(() => {
      toast.push({ title: "Your session expired", description: "Please sign in again to continue.", variant: "error" });
      void supabase.auth.signOut({ scope: "local" });
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      setReady(true);
      if (event === "SIGNED_OUT") {
        qc.clear(); // no private data lingers in memory after sign-out or expiry
        // Disconnect first (wagmi writes its own bookkeeping while disconnecting), then wipe what this app stored.
        disconnectWallet(undefined, { onSettled: () => clearLocalState() });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [supabase, qc, toast, disconnectWallet]);

  const signedIn = authMode === "supabase" && !!session;
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, enabled: signedIn, retry: false, staleTime: 5 * 60_000 });

  const status: AuthStatus = authMode === "preview" ? "preview" : authMode === "unconfigured" ? "unconfigured" : !ready ? "loading" : session ? "signed_in" : "signed_out";

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return "Sign-in is not configured.";
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? describeAuthError(error) : null;
  }, [supabase]);

  const signUp = useCallback(async (email: string, password: string) => {
    if (!supabase) return { error: "Registration is not configured.", needsConfirmation: false };
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: describeAuthError(error), needsConfirmation: false };
    return { error: null, needsConfirmation: !data.session };
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut({ scope: "local" });
    qc.clear();
    toast.push({ title: "Signed out", variant: "success" });
    router.replace("/login");
  }, [supabase, qc, toast, router]);

  const value = useMemo<AuthContextValue>(() => ({
    status, session, profile: me.data ?? null, profileError: me.isError, signIn, signUp, signOut,
  }), [status, session, me.data, me.isError, signIn, signUp, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}
