import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireEnv } from "@/lib/env";

/** Esquema de Postgres que expone PostgREST. Supabase solo expone `public` por defecto. */
export const SUPABASE_SCHEMA = process.env.SUPABASE_SCHEMA || "public";

let client: SupabaseClient | null = null;

/** Cliente de Supabase con service role sobre el esquema de la BD (`public`). Solo servidor. */
export function getSupabaseAdmin(): SupabaseClient {
  if (!client) {
    client = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { db: { schema: SUPABASE_SCHEMA }, auth: { persistSession: false } }
    ) as unknown as SupabaseClient;
  }
  return client;
}
