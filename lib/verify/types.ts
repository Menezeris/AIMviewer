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
  /** Ako sa recept počíta (register metód, D-185 UI); stĺpec z pending migrácie `verification_inputs`. */
  explanation?: string | null;
  /** Bunky vzorca a údaje zo súboru: `{expression?, cells, file_meta?}`; stĺpec z pending migrácie `verification_inputs`. */
  inputs?: VerificationInputs | null;
}

export interface VerificationCell {
  key: string;
  label: string;
  value: number;
  unit: string;
  global_id?: string;
}

export interface VerificationInputs {
  expression?: string;
  cells: VerificationCell[];
  /** `IfcElementQuantity.MethodOfMeasurement` a `IfcPhysicalQuantity.Formula` zo súboru. */
  file_meta?: { method_of_measurement?: string; formula?: string };
}

export interface VerificationStore {
  /** `without_inputs` = DB ešte nemá stĺpce `inputs` / `explanation` (pending migrácia), uložilo sa bez nich. */
  saveRun(run: VerificationRunWrite, results: VerificationResultWrite[]): Promise<{ id: string; without_inputs?: boolean }>;
}
