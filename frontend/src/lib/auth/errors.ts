/** Maps Supabase Auth errors to messages that never reveal whether an account exists. */
export function describeAuthError(e: unknown): string {
  const err = e as { status?: number; code?: string; message?: string; name?: string } | null;
  const msg = (err?.message ?? "").toLowerCase();
  const code = err?.code ?? "";
  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) return "Email or password is incorrect.";
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) return "Confirm your email first. Check your inbox for the link we sent.";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || err?.status === 429) return "Too many attempts. Please wait a minute and try again.";
  if (code === "weak_password" || msg.includes("password should")) return "Choose a stronger password (at least 8 characters).";
  if (code === "signup_disabled" || msg.includes("signups not allowed")) return "Registration is currently closed for this project.";
  if (code === "user_already_exists" || msg.includes("already registered")) return "Could not create the account. If you already registered, sign in instead.";
  if (err?.name === "AuthRetryableFetchError" || msg.includes("failed to fetch") || msg.includes("network")) return "Could not reach the sign-in service. Check your connection and try again.";
  return "Sign-in failed. Please try again.";
}
