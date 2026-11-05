/**
 * Dokument editora (port `assetin/engine/app_json.py`, D-186 krok 4c): graf knižnice rozšírený o všetko, čo
 * editor potrebuje na vykreslenie a úpravu každej poznámky (popisy polí zo schémy, pásma, inšpektor, reťazce,
 * telo, pod-záznamy, slovníky, návrhy ID). Stránka z neho len kreslí (princíp 3).
 */

import { PREFIXY } from "./paths";
import { idPoznamky, typPoznamky, type Kniznica } from "./graph";
import { grafJson } from "./graph-json";
import { inspektor, inspektorEr } from "./inspector";
import type { Diagnostika, Poznamka } from "./loader";
import { cestyPre, retazceJson, retazcePre } from "./chain";
import { TRIEDY_TYPOV } from "./schema/classes";
import { pasmaDokument, vsetkyPopisy } from "./ui";
import { PREDVOLBY_NOVEJ } from "./write";

const TYPY_POZNAMOK = ["GOAL", "UC", "ER", "IU-O", "IU-C", "STD", "PROP", "DEF", "EV", "ACT", "PROT", "PROJ"];

/** `json_bezpecne`: len slovníky, zoznamy a skaláre; dátumy ako ISO text. */
export function jsonBezpecne(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(jsonBezpecne);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonBezpecne(x)]));
  if (v === undefined) return null;
  return v;
}

/** `pasma.hranicne_pre`: pásma, na ktorých hranici konkrétna poznámka sedí (`HRANICNE_AK` podľa dát). */
export function hranicnePre(typ: string | null, model: Record<string, unknown> | null): string[] {
  const t = typ ? TRIEDY_TYPOV[typ] : undefined;
  const h = [...(t?.HRANICNE ?? [])];
  if (!h.length || !model) return [];
  const ak = t?.HRANICNE_AK;
  if (!ak || !ak.length) return h;
  const [kluc, ocakavane] = ak as [string, unknown];
  return model[kluc] === ocakavane ? h : [];
}

/** `_telo`: próza tela po sekciách s indexom bloku v `Dokument.telo` (editor prepisuje jeden blok). */
function telo(n: Poznamka) {
  const out: Array<Record<string, unknown>> = [];
  const sekcie: Array<{ nadpis: { text: string; uroven: number } | null; bloky: Array<{ i: number; raw: string; proza: boolean }> }> = [{ nadpis: null, bloky: [] }];
  n.dokument.telo.forEach((b, i) => {
    if (b.druh === "Nadpis") sekcie.push({ nadpis: { text: b.text, uroven: b.uroven }, bloky: [] });
    else sekcie[sekcie.length - 1].bloky.push({ i, raw: b.raw, proza: b.druh === "Proza" });
  });
  for (const s of sekcie) {
    const prozy = s.bloky.filter((b) => b.proza);
    const proza = prozy.map((b) => b.raw).join("").trim();
    if (!proza) continue;
    out.push({
      nadpis: s.nadpis ? s.nadpis.text : null,
      uroven: s.nadpis ? s.nadpis.uroven : 0,
      proza,
      bloky: prozy.filter((b) => b.raw.trim()).map((b) => ({ i: b.i, text: b.raw.trim() })),
    });
  }
  return out;
}

export interface InfoRevizie {
  /** `sklad.info()`: rel -> posledná revízia (autor, čas); priečinok ju nepozná. */
  info?: () => Record<string, unknown>;
  vyzadujeAutora?: boolean;
}

function poznamka(k: Kniznica, n: Poznamka, diag: Diagnostika[], sklad: InfoRevizie) {
  const nid = idPoznamky(n);
  const typ = typPoznamky(n);
  const m = n.model;
  const cesty = nid ? cestyPre(k, nid) : [];
  return {
    id: nid,
    typ,
    hranicne: m ? hranicnePre(typ, m) : [],
    inspektor: nid ? inspektor(k, nid) : null,
    retazce: nid ? retazcePre(k, nid) : [],
    cesta: cesty.length ? cesty[0] : [],
    cesty,
    telo: telo(n),
    nazov: m ? (m.nazov ?? null) : nid,
    nazov_en: m ? (m.nazov_en ?? null) : null,
    stav: m ? (m.stav ?? null) : null,
    subor: n.rel,
    verzia: n.verzia,
    revizia: sklad.info ? (jsonBezpecne(sklad.info()[n.rel]) ?? null) : null,
    vrstva: n.umiestnenie ? n.umiestnenie.vrstva : "zadanie",
    natypovana: m !== null,
    data: jsonBezpecne(n.data),
    zdroje: { ...n.zdroje },
    riadky: Object.fromEntries(Object.entries(n.riadky).map(([kl, v]) => [kl, v + 1])),
    pod_zaznamy: n.pod_zaznamy.map((pz) => ({
      id: pz.id,
      druh: pz.druh,
      nazov: (pz.data.nazov as string) || pz.id,
      nadpis: pz.nadpis.text,
      riadok: pz.blok.riadok + 2,
      data: jsonBezpecne(pz.data),
      ma_ids_blok: pz.ids_blok !== null,
      cesty: cestyPre(k, pz.id),
    })),
    diagnostiky: diag.filter((d) => d.note_id === nid),
  };
}

/** `_slovniky`: pod-záznamy slovníkov, aby bunka `hodnoty_ref` ponúkla hodnoty. */
function slovniky(k: Kniznica) {
  const out: Record<string, unknown> = {};
  for (const [rodic, pid, pz] of k.pod_zaznamy_poradie) {
    if (pz.druh !== "slovnik") continue;
    out[`${rodic}#${pid}`] = {
      id: pid,
      poznamka: rodic,
      system: pz.data.system ?? null,
      hodnoty: jsonBezpecne(pz.data.hodnoty ?? null),
      vzor: pz.data.vzor ?? null,
      odvodene_z: pz.data.odvodene_z ?? null,
    };
  }
  return out;
}

const CISELNE_ID = /^([A-Z]+(?:-[A-Z])?)-(\d+)$/;
const typZPrefixu = (token: string) => {
  for (const p of Object.keys(PREFIXY).sort((a, b) => b.length - a.length)) if (token === p || token.startsWith(`${p}-`)) return PREFIXY[p];
  return null;
};

/** `cesty.dalsie_id`: ďalšie voľné poradové číslo typu s číslovanými ID; `null` pre slug ID. */
export function dalsieId(existujuce: Iterable<string>, typ: string): string | null {
  if (!Object.values(PREFIXY).includes(typ)) return null;
  const najvyssie = new Map<string, [number, number]>();
  for (const nid of existujuce) {
    const m = CISELNE_ID.exec(nid);
    if (!m || typZPrefixu(nid) !== typ) continue;
    const [, prefix, cislo] = m;
    const n = Number.parseInt(cislo, 10);
    if (n > (najvyssie.get(prefix) ?? [0, cislo.length])[0]) najvyssie.set(prefix, [n, cislo.length]);
  }
  if (!najvyssie.size) return ["GOAL", "UC", "ER", "PROT", "PROJ"].includes(typ) ? `${typ}-0001` : null;
  const [prefix, [n, sirka]] = [...najvyssie.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))[0];
  return `${prefix}-${String(n + 1).padStart(sirka, "0")}`;
}

/**
 * `app_json.dokument`: graf + popisy typov, pásma, inšpektor v kontexte výmeny, reťazce, poznámky, registre,
 * kotvy, slovníky, návrhy ID. `diag` sú diagnostiky validátora (krok 5); bez nich diagnostiky grafu.
 */
export function dokumentEditora(k: Kniznica, diag?: Diagnostika[], sklad: InfoRevizie = {}) {
  const d = diag ?? k.diagnostiky;
  const zaklad = grafJson(k, d) as Record<string, unknown>;
  const poznamky = k.vsetky.filter((n) => idPoznamky(n) !== null).map((n) => poznamka(k, n, d, sklad));
  const registre = new Map<string, string[]>();
  for (const p of poznamky) registre.set(p.typ || "?", [...(registre.get(p.typ || "?") ?? []), p.id!]);
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return {
    ...zaklad,
    typy: vsetkyPopisy(),
    pasma: pasmaDokument(),
    inspektor_er: inspektorEr(k),
    retazce: retazceJson(k),
    poznamky,
    registre: Object.fromEntries([...registre.entries()].sort(([a], [b]) => cmp(a, b)).map(([t, ids]) => [t, [...ids].sort(cmp)])),
    kotvy: Object.fromEntries(k.kotvy),
    slovniky: slovniky(k),
    navrhy_id: Object.fromEntries(TYPY_POZNAMOK.map((t) => [t, dalsieId(k.poznamky.keys(), t)])),
    predvolby_novej: { ...PREDVOLBY_NOVEJ },
    autor_povinny: !!sklad.vyzadujeAutora,
  };
}
