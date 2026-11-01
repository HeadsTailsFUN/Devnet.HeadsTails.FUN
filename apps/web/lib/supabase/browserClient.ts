import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/solana/cluster";

/**
 * ONE shared browser Supabase client per page context.
 *
 * Creating a client per component/effect spawns duplicate GoTrueClient
 * instances ("Multiple GoTrueClient instances detected...") with duplicated
 * storage listeners and realtime multiplexing. This module holds exactly one
 * lazily-created instance for public realtime/chat reads only:
 * - persistSession: false (no auth state persisted)
 * - autoRefreshToken: false (no background token refresh)
 * - detectSessionInUrl: false (no URL parsing side effects)
 *
 * Returns null when backend config is absent (offline/dev without env).
 */

let cached: SupabaseClient | null | undefined;

export function getBrowserSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    cached = null;
    return cached;
  }
  cached = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return cached;
}

/** Test-only reset for the module singleton. */
export function __resetBrowserSupabaseForTests(): void {
  cached = undefined;
}
