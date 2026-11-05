import "server-only";

import { getSupabaseAdmin } from "../supabase/server";

import { ChybaCesty, rozober } from "./cesty";
import { projekcia } from "./projekcia";
import { ChybaSkladu, Konflikt, type Podpis, type Sklad, type ZapisSuboru } from "./zapis";

/**
 * Sklad knižnice v DB (port `assetin/db/sklad_db.py`, D-186 krok 3): čítanie hlavy cez `public.library_texty`,
 * zápis cez `public.library_zapis` = `library.zapis_revizie` (všetko alebo nič, AS409 konflikt) + projekcia
 * zapísaných súborov v tej istej transakcii. Len `service_role` na serveri (D-026).
 */

export const SCHEMA_VERZIA = "1.5";
export const ENGINE = "aimviewer lib/kniznica (D-186)";
export const ZDROJE = ["migracia_md", "editor", "nova", "migracia_schemy"];

/** Chýbajúca RPC (migrácia nie je v DB). */
export class ZapisMigraciaChyba extends Error {
  constructor() {
    super("Zápis do knižnice: v DB chýba migrácia supabase/migrations/20261102210000_library_zapis.sql (RPC library_texty, library_zapis).");
  }
}

const chybaRpc = (e: { code?: string; message?: string } | null) =>
  !!e && (["PGRST202", "42883"].includes(e.code ?? "") || /could not find the function/i.test(e.message ?? ""));

function identita(rel: string): [string | null, string | null] {
  if (rel === "KNIZNICA.md") return [null, null];
  try {
    const um = rozober(rel);
    return [um.id, um.typ];
  } catch (e) {
    if (e instanceof ChybaCesty) return [null, null];
    throw e;
  }
}

export function supabaseSklad(kniznica: string): Sklad {
  let cache: Record<string, string> | null = null;
  const nacitaj = async () => {
    if (cache) return cache;
    const { data, error } = await getSupabaseAdmin().rpc("library_texty", { p_kniznica: kniznica });
    if (chybaRpc(error)) throw new ZapisMigraciaChyba();
    if (error) throw new ChybaSkladu(`čítanie knižnice zlyhalo: ${error.message}`);
    cache = Object.fromEntries(((data ?? []) as Array<{ cesta: string; text: string }>).map((r) => [r.cesta, r.text]));
    return cache;
  };
  return {
    texty: async () => ({ ...(await nacitaj()) }),
    existuje: async (rel) => rel in (await nacitaj()),
    async zapis(zapisy: ZapisSuboru[], podpis: Podpis) {
      if (!podpis.autor?.trim()) throw new ChybaSkladu("zápis do databázy potrebuje autora (meno v editore)");
      const zdroj = podpis.zdroj ?? "editor";
      if (!ZDROJE.includes(zdroj)) throw new ChybaSkladu(`neznámy zdroj revízie '${zdroj}'`);
      const polozky = zapisy.map((z) => {
        const ciel = z.nova_cesta ?? z.cesta!;
        const [note_id, typ] = identita(ciel);
        return {
          cesta: z.cesta,
          nova_cesta: z.cesta === null || z.nova_cesta !== z.cesta ? z.nova_cesta : null,
          text: z.text,
          ocakavana: z.ocakavana,
          note_id,
          typ,
        };
      });
      // {cieľová cesta: projekcia}: RPC páruje podľa cesty z výstupu zapis_revizie, nie podľa poradia
      const projekcie = Object.fromEntries(zapisy.map((z) => [z.nova_cesta ?? z.cesta!, projekcia(z.nova_cesta ?? z.cesta!, z.text)]));
      const { error } = await getSupabaseAdmin().rpc("library_zapis", {
        p_kniznica: kniznica,
        p_autor: podpis.autor.trim(),
        p_sprava: podpis.sprava ?? null,
        p_zdroj: zdroj,
        p_schema_verzia: SCHEMA_VERZIA,
        p_zapisy: polozky,
        p_projekcie: JSON.parse(JSON.stringify(projekcie)),
        p_engine: ENGINE,
      });
      cache = null;
      if (!error) return;
      if (chybaRpc(error)) throw new ZapisMigraciaChyba();
      if (error.code === "AS409") {
        let cesty: string[] = [];
        try {
          cesty = JSON.parse(error.details ?? "[]") as string[];
        } catch {
          cesty = [];
        }
        throw new Konflikt(cesty);
      }
      if (error.code === "AS404") throw new ChybaSkladu(`knižnica '${kniznica}' v databáze nie je`);
      throw new ChybaSkladu(`databáza zápis odmietla: ${error.message}`);
    },
  };
}
