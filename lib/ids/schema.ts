/** Migrácia D-182 (`supabase/migrations/20261102120000_ids_library_assign.sql`) ešte nemusí byť v DB: kód hosta to zvládne. */

export const SCHEMA_HINT = "v DB chýba migrácia D-182 supabase/migrations/20261102120000_ids_library_assign.sql, čaká na nasadenie";

/** Chýbajúci stĺpec alebo tabuľka (Postgres / PostgREST). */
export const isMissingSchema = (error: { code?: string; message?: string } | null) =>
  !!error && (["42703", "42P01", "PGRST204", "PGRST205"].includes(error.code ?? "") || /does not exist|could not find/i.test(error.message ?? ""));
