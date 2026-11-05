/** Rows of a quantity verification run (D-185); DDL in `supabase/migrations/20261101200000_verification_results.sql`. */

export interface VerificationRunWrite {
  scope: string;
  registry_version: number;
  engine: string;
    /** Input signature {model: revision} (D-183 point 11). */
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
    /** How the recipe is computed (method registry, D-185 UI); a column from migration `verification_inputs`. */
  explanation?: string | null;
    /** Formula cells and data from the file: `{expression?, cells, file_meta?}`; a column from migration `verification_inputs`. */
  inputs?: VerificationInputs | null;
}

export interface VerificationCell {
  key: string;
  label: string;
  value: number;
  unit: string;
  global_id?: string;
    /** Derived cell: the name of another quantity of the same element (e.g. `Qto_SpaceBaseQuantities.Height`), only when the cell value is that quantity. */
  quantity?: string;
}

export interface VerificationInputs {
  expression?: string;
  cells: VerificationCell[];
    /** `IfcElementQuantity.MethodOfMeasurement` and `IfcPhysicalQuantity.Formula` from the file. */
  file_meta?: { method_of_measurement?: string; formula?: string };
}

export interface VerificationStore {
    /** `without_inputs` = the DB does not have the `inputs` / `explanation` columns yet (the `verification_inputs` migration is missing), it was saved without them. */
  saveRun(run: VerificationRunWrite, results: VerificationResultWrite[]): Promise<{ id: string; without_inputs?: boolean }>;
}
