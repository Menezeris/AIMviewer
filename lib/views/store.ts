import "server-only";

import { getSupabaseAdmin } from "../supabase/server";

import type { SavedViewRow } from "./plan";

/**
 * Uloženie pohľadov (D-122): tabuľka `saved_views`. Tools pracujú cez rozhranie
 * `SavedViewStore`, takže sú testovateľné bez DB (vzor `lib/bcf/store.ts`).
 */

export type SavedViewWrite = Partial<
  Pick<SavedViewRow, "name" | "description" | "viewpoint" | "selection" | "hidden" | "isolated" | "model_revisions" | "author" | "last_used_at">
>;

export interface SavedViewStore {
  /** Uložené pohľady (bez "Posledný pohľad"), naposledy zmenené prvé. */
  list(): Promise<SavedViewRow[]>;
  /** Pohľad podľa mena bez ohľadu na veľkosť písmen; null = neexistuje. */
  byName(name: string): Promise<SavedViewRow | null>;
  /** Uložený pohľad podľa `id` (D-161: `id` riadku = `BasketView.id`); "Posledný pohľad" sa nevracia. */
  byId(id: string): Promise<SavedViewRow | null>;
  last(): Promise<SavedViewRow | null>;
  /** `id` zadáva viewer (D-161), inak ho vygeneruje DB. */
  create(row: SavedViewWrite & Pick<SavedViewRow, "name" | "viewpoint"> & { id?: string }): Promise<SavedViewRow>;
  update(id: string, patch: SavedViewWrite): Promise<SavedViewRow>;
  remove(id: string): Promise<void>;
  /** Prepíše jediný riadok "Posledný pohľad" (kind = 'last'). */
  setLast(row: SavedViewWrite & Pick<SavedViewRow, "name" | "viewpoint">): Promise<void>;
}

const TABLE = "saved_views";

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "neznáma chyba"}`);
}

export function supabaseSavedViewStore(): SavedViewStore {
  const db = () => getSupabaseAdmin();
  const now = () => new Date().toISOString();
  return {
    async list() {
      const { data, error } = await db().from(TABLE).select("*").eq("kind", "saved").order("updated_at", { ascending: false }).limit(500);
      if (error) fail("Čítanie pohľadov zlyhalo", error);
      return (data ?? []) as SavedViewRow[];
    },
    async byName(name) {
      // Presná zhoda bez ohľadu na veľkosť písmen: zástupné znaky LIKE sa escapujú.
      const { data, error } = await db()
        .from(TABLE)
        .select("*")
        .eq("kind", "saved")
        .ilike("name", name.replace(/[\\%_]/g, "\\$&"))
        .maybeSingle();
      if (error) fail("Čítanie pohľadu zlyhalo", error);
      return (data as SavedViewRow | null) ?? null;
    },
    async byId(id) {
      const { data, error } = await db().from(TABLE).select("*").eq("kind", "saved").eq("id", id).maybeSingle();
      if (error) fail("Čítanie pohľadu zlyhalo", error);
      return (data as SavedViewRow | null) ?? null;
    },
    async last() {
      const { data, error } = await db().from(TABLE).select("*").eq("kind", "last").maybeSingle();
      if (error) fail("Čítanie posledného pohľadu zlyhalo", error);
      return (data as SavedViewRow | null) ?? null;
    },
    async create(row) {
      const { data, error } = await db().from(TABLE).insert({ ...row, kind: "saved" }).select("*").single();
      if (error || !data) fail("Uloženie pohľadu zlyhalo", error);
      return data as SavedViewRow;
    },
    async update(id, patch) {
      const { data, error } = await db().from(TABLE).update({ ...patch, updated_at: now() }).eq("id", id).select("*").single();
      if (error || !data) fail("Úprava pohľadu zlyhala", error);
      return data as SavedViewRow;
    },
    async remove(id) {
      const { error } = await db().from(TABLE).delete().eq("id", id);
      if (error) fail("Zmazanie pohľadu zlyhalo", error);
    },
    async setLast(row) {
      const { data, error } = await db().from(TABLE).select("id").eq("kind", "last").maybeSingle();
      if (error) fail("Čítanie posledného pohľadu zlyhalo", error);
      const write = { ...row, updated_at: now() };
      const res = data
        ? await db().from(TABLE).update(write).eq("id", (data as { id: string }).id)
        : await db().from(TABLE).insert({ ...write, kind: "last" });
      if (res.error) fail("Zápis posledného pohľadu zlyhal", res.error);
    },
  };
}

/** Aktuálne revízie modelov federácie {model: revízia} (D-086) v čase uloženia. */
export async function currentModelRevisions(): Promise<Record<string, number>> {
  const { data, error } = await getSupabaseAdmin().from("model_revisions").select("model, revision").eq("is_current", true);
  if (error) fail("Čítanie revízií modelov zlyhalo", error);
  return Object.fromEntries(((data ?? []) as { model: string; revision: number }[]).map((r) => [r.model, r.revision]));
}
