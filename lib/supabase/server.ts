import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
  * Server-only Supabase client with the `service_role` key (D-026).
 *
  * - `import "server-only"` is a hard safeguard: if this module got into the
  *   client bundle, the build fails. The service_role key thus NEVER reaches
  *   the browser.
  * - RLS is off (D-025 line) - service_role bypasses RLS anyway, so
  *   all DB reading runs exclusively server-side.
 *
  * Singleton: the client is created once per server process.
 */
let client: SupabaseClient | undefined;

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Chýbajú env premenné SUPABASE_URL alebo SUPABASE_SERVICE_ROLE_KEY. " +
        "Doplň ich do .env.local (lokálne) alebo do Vercel env (deploy)."
    );
  }

  client = createClient(url, serviceRoleKey, {
    auth: {
      // Server-side klient nepotrebuje session persistenciu.
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return client;
}
