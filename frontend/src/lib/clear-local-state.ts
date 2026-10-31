/**
 * Removes everything this app keeps in the browser for a user: wallet connection records (wagmi), per-request
 * idempotency keys and demo stores. Supabase clears its own session on sign-out. Called on sign-out and session expiry
 * so a shared device never keeps the previous user's identifiers.
 */
export function clearLocalState(): void {
  if (typeof window === "undefined") return;
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      const doomed: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && (k.startsWith("wagmi.") || k.startsWith("paymesh.") || k.startsWith("injected."))) doomed.push(k);
      }
      doomed.forEach((k) => store.removeItem(k));
    } catch { /* storage unavailable */ }
  }
}
