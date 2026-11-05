import "server-only";

import { getSupabaseAdmin } from "../supabase/server";

import type { HeadRow, HeadStore, HeadFile } from "./head";

/** Chýbajúca RPC (migrácia nie je v DB): PostgREST PGRST202, Postgres 42883. */
const chybaRpc = (e: { code?: string; message?: string } | null) =>
  !!e && (["PGRST202", "42883"].includes(e.code ?? "") || /could not find the function|does not exist/i.test(e.message ?? ""));

/** Hlava knižnice cez RPC v `public` (`service_role`, D-026); schéma `library` nie je v PostgREST vystavená. */
export function supabaseHlavaStore(): HeadStore {
  return {
    async zoznam(kniznica) {
      const { data, error } = await getSupabaseAdmin().rpc("library_head_list", { p_library: kniznica });
      if (chybaRpc(error)) return null;
      if (error) throw new Error(`Čítanie knižnice zlyhalo: ${error.message}`);
      return (data ?? []) as HeadRow[];
    },
    async subor(kniznica, cesta) {
      const { data, error } = await getSupabaseAdmin().rpc("library_head_file", { p_library: kniznica, p_path: cesta });
      if (chybaRpc(error)) return "chyba_migracie";
      if (error) throw new Error(`Čítanie súboru knižnice zlyhalo: ${error.message}`);
      return ((data ?? []) as HeadFile[])[0] ?? null;
    },
  };
}
