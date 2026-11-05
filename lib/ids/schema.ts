/** Migration D-182 (`supabase/migrations/20261102120000_ids_library_assign.sql`) may not be in the DB yet: the host code copes with it. */

export const SCHEMA_HINT = "v DB chýba migrácia D-182 supabase/migrations/20261102120000_ids_library_assign.sql, čaká na nasadenie";

/** Missing column or table (Postgres / PostgREST). */
export const isMissingSchema = (error: { code?: string; message?: string } | null) =>
  !!error && (["42703", "42P01", "PGRST204", "PGRST205"].includes(error.code ?? "") || /does not exist|could not find/i.test(error.message ?? ""));
