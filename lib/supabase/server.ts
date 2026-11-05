import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { withAuditHeaders } from "@/lib/audit/context";

/**
 * Server-only Supabase klient so `service_role` kľúčom (D-026).
 *
 * - `import "server-only"` je tvrdá poistka: ak by sa tento modul dostal do
 *   client bundle, build zlyhá. Service_role kľúč sa tak NIKDY nedostane do
 *   prehliadača.
 * - RLS je vypnuté (línia D-025) — service_role aj tak RLS obchádza, takže
 *   všetko čítanie DB beží výhradne server-side.
 *
 * Singleton: klient sa vytvorí raz na server proces.
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
    // D-196: every request names its writer for the transaction log (lib/audit/context.ts).
    global: { fetch: withAuditHeaders(fetch) },
  });

  return client;
}
