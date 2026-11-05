import "server-only";

import { getSupabaseAdmin } from "../supabase/server";

import type { SavedViewRow } from "./plan";

/**
  * Storage of views (D-122): the table `saved_views`. The tools work through the interface
  * `SavedViewStore`, so they are testable without the DB (pattern `lib/bcf/store.ts`).
 */

export type SavedViewWrite = Partial<
  Pick<SavedViewRow, "name" | "description" | "viewpoint" | "selection" | "hidden" | "isolated" | "model_revisions" | "author" | "last_used_at">
>;

export interface SavedViewStore {
    /** Saved views (without "Posledný pohľad" (last view)), most recently changed first. */
  list(): Promise<SavedViewRow[]>;
    /** View by name regardless of letter case; null = does not exist. */
  byName(name: string): Promise<SavedViewRow | null>;
    /** Saved view by `id` (D-161: the row `id` = `BasketView.id`); "Posledný pohľad" (last view) is not returned. */
  byId(id: string): Promise<SavedViewRow | null>;
  last(): Promise<SavedViewRow | null>;
    /** The `id` is supplied by the viewer (D-161), otherwise the DB generates it. */
  create(row: SavedViewWrite & Pick<SavedViewRow, "name" | "viewpoint"> & { id?: string }): Promise<SavedViewRow>;
  update(id: string, patch: SavedViewWrite): Promise<SavedViewRow>;
  remove(id: string): Promise<void>;
    /** Overwrites the single row "Posledný pohľad" (last view; kind = 'last'). */
  setLast(row: SavedViewWrite & Pick<SavedViewRow, "name" | "viewpoint">): Promise<void>;
}

const TABLE = "saved_views";

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "neznáma chyba"}`);
}

/** D-189: every read filters the project, every insert sets it (names and 'last' are per project). */
export function supabaseSavedViewStore(projectId: string): SavedViewStore {
  const db = () => getSupabaseAdmin();
  const now = () => new Date().toISOString();
  return {
    async list() {
      const { data, error } = await db().from(TABLE).select("*").eq("project_id", projectId).eq("kind", "saved").order("updated_at", { ascending: false }).limit(500);
      if (error) fail("Čítanie pohľadov zlyhalo", error);
      return (data ?? []) as SavedViewRow[];
    },
    async byName(name) {
            // Exact match regardless of letter case: the LIKE wildcards are escaped.
      const { data, error } = await db()
        .from(TABLE)
        .select("*")
        .eq("project_id", projectId)
        .eq("kind", "saved")
        .ilike("name", name.replace(/[\\%_]/g, "\\$&"))
        .maybeSingle();
      if (error) fail("Čítanie pohľadu zlyhalo", error);
      return (data as SavedViewRow | null) ?? null;
    },
    async byId(id) {
      const { data, error } = await db().from(TABLE).select("*").eq("project_id", projectId).eq("kind", "saved").eq("id", id).maybeSingle();
      if (error) fail("Čítanie pohľadu zlyhalo", error);
      return (data as SavedViewRow | null) ?? null;
    },
    async last() {
      const { data, error } = await db().from(TABLE).select("*").eq("project_id", projectId).eq("kind", "last").maybeSingle();
      if (error) fail("Čítanie posledného pohľadu zlyhalo", error);
      return (data as SavedViewRow | null) ?? null;
    },
    async create(row) {
      const { data, error } = await db().from(TABLE).insert({ ...row, kind: "saved", project_id: projectId }).select("*").single();
      if (error || !data) fail("Uloženie pohľadu zlyhalo", error);
      return data as SavedViewRow;
    },
    async update(id, patch) {
      const { data, error } = await db().from(TABLE).update({ ...patch, updated_at: now() }).eq("project_id", projectId).eq("id", id).select("*").single();
      if (error || !data) fail("Úprava pohľadu zlyhala", error);
      return data as SavedViewRow;
    },
    async remove(id) {
      const { error } = await db().from(TABLE).delete().eq("project_id", projectId).eq("id", id);
      if (error) fail("Zmazanie pohľadu zlyhalo", error);
    },
    async setLast(row) {
      const { data, error } = await db().from(TABLE).select("id").eq("project_id", projectId).eq("kind", "last").maybeSingle();
      if (error) fail("Čítanie posledného pohľadu zlyhalo", error);
      const write = { ...row, updated_at: now() };
      const res = data
        ? await db().from(TABLE).update(write).eq("project_id", projectId).eq("id", (data as { id: string }).id)
        : await db().from(TABLE).insert({ ...write, kind: "last", project_id: projectId });
      if (res.error) fail("Zápis posledného pohľadu zlyhal", res.error);
    },
  };
}

/** Current model revisions of the project {model: revision} (D-086, D-189) at the time of saving. */
export async function currentModelRevisions(projectId: string): Promise<Record<string, number>> {
  const { data, error } = await getSupabaseAdmin().from("model_revisions").select("model, revision").eq("project_id", projectId).eq("is_current", true);
  if (error) fail("Čítanie revízií modelov zlyhalo", error);
  return Object.fromEntries(((data ?? []) as { model: string; revision: number }[]).map((r) => [r.model, r.revision]));
}
