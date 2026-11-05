import "server-only";

import { getSupabaseAdmin } from "../supabase/server";

import type { VerificationStore } from "./types";

/**
  * Saving a quantity verification run (D-185) into `verification_runs` / `verification_results` (service_role).
  * The migration is in `supabase/migrations/20261101200000_verification_results.sql`; until it is applied, the write fails
  * and `ifc_measure verify=true save=true` returns the result with `saved.ok=false` (the computation stays valid).
 */

const WRITE_CHUNK = 500;

/** Error "column does not exist" for `inputs` / `explanation` (PostgREST PGRST204, Postgres 42703): the migration is not in the DB yet. */
export function isMissingInputsColumn(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return (e.code === "PGRST204" || e.code === "42703") && /inputs|explanation/.test(e.message ?? "");
}

/** D-189: runs of one project. */
export function supabaseVerificationStore(projectId: string): VerificationStore {
  return {
    async saveRun(run, results) {
      const db = getSupabaseAdmin();
      const { data, error } = await db.from("verification_runs").insert({ ...run, project_id: projectId }).select("id").single();
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
                // A DB without the `verification_inputs` migration (e.g. local): the run is saved without cells (the viewer shows the formula as text).
        if (e && !withoutInputs && isMissingInputsColumn(e)) {
          withoutInputs = true;
          i -= WRITE_CHUNK;
          continue;
        }
        if (e) {
                    // A run without results would lie: delete (cascade) and report.
          await db.from("verification_runs").delete().eq("project_id", projectId).eq("id", id);
          throw new Error(`verification_results: ${e.message}`);
        }
      }
      return { id, ...(withoutInputs ? { without_inputs: true } : {}) };
    },
  };
}
