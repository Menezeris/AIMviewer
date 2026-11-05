import "server-only";

import { getSupabaseAdmin } from "../supabase/server";

import type { HlavaRiadok, HlavaStore, HlavaSubor } from "./hlava";

/** Chýbajúca RPC (migrácia nie je v DB): PostgREST PGRST202, Postgres 42883. */
const chybaRpc = (e: { code?: string; message?: string } | null) =>
  !!e && (["PGRST202", "42883"].includes(e.code ?? "") || /could not find the function|does not exist/i.test(e.message ?? ""));

/** Hlava knižnice cez RPC v `public` (`service_role`, D-026); schéma `library` nie je v PostgREST vystavená. */
export function supabaseHlavaStore(): HlavaStore {
  return {
    async zoznam(kniznica) {
      const { data, error } = await getSupabaseAdmin().rpc("library_hlava_zoznam", { p_kniznica: kniznica });
      if (chybaRpc(error)) return null;
      if (error) throw new Error(`Čítanie knižnice zlyhalo: ${error.message}`);
      return (data ?? []) as HlavaRiadok[];
    },
    async subor(kniznica, cesta) {
      const { data, error } = await getSupabaseAdmin().rpc("library_hlava_subor", { p_kniznica: kniznica, p_cesta: cesta });
      if (chybaRpc(error)) return "chyba_migracie";
      if (error) throw new Error(`Čítanie súboru knižnice zlyhalo: ${error.message}`);
      return ((data ?? []) as HlavaSubor[])[0] ?? null;
    },
  };
}
