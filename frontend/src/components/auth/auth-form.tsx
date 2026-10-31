"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/procurement/field";
import { useAuth } from "@/components/auth/auth-provider";
import { safeNext } from "@/lib/auth/redirect";
import { LogoMark } from "@/components/common/logo";
import { authMode } from "@/lib/env";
import { useEffect } from "react";

const schema = z.object({
  email: z.string().trim().min(1, "Enter your email").email("Enter a valid email address").max(254),
  password: z.string().min(8, "Use at least 8 characters").max(128, "Password is too long"),
});
type Values = z.infer<typeof schema>;

function Form({ mode }: { mode: "login" | "register" }) {
  const { signIn, signUp, status } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema), mode: "onTouched" });

  useEffect(() => {
    if (status === "signed_in" || status === "preview") router.replace(next);
  }, [status, next, router]);

  async function submit(v: Values) {
    setError(null);
    if (mode === "login") {
      const err = await signIn(v.email, v.password);
      if (err) setError(err);
    } else {
      const res = await signUp(v.email, v.password);
      if (res.error) setError(res.error);
      else if (res.needsConfirmation) setConfirm(true);
    }
  }

  if (confirm) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 text-center" data-testid="confirm-email">
        <MailCheck className="size-10 text-teal" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-navy">Check your email</h2>
        <p className="text-sm text-muted-foreground">We sent a confirmation link. Open it, then sign in.</p>
        <Button asChild variant="outline"><Link href="/login">Back to sign in</Link></Button>
      </div>
    );
  }

  const isLogin = mode === "login";
  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="flex flex-col gap-4" aria-label={isLogin ? "Sign in" : "Create account"}>
      {params.get("reason") === "expired" && <p role="status" className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">Your session expired. Please sign in again.</p>}
      <Field id="email" label="Email" required error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" inputMode="email" aria-invalid={errors.email ? true : undefined} aria-describedby={errors.email ? "email-error" : undefined} {...register("email")} />
      </Field>
      <Field id="password" label="Password" required error={errors.password?.message} hint={isLogin ? undefined : "At least 8 characters."}>
        <Input id="password" type="password" autoComplete={isLogin ? "current-password" : "new-password"} aria-invalid={errors.password ? true : undefined} aria-describedby={errors.password ? "password-error" : undefined} {...register("password")} />
      </Field>
      {error && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger" data-testid="auth-error">{error}</p>}
      <Button type="submit" disabled={isSubmitting} data-testid="auth-submit">{isSubmitting ? <Loader2 className="animate-spin" /> : null}{isLogin ? "Sign in" : "Create account"}</Button>
      <p className="text-center text-sm text-muted-foreground">
        {isLogin ? <>New to PayMesh? <Link href={`/register${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-brand hover:underline">Create an account</Link></>
          : <>Already registered? <Link href="/login" className="font-medium text-brand hover:underline">Sign in</Link></>}
      </p>
    </form>
  );
}

export function AuthCard({ mode }: { mode: "login" | "register" }) {
  return (
    <div className="w-full max-w-sm rounded-xl border bg-surface p-6 shadow-card sm:p-8">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <LogoMark className="size-10" />
        <h1 className="text-xl font-bold text-navy">{mode === "login" ? "Sign in to PayMesh" : "Create your PayMesh account"}</h1>
        <p className="text-sm text-muted-foreground">Connecting AI agents. Powering autonomous payments.</p>
      </div>
      {authMode === "supabase" ? (
        <Suspense fallback={null}><Form mode={mode} /></Suspense>
      ) : authMode === "preview" ? (
        <div className="flex flex-col gap-3 text-center"><p className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">Demo mode: no backend is connected, so sign-in is not needed.</p><Button asChild><Link href="/dashboard">Open the demo</Link></Button></div>
      ) : (
        <p role="alert" className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">Sign-in is not configured: set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.</p>
      )}
    </div>
  );
}
