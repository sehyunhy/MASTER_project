import { createClient } from "@supabase/supabase-js";

export function supabaseAdmin() {
  // Supabase Marketplace now provides SUPABASE_URL / SUPABASE_SECRET_KEY.
  // Keep the legacy names as fallbacks for existing local deployments.
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server environment is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
