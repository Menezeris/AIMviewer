import "server-only";

import { getSupabaseAdmin } from "../supabase/server";

import type { VerificationStore } from "./types";

/**
 * Uloženie behu overenia výmer (D-185) do `verification_runs` / `verification_results` (service_role).
 * Migrácia je v `supabase/pending/20261101200000_verification_results.sql`; kým nie je aplikovaná, zápis zlyhá
 * a `ifc_measure verify=true save=true` vráti výsledok s `saved.ok=false` (výpočet ostáva platný).
 */

const WRITE_CHUNK = 500;

export function supabaseVerificationStore(): VerificationStore {
  return {
    async saveRun(run, results) {
      const db = getSupabaseAdmin();
      const { data, error } = await db.from("verification_runs").insert(run).select("id").single();
      if (error || !data) throw new Error(`verification_runs: ${error?.message ?? "bez id"}`);
      const id = (data as { id: string }).id;
      for (let i = 0; i < results.length; i += WRITE_CHUNK) {
        const chunk = results.slice(i, i + WRITE_CHUNK).map((r) => ({ ...r, run_id: id }));
        const { error: e } = await db.from("verification_results").insert(chunk);
        if (e) {
          // Beh bez výsledkov by klamal: zmazať (kaskáda) a nahlásiť.
          await db.from("verification_runs").delete().eq("id", id);
          throw new Error(`verification_results: ${e.message}`);
        }
      }
      return { id };
    },
  };
}
