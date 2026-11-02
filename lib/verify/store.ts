import "server-only";

import { getSupabaseAdmin } from "../supabase/server";

import type { VerificationStore } from "./types";

/**
 * Uloženie behu overenia výmer (D-185) do `verification_runs` / `verification_results` (service_role).
 * Migrácia je v `supabase/migrations/20261101200000_verification_results.sql`; kým nie je aplikovaná, zápis zlyhá
 * a `ifc_measure verify=true save=true` vráti výsledok s `saved.ok=false` (výpočet ostáva platný).
 */

const WRITE_CHUNK = 500;

/** Chyba "stĺpec neexistuje" pre `inputs` / `explanation` (PostgREST PGRST204, Postgres 42703): migrácia ešte nie je v DB. */
export function isMissingInputsColumn(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return (e.code === "PGRST204" || e.code === "42703") && /inputs|explanation/.test(e.message ?? "");
}

export function supabaseVerificationStore(): VerificationStore {
  return {
    async saveRun(run, results) {
      const db = getSupabaseAdmin();
      const { data, error } = await db.from("verification_runs").insert(run).select("id").single();
      if (error || !data) throw new Error(`verification_runs: ${error?.message ?? "bez id"}`);
      const id = (data as { id: string }).id;
      let withoutInputs = false;
      for (let i = 0; i < results.length; i += WRITE_CHUNK) {
        const chunk = results.slice(i, i + WRITE_CHUNK).map((r) => {
          if (!withoutInputs) return { ...r, run_id: id };
          const { inputs, explanation, ...rest } = r;
          void inputs;
          void explanation;
          return { ...rest, run_id: id };
        });
        const { error: e } = await db.from("verification_results").insert(chunk);
        // DB bez migrácie `verification_inputs` (napr. lokálna): beh sa uloží bez buniek (viewer ukáže vzorec textom).
        if (e && !withoutInputs && isMissingInputsColumn(e)) {
          withoutInputs = true;
          i -= WRITE_CHUNK;
          continue;
        }
        if (e) {
          // Beh bez výsledkov by klamal: zmazať (kaskáda) a nahlásiť.
          await db.from("verification_runs").delete().eq("id", id);
          throw new Error(`verification_results: ${e.message}`);
        }
      }
      return { id, ...(withoutInputs ? { without_inputs: true } : {}) };
    },
  };
}
