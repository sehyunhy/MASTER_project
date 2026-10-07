import { createClient } from "@supabase/supabase-js";

export function supabaseBrowser() {
  // Prefer the current Marketplace publishable key; retain the legacy anon key fallback.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase browser environment is not configured.");
  return createClient(url, key);
}
