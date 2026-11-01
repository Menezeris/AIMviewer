/** Riadky behu overenia výmer (D-185); DDL v `supabase/migrations/20261101200000_verification_results.sql`. */

export interface VerificationRunWrite {
  scope: string;
  registry_version: number;
  engine: string;
  /** Podpis vstupu {model: revízia} (D-183 bod 11). */
  model_revisions: Record<string, number>;
  counts: Record<string, number>;
  author?: string | null;
}

export interface VerificationResultWrite {
  model: string;
  revision: number | null;
  global_id: string;
  element_name: string | null;
  target: string;
  recipe: string;
  status: "green" | "yellow" | "red" | "grey";
  file_value: number | null;
  computed_value: number | null;
  method: string;
  definition: string | null;
  spec_ref: string | null;
  tolerance: string | null;
  formula: string | null;
  note: string | null;
  distinct_heights: number[] | null;
  anchors: Array<{ global_id: string; role: string; z_m?: number }>;
}

export interface VerificationStore {
  saveRun(run: VerificationRunWrite, results: VerificationResultWrite[]): Promise<{ id: string }>;
}
