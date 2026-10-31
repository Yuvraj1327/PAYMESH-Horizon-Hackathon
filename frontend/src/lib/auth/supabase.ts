import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, authConfigured } from "@/lib/env";

let client: SupabaseClient | null = null;

/**
 * Browser Supabase client (anon key only: it is public by design and protected by RLS).
 * The service-role key never belongs in this app. The session lives in Supabase's own storage and is auto-refreshed.
 */
export function getSupabase(): SupabaseClient | null {
  if (!authConfigured) return null;
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: "pkce" },
    });
  }
  return client;
}
