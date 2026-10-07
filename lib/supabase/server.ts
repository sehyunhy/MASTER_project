import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnvironment } from "@/lib/supabase/env";

export function supabaseAdmin() {
  // Marketplace integrations may prefix variables with their project ref.
  // Server-only resolution deliberately excludes NEXT_PUBLIC secret names.
  const {url,key} = supabaseServerEnvironment();
  if (!url || !key) throw new Error("Supabase server environment is not configured. Set the project URL and a server secret key; project-prefixed Marketplace variable names are supported.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
