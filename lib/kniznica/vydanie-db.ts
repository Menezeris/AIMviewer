import "server-only";

import { getSupabaseAdmin } from "../supabase/server";

import type { SkladVydania, Uloziste } from "./vydanie";
import { ChybaSkladu, Konflikt } from "./zapis";

/**
 * Vydanie knižnice v DB (D-186 krok 6): texty hlavy cez `public.library_texty`, snímka + katalóg IDS v jednej
 * transakcii cez `public.library_vydaj` (pending migrácia `20261102230500_library_vydaj.sql`), cesta exportu cez
 * `public.library_vydanie_export`, zip do súkromného bucketu Storage. Len `service_role` na serveri (D-026).
 */

export class VydanieMigraciaChyba extends Error {
  constructor() {
    super("Vydanie knižnice: v DB chýba migrácia supabase/pending/20261102230500_library_vydaj.sql (RPC library_vydaj), čaká na nasadenie.");
  }
}

const chybaRpc = (e: { code?: string; message?: string } | null) =>
  !!e && (["PGRST202", "42883"].includes(e.code ?? "") || /could not find the function/i.test(e.message ?? ""));

function chyba(e: { code?: string; message?: string; details?: string }): never {
  if (chybaRpc(e)) throw new VydanieMigraciaChyba();
  if (e.code === "AS409") {
    let cesty: string[] = [];
    try {
      cesty = JSON.parse(e.details ?? "[]") as string[];
    } catch {
      cesty = [];
    }
    throw new Konflikt(cesty);
  }
  if (e.code === "AS404") throw new ChybaSkladu(e.message ?? "knižnica v databáze nie je");
  throw new ChybaSkladu(`databáza vydanie odmietla: ${e.message}`);
}

export function supabaseSkladVydania(kniznica: string): SkladVydania {
  const db = getSupabaseAdmin();
  return {
    kniznica,
    async texty() {
      const { data, error } = await db.rpc("library_texty", { p_kniznica: kniznica });
      if (error) chyba(error);
      return Object.fromEntries(((data ?? []) as Array<{ cesta: string; text: string }>).map((r) => [r.cesta, r.text]));
    },
    async vydaj(p) {
      const { data, error } = await db.rpc("library_vydaj", {
        p_kniznica: kniznica,
        p_kod: p.kod,
        p_autor: p.autor,
        p_sprava: p.sprava,
        p_schema_verzia: p.schema_verzia,
        p_diagnostiky: p.diagnostiky,
        p_ocakavane: p.ocakavane,
        p_polozky: p.polozky,
      });
      if (error) chyba(error);
      const d = (data ?? {}) as { vydanie_id?: string; ids?: unknown[] };
      if (!d.vydanie_id) throw new ChybaSkladu("databáza nevrátila id vydania");
      return { vydanie_id: d.vydanie_id, ids: d.ids ?? [] };
    },
    async exportCesta(vydanieId, cesta) {
      const { error } = await db.rpc("library_vydanie_export", { p_vydanie: vydanieId, p_cesta: cesta });
      if (error) chyba(error);
    },
  };
}

/** Export vydania do Storage; bez `LIBRARY_EXPORT_BUCKET` sa export nerobí (cesta ostane prázdna, ako Python bez Storage). */
export function supabaseUloziste(): Uloziste | null {
  const bucket = process.env.LIBRARY_EXPORT_BUCKET;
  if (!bucket) return null;
  return {
    async nahraj(cesta, data) {
      const { error } = await getSupabaseAdmin().storage.from(bucket).upload(cesta, data, { contentType: "application/zip", upsert: false });
      if (error) throw new ChybaSkladu(`Storage odmietol export: ${error.message}`);
    },
  };
}
