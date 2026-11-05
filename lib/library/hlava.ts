import { createHash } from "node:crypto";

import { blokyJson, parsuj, serializuj } from "./bloky";
import { nacitajSubor, poznamkaJson } from "./loader";

/**
 * Read-only prehliadač knižnice požiadaviek (port do TS, krok 1, assetin-library V30): hlava knižnice
 * (`library.hlava` = posledná revízia každého súboru) cez RPC v `public` len pre `service_role`
 * (`supabase/migrations/20261102200000_library_hlava_read.sql`, aplikovaná 2. 11.). Do kroku 3 (writer) knižnica v AIM nič nezapisuje.
 */

export interface HlavaRiadok {
  kniznica: string;
  cesta: string;
  note_id: string | null;
  typ: string | null;
  rev: number;
  sha256: string;
  autor: string | null;
  vytvorena: string;
  zdroj: string | null;
  dlzka: number;
}

export interface HlavaSubor extends Omit<HlavaRiadok, "dlzka"> {
  text: string;
}

export interface HlavaStore {
  /** null = RPC (migrácia) v DB ešte nie je. */
  zoznam(kniznica: string | null): Promise<HlavaRiadok[] | null>;
  subor(kniznica: string, cesta: string): Promise<HlavaSubor | null | "chyba_migracie">;
}

export class HlavaMigraciaChyba extends Error {
  constructor() {
    super("Prehliadač knižnice: v DB chýba migrácia supabase/migrations/20261102200000_library_hlava_read.sql (RPC library_hlava_*), čaká na nasadenie.");
  }
}

export class HlavaVstupChyba extends Error {}

const KOD_RE = /^[A-Za-z0-9._-]{1,80}$/;

export interface Prehlad {
  kniznice: Array<{ kod: string; subory: number; typy: Record<string, number> }>;
  subory: Array<Omit<HlavaRiadok, "kniznica"> & { kniznica: string }>;
}

export async function prehlad(store: HlavaStore, kniznica: string | null): Promise<Prehlad> {
  if (kniznica !== null && !KOD_RE.test(kniznica)) throw new HlavaVstupChyba("kniznica: kód knižnice (písmená, čísla, . _ -).");
  const rows = await store.zoznam(kniznica);
  if (rows === null) throw new HlavaMigraciaChyba();
  const by = new Map<string, { kod: string; subory: number; typy: Record<string, number> }>();
  for (const r of rows) {
    const k = by.get(r.kniznica) ?? { kod: r.kniznica, subory: 0, typy: {} };
    k.subory += 1;
    const t = r.typ ?? "(bez typu)";
    k.typy[t] = (k.typy[t] ?? 0) + 1;
    by.set(r.kniznica, k);
  }
  return { kniznice: [...by.values()], subory: rows };
}

export interface DetailSuboru {
  subor: HlavaSubor;
  /** sha256 textu súboru (UTF-8) sedí so `sha256` revízie. */
  sha256_sedi: boolean;
  /** Spojenie `raw` blokov = text (bajtovo). */
  round_trip: boolean;
  bloky: ReturnType<typeof blokyJson>;
  /** Loader (krok 2b): zlúčené dáta, pôvod polí, typovaný model alebo null, pod-záznamy, diagnostiky. */
  poznamka: ReturnType<typeof poznamkaJson> | null;
}

export async function detail(store: HlavaStore, kniznica: string, cesta: string): Promise<DetailSuboru | null> {
  if (!KOD_RE.test(kniznica)) throw new HlavaVstupChyba("kniznica: kód knižnice (písmená, čísla, . _ -).");
  if (!cesta || cesta.length > 500 || cesta.split("/").some((s) => s === ".." || s === "")) throw new HlavaVstupChyba("cesta: relatívna cesta súboru v knižnici.");
  const s = await store.subor(kniznica, cesta);
  if (s === "chyba_migracie") throw new HlavaMigraciaChyba();
  if (!s) return null;
  const hash = createHash("sha256").update(s.text, "utf8").digest("hex");
  const poznamka = cesta === "KNIZNICA.md" ? null : poznamkaJson(nacitajSubor(cesta, s.text));
  return { subor: s, sha256_sedi: hash === s.sha256, round_trip: serializuj(parsuj(s.text)) === s.text, bloky: blokyJson(s.text), poznamka };
}
