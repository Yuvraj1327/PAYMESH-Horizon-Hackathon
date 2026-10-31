"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { LoadingState } from "@/components/states";

/**
 * Client-side route protection for a better experience only. The backend verifies every JWT and Supabase RLS guards
 * the data; this gate cannot grant access to anything.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "signed_out") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);

  if (status === "loading" || status === "signed_out") return <LoadingState label="Checking your session…" className="min-h-dvh" />;
  if (status === "unconfigured") {
    return (
      <div role="alert" className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <AlertTriangle className="size-8 text-warning" aria-hidden="true" />
        <h1 className="text-xl font-bold text-navy">Sign-in is not configured</h1>
        <p className="text-sm text-muted-foreground">The backend URL is set, but <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are missing, so requests cannot be authenticated. Add them (or unset the backend URL to use demo mode) and rebuild.</p>
      </div>
    );
  }
  return <>{children}</>;
}
