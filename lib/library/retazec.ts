/**
 * [V23] Reťazec ako strom, jeden na účel užitia (port `assetin/engine/retazec.py` a `priradenie.py`, D-186 krok 4b).
 *
 * Nad účelom ciele a spúšťacia udalosť, pod ním úlohy a výmeny; pod výmenou kontajnery a v každom objekty s
 * rozsahom aspektov LOIN (V27). Pruh "kde to sedí" a línia (U19) sú projekcie toho istého stromu.
 */

import { idPoznamky, typPoznamky, type Kniznica } from "./graf";
import { polePointera } from "./graf-json";
import { parseWikilink } from "./projekcia";
import { POPISKY_TYPU_ULOHY, TRIEDY_TYPOV } from "./schema/triedy";

type M = Record<string, unknown>;
export const ASPEKTY = ["geometria", "alfanumerika", "dokumentacia"];

const PASMO_ROLY: Record<string, string> = {
  ciel: "19650-1", ucel: "29481", udalost: "29481", uloha: "29481", vymena: "29481", dodanie: "29481", jednotka: "7817", kontajner: "7817",
};

const NOSNE_POLIA = new Set([
  "podporuje_ciel", "prispieva_k", "aktor", "poskytovatel", "prijemca", "overuje", "poskytovatel_predvoleny", "standard", "zapnute",
  "clenenie", "pravidlo", "hodnoty_ref", "definicia_ref", "profil", "prop", "dolozene_v", "dokladuje", "viaze_sa_na", "obsahuje",
]);

const pravda = (v: unknown) => !(v === null || v === undefined || v === false || v === 0 || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0));
const ciel = (raw: unknown): string | null => (typeof raw === "string" ? (parseWikilink(raw)?.ciel ?? null) : null);
const zoznam = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): M | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as M) : null);
/** Python `str.strip("[]")`. */
const stripZatvorky = (s: string) => s.replace(/^[[\]]+|[[\]]+$/g, "");

// ------------------------------------------------------------------------------------------------ priradenie (V27)

export interface Priradenie {
  kontajner: string;
  iu: string;
  index: number;
  rozsah: string[];
  ucinny_rozsah: string[];
  zuzene: boolean;
}

export function predvolenyRozsah(model: M | null, kontajner: string): string[] {
  if (!model) return [];
  const out = ASPEKTY.filter((a) => a !== "dokumentacia" && pravda(model[a]));
  if (zoznam(model.dokumentacia).some((d) => ciel(obj(d)?.dok) === kontajner)) out.push("dokumentacia");
  return out;
}

export function priradenia(k: Kniznica, iuc: string): Priradenie[] {
  const n = k.poznamky.get(iuc);
  if (!n || !n.model) return [];
  const out: Priradenie[] = [];
  zoznam(n.model.obsahuje).forEach((p, i) => {
    const c = ciel(obj(p)?.iu);
    if (!c) return;
    const rozsah = zoznam(obj(p)?.rozsah).map(String);
    const ucinny = rozsah.length ? rozsah : predvolenyRozsah(k.poznamky.get(c)?.model ?? null, iuc);
    out.push({ kontajner: iuc, iu: c, index: i, rozsah, ucinny_rozsah: ucinny, zuzene: rozsah.length > 0 });
  });
  return out;
}

export interface Jednotky {
  kontajnery: string[];
  priradenia: Map<string, Priradenie[]>;
  volne: string[];
  visiace: string[];
  objekty: string[];
  vsetky: string[];
}

const memoJednotky = new WeakMap<Kniznica, Map<string, Jednotky>>();

/** `jednotky_vymeny`: `ER.obsahuje` plus to, čo priraďujú jeho kontajnery (V27). */
export function jednotkyVymeny(k: Kniznica, erId: string): Jednotky {
  let memo = memoJednotky.get(k);
  if (!memo) memoJednotky.set(k, (memo = new Map()));
  const hit = memo.get(erId);
  if (hit) return hit;
  const out: Jednotky = { kontajnery: [], priradenia: new Map(), volne: [], visiace: [], objekty: [], vsetky: [] };
  const er = k.poznamky.get(erId);
  if (er && er.model) {
    const priame: string[] = [];
    for (const link of zoznam(er.model.obsahuje)) {
      const c = ciel(link);
      if (!c) continue;
      const n = k.poznamky.get(c);
      if (!n) {
        if (!out.visiace.includes(c)) out.visiace.push(c);
      } else if (typPoznamky(n) === "IU-C") {
        if (!out.kontajnery.includes(c)) {
          out.kontajnery.push(c);
          out.priradenia.set(c, priradenia(k, c));
        }
      } else if (typPoznamky(n) === "IU-O" && !priame.includes(c)) priame.push(c);
    }
    const nesene = new Set([...out.priradenia.values()].flat().map((p) => p.iu));
    out.volne = priame.filter((i) => !nesene.has(i));
  }
  for (const c of out.kontajnery) for (const p of out.priradenia.get(c) ?? []) if (!out.objekty.includes(p.iu)) out.objekty.push(p.iu);
  for (const i of out.volne) if (!out.objekty.includes(i)) out.objekty.push(i);
  out.vsetky = [...out.kontajnery, ...out.objekty, ...out.visiace];
  memo.set(erId, out);
  return out;
}

// ------------------------------------------------------------------------------------------------ uzly stromu

export interface Krok {
  rola: string;
  id: string;
  typ: string | null;
  pasmo: string;
  nazov: string;
  kotva: string | null;
  popis: string;
  visiaci: boolean;
  hranicne: string[];
  vystupy: string[];
  rozsah: string[];
  zuzene: boolean;
  typ_ulohy: string;
  typ_popisok: string;
}

/** `skratka_uloh`: `T2, T3, T4, T5, T6` -> `T2–T6` (tri a viac po sebe idúcich). */
export function skratkaUloh(idy: string[]): string {
  const cislo = (u: string) => /\d*$/.exec(u)![0];
  const r = idy.map((x) => [x.slice(0, x.length - cislo(x).length), cislo(x)] as const);
  const out: string[] = [];
  let i = 0;
  while (i < idy.length) {
    const [prefix, c] = r[i];
    let j = i;
    while (c && j + 1 < idy.length && r[j + 1][0] === prefix && r[j + 1][1] && Number(r[j + 1][1]) === Number(r[j][1]) + 1) j += 1;
    out.push(j - i >= 2 ? `${idy[i]}–${idy[j]}` : idy.slice(i, j + 1).join(", "));
    i = j + 1;
  }
  return out.join(", ");
}

function hranicnePre(typ: string | null, model: M | null): string[] {
  const t = TRIEDY_TYPOV[typ ?? ""];
  const h = [...(t?.HRANICNE ?? [])];
  if (!h.length || !model) return [];
  const ak = t?.HRANICNE_AK;
  if (!ak) return h;
  return model[ak[0]] === ak[1] ? h : [];
}

function pasmo(k: Kniznica, nid: string): [string | null, string, string[]] {
  const n = k.poznamky.get(nid);
  if (!n) {
    const pz = k.globalne_pod.get(nid);
    if (pz) return [pz.druh === "profil" ? "GEO" : "STD", "", []];
    return [null, "", []];
  }
  const typ = typPoznamky(n);
  const ramec = TRIEDY_TYPOV[typ ?? ""]?.RAMEC ?? "";
  return [typ, ramec, n.model ? hranicnePre(typ, n.model) : []];
}

function krok(k: Kniznica, rola: string, nid: string, popis = "", kotva: string | null = null): Krok {
  const [typ, ramec, hranicne] = pasmo(k, nid);
  const n = k.poznamky.get(nid);
  return {
    rola, id: nid, typ, pasmo: ramec || PASMO_ROLY[rola] || "", nazov: n && n.model ? String(n.model.nazov ?? "") : "", kotva, popis,
    visiaci: !n && !k.globalne_pod.has(nid), hranicne: [...hranicne], vystupy: [], rozsah: [], zuzene: false, typ_ulohy: "", typ_popisok: "",
  };
}

const prvy = (m: M | null, pole: string): string | null => {
  const v = m ? m[pole] : null;
  if (Array.isArray(v)) return v.length ? ciel(v[0]) : null;
  return v === null || v === undefined ? null : ciel(v);
};

/** `_kratky_akter`: `[[ACT-poverena/ARCH]]` -> `ARCH`, `[[ACT-poverujuca]]` -> `poverujuca`. */
function kratkyAkter(odkaz: unknown, jeWikilink: boolean): string {
  const c = jeWikilink ? ciel(odkaz) ?? "" : stripZatvorky(String(odkaz ?? "")).split("|")[0];
  if (!c) return "";
  return c.includes("/") ? c.split("/").pop()! : c.split("-").slice(1).join("-") || c;
}

function vystupyUlohy(u: M): string[] {
  const v = Array.isArray(u.vystup) ? u.vystup : u.vystup === undefined || u.vystup === null ? [] : [u.vystup];
  return [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => stripZatvorky(x).split("|")[0].split("#")[0]))].sort();
}

function uloha(k: Kniznica, ucId: string, u: M): Krok {
  const kr = krok(k, "uloha", ucId, kratkyAkter(u.aktor, false), String(u.id ?? ""));
  kr.nazov = String(u.nazov ?? "");
  kr.vystupy = vystupyUlohy(u);
  kr.typ_ulohy = String(u.typ ?? "");
  kr.typ_popisok = POPISKY_TYPU_ULOHY[kr.typ_ulohy] ?? kr.typ_ulohy;
  return kr;
}

export interface Kontajner {
  krok: Krok;
  objekty: Krok[];
}

export interface Vymena {
  er: Krok;
  dodanie: Krok | null;
  prijemca: string | null;
  z_uloh: string[];
  kontajnery: Kontajner[];
  jednotky: Krok[];
  forma: string | null;
  mvd: string[];
  pouzivaju: Krok[];
}

const objektyVymeny = (v: Vymena) => [...v.kontajnery.flatMap((c) => c.objekty), ...v.jednotky];

function poznamkaVymeny(v: Vymena): string {
  const c: string[] = [];
  if (v.dodanie) c.push(`pri ${v.dodanie.id}`);
  if (v.prijemca) c.push(`príjemca ${v.prijemca}`);
  if (v.z_uloh.length) c.push((v.z_uloh.length > 1 ? "z úloh " : "z úlohy ") + skratkaUloh(v.z_uloh));
  if (v.forma) c.push(v.forma);
  c.push(...v.mvd);
  return c.join(" · ");
}

export function vymenaJson(v: Vymena) {
  return {
    er: v.er, dodanie: v.dodanie, prijemca: v.prijemca, z_uloh: [...v.z_uloh], forma: v.forma, mvd: [...v.mvd],
    kontajnery: v.kontajnery.map((c) => ({ ...c.krok, objekty: c.objekty })), jednotky: v.jednotky, pouzivaju: v.pouzivaju, poznamka: poznamkaVymeny(v),
  };
}

function poskytovatel(k: Kniznica, nid: string): string {
  const p = k.poznamky.get(nid)?.model?.poskytovatel;
  return Array.isArray(p) && p.length ? kratkyAkter(p[0], true) : "";
}

function mvdKontajnerov(k: Kniznica, kontajnery: string[]): string[] {
  const out: string[] = [];
  for (const nid of kontajnery) {
    const mvd = obj(k.poznamky.get(nid)?.model?.mvd);
    if (!mvd) continue;
    const t = [mvd.basis, mvd.name].filter((x) => x).join(" ");
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function preTasky(k: Kniznica, jednotky: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const nid of jednotky) {
    const n = k.poznamky.get(nid);
    if (!n) continue;
    const h = Array.isArray(n.data.pre_task) ? n.data.pre_task : n.data.pre_task ? [n.data.pre_task] : [];
    for (const v of h) if (typeof v === "string" && v.includes("#")) out.add(stripZatvorky(v).split("|")[0].split("#").slice(1).join("#"));
  }
  return out;
}

function pouzivaju(k: Kniznica, erId: string, erModel: M, j: Jednotky): Krok[] {
  const moje = new Set(zoznam(erModel.uc).map(ciel).filter((x): x is string => !!x));
  const najdene: string[] = [];
  const pridaj = (x: string) => !najdene.includes(x) && najdene.push(x);
  for (const iny of k.podlaTypu("ER")) {
    const iid = idPoznamky(iny);
    if (iid === erId || !iny.model) continue;
    const odkazy = new Set([...zoznam(iny.model.precondition), ...zoznam(iny.model.referencne_info)].map(ciel).filter((x): x is string => !!x));
    if (odkazy.has(erId) || j.kontajnery.some((c) => odkazy.has(c))) {
      for (const uc of zoznam(iny.model.uc)) {
        const c = ciel(uc);
        if (c && !moje.has(c)) pridaj(c);
      }
    }
  }
  for (const nid of j.vsetky) {
    const n = k.poznamky.get(nid);
    if (!n) continue;
    for (const w of zoznam(n.data.pre_task)) {
      const c = stripZatvorky(String(w)).split("|")[0].split("#")[0].trim();
      if (c && !moje.has(c)) pridaj(c);
    }
  }
  return najdene.map((nid) => krok(k, "ucel", nid, "používa túto výmenu"));
}

function vymena(k: Kniznica, erId: string, erModel: M, ulohy: Krok[]): Vymena {
  const v: Vymena = { er: krok(k, "vymena", erId, "výmena pre tento účel"), dodanie: null, prijemca: null, z_uloh: [], kontajnery: [], jednotky: [], forma: null, mvd: [], pouzivaju: [] };
  const dodanie = prvy(erModel, "spustacia_udalost");
  if (dodanie) v.dodanie = krok(k, "dodanie", dodanie, "spúšťa výmenu (delivery)");
  v.prijemca = erModel.prijemca !== null && erModel.prijemca !== undefined ? kratkyAkter(erModel.prijemca, true) : null;
  const forma = obj(erModel.forma);
  v.forma = forma ? ((forma.verzia_schemy as string) || (forma.format as string) || null) : null;
  const j = jednotkyVymeny(k, erId);
  for (const nid of j.kontajnery) {
    const kont: Kontajner = { krok: krok(k, "kontajner", nid, poskytovatel(k, nid)), objekty: [] };
    for (const p of j.priradenia.get(nid) ?? []) {
      const o = krok(k, "jednotka", p.iu, "priradené kontajneru");
      o.rozsah = [...p.ucinny_rozsah];
      o.zuzene = p.zuzene;
      kont.objekty.push(o);
    }
    v.kontajnery.push(kont);
  }
  for (const nid of [...j.volne, ...j.visiace]) v.jednotky.push(krok(k, "jednotka", nid, "bez kontajnera"));
  v.mvd = mvdKontajnerov(k, j.kontajnery);
  const nesie = new Set(j.vsetky);
  const zPre = preTasky(k, nesie);
  v.z_uloh = ulohy.filter((u) => u.vystupy.some((x) => nesie.has(x)) || zPre.has(u.kotva ?? "")).map((u) => u.kotva ?? "");
  v.pouzivaju = pouzivaju(k, erId, erModel, j);
  return v;
}

// ------------------------------------------------------------------------------------------------ strom

export interface Retazec {
  id: string;
  ucel: Krok;
  ciele: Krok[];
  spusta: Krok | null;
  ulohy: Krok[];
  vymeny: Vymena[];
}

export interface Pozicia {
  kde: string;
  vymena: string | null;
  kontajner: string | null;
  kotva: null;
  cez?: string;
}

export function pozicie(r: Retazec, nid: string): Pozicia[] {
  const out: Pozicia[] = [];
  const kde = (rola: string, v: string | null = null, kontajner: string | null = null): Pozicia => ({ kde: rola, vymena: v, kontajner, kotva: null });
  for (const c of r.ciele) if (c.id === nid) out.push(kde("ciel"));
  if (r.spusta && r.spusta.id === nid) out.push(kde("spusta"));
  if (r.ucel.id === nid) out.push(kde("ucel"));
  for (const v of r.vymeny) {
    if (v.er.id === nid) out.push(kde("vymena", v.er.id));
    if (v.dodanie && v.dodanie.id === nid) out.push(kde("dodanie", v.er.id));
    for (const c of v.kontajnery) {
      if (c.krok.id === nid) out.push(kde("kontajner", v.er.id));
      for (const o of c.objekty) if (o.id === nid) out.push(kde("jednotka", v.er.id, c.krok.id));
    }
    for (const j of v.jednotky) if (j.id === nid) out.push(kde("jednotka", v.er.id));
  }
  return out;
}

function usekUlohy(r: Retazec, u: Krok): number {
  const i = r.vymeny.findIndex((v) => !!u.kotva && v.z_uloh.includes(u.kotva));
  if (u.typ_ulohy === "utilization") return i >= 0 ? i + 1 : r.vymeny.length;
  return i >= 0 ? i : 0;
}

export function linia(r: Retazec) {
  const skupiny: Krok[][] = Array.from({ length: r.vymeny.length + 1 }, () => []);
  for (const u of r.ulohy) skupiny[usekUlohy(r, u)].push(u);
  const out: Array<Record<string, unknown>> = [];
  r.vymeny.forEach((v, i) => {
    if (skupiny[i].length) out.push({ druh: "ulohy", ulohy: skupiny[i] });
    out.push({ druh: "predel", vymena: vymenaJson(v) });
  });
  if (skupiny[skupiny.length - 1].length) out.push({ druh: "ulohy", ulohy: skupiny[skupiny.length - 1] });
  return out;
}

export function retazecJson(r: Retazec) {
  return {
    id: r.id, ciele: r.ciele, spusta: r.spusta, ucel: r.ucel, ulohy: r.ulohy, linia: linia(r), vymeny: r.vymeny.map(vymenaJson),
    pasma: { ciele: PASMO_ROLY.ciel, strom: PASMO_ROLY.ucel, jednotky: PASMO_ROLY.jednotka },
  };
}

const memoRetazce = new WeakMap<Kniznica, Retazec[]>();

/** `retazce`: každý strom knižnice, jeden na účel užitia. */
export function retazce(k: Kniznica): Retazec[] {
  const hit = memoRetazce.get(k);
  if (hit) return hit;
  const vymenyUc = new Map<string, Array<{ id: string; model: M }>>();
  for (const er of k.podlaTypu("ER")) {
    const eid = idPoznamky(er);
    if (eid === null || !er.model) continue;
    for (const c of [...new Set(zoznam(er.model.uc).map(ciel).filter((x): x is string => !!x))]) vymenyUc.set(c, [...(vymenyUc.get(c) ?? []), { id: eid, model: er.model }]);
  }
  const out: Retazec[] = [];
  for (const uc of k.podlaTypu("UC")) {
    const uid = idPoznamky(uc);
    if (uid === null || !uc.model) continue;
    const r: Retazec = { id: uid, ucel: krok(k, "ucel", uid, "účel užitia"), ciele: [], spusta: null, ulohy: [], vymeny: [] };
    r.ciele = zoznam(uc.model.podporuje_ciel).map(ciel).filter((x): x is string => !!x).map((c) => krok(k, "ciel", c, "prečo to robíme"));
    const impact = prvy(uc.model, "spustacia_udalost");
    if (impact) r.spusta = krok(k, "udalost", impact, "spúšťa účel užitia (impact)");
    const ucData = k.poznamky.get(uid)?.data;
    r.ulohy = zoznam(ucData?.ulohy).filter((u): u is M => !!obj(u)).map((u) => uloha(k, uid, u));
    const vPoradi = [...(vymenyUc.get(uid) ?? [])].sort((a, b) => {
      const ka = prvy(a.model, "spustacia_udalost") ?? "";
      const kb = prvy(b.model, "spustacia_udalost") ?? "";
      return ka < kb ? -1 : ka > kb ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    r.vymeny = vPoradi.map((e) => vymena(k, e.id, e.model, r.ulohy));
    out.push(r);
  }
  memoRetazce.set(k, out);
  return out;
}

function* uzly(r: Retazec): Generator<string> {
  for (const c of r.ciele) yield c.id;
  if (r.spusta) yield r.spusta.id;
  yield r.ucel.id;
  for (const v of r.vymeny) {
    yield v.er.id;
    if (v.dodanie) yield v.dodanie.id;
    for (const c of v.kontajnery) {
      yield c.krok.id;
      for (const o of c.objekty) yield o.id;
    }
    for (const j of v.jednotky) yield j.id;
  }
}

const memoPozicii = new WeakMap<Kniznica, Map<string, Array<[number, Pozicia]>>>();
function indexPozicii(k: Kniznica) {
  const hit = memoPozicii.get(k);
  if (hit) return hit;
  const idx = new Map<string, Array<[number, Pozicia]>>();
  retazce(k).forEach((r, i) => {
    for (const nid of new Set(uzly(r))) for (const p of pozicie(r, nid)) idx.set(nid, [...(idx.get(nid) ?? []), [i, p]]);
  });
  memoPozicii.set(k, idx);
  return idx;
}

function nositelia(k: Kniznica, nid: string): Set<string> {
  const out = new Set<string>();
  const ciele = new Set([nid, ...(k.poznamky.get(nid)?.pod_zaznamy.map((p) => p.id) ?? [])]);
  for (const c of ciele) for (const o of k.odkazyNa(c)) if ((polePointera(o.pointer) && NOSNE_POLIA.has(polePointera(o.pointer))) || o.pointer.startsWith("#")) out.add(o.zdroj);
  return out;
}

function stromyPre(k: Kniznica, nid: string): [Array<[Retazec, Pozicia[]]>, boolean] {
  const vsetky = retazce(k);
  const idx = indexPozicii(k);
  const podla = new Map<number, Pozicia[]>();
  for (const [i, p] of idx.get(nid) ?? []) podla.set(i, [...(podla.get(i) ?? []), { ...p }]);
  if (podla.size) return [[...podla.keys()].sort((a, b) => a - b).map((i) => [vsetky[i], podla.get(i)!]), false];
  for (const x of [...nositelia(k, nid)].sort()) for (const [i, p] of idx.get(x) ?? []) podla.set(i, [...(podla.get(i) ?? []), { ...p, cez: x }]);
  return [[...podla.keys()].sort((a, b) => a - b).map((i) => [vsetky[i], podla.get(i)!]), podla.size > 0];
}

/** `retazce_pre`: stromy, na ktorých poznámka sedí, s označenými pozíciami (prierezová cez nositeľa). */
export function retazcePre(k: Kniznica, nid: string) {
  const [stromy, prierezovy] = stromyPre(k, nid);
  return stromy.map(([r, p]) => ({ ...retazecJson(r), prierezovy, pozicie: p }));
}

const ulohyPre = (r: Retazec, nid: string) => r.ulohy.filter((u) => u.vystupy.includes(nid)).map((u) => u.kotva ?? "");

/** `cesty_pre`: pruhy "kde to sedí" (cieľ › účel › úloha › výmena), bez duplicít. */
export function cestyPre(k: Kniznica, nid: string): Krok[][] {
  const out: Krok[][] = [];
  const [stromy] = stromyPre(k, nid);
  for (const [r, pp] of stromy) {
    for (const c of r.ciele.length ? r.ciele : [null]) {
      for (const p of pp) {
        const cesta: Krok[] = [];
        if (c && p.kde !== "ciel") cesta.push(c);
        if (["ciel", "spusta", "ucel"].includes(p.kde)) {
          out.push(cesta);
          continue;
        }
        cesta.push(r.ucel);
        if (p.kde === "jednotka" || p.kde === "kontajner") {
          const u = ulohyPre(r, p.cez || nid);
          if (u.length === 1) cesta.push(r.ulohy.find((x) => x.kotva === u[0])!);
        }
        if (["dodanie", "jednotka", "kontajner"].includes(p.kde)) cesta.push(r.vymeny.find((x) => x.er.id === p.vymena)!.er);
        out.push(cesta);
      }
    }
  }
  const videne = new Map<string, Krok[]>();
  for (const c of out) {
    const kl = c.map((x) => `${x.id}#${x.kotva ?? ""}`).join("\u0000");
    if (!videne.has(kl)) videne.set(kl, c);
  }
  return [...videne.values()];
}

/** `app_json._zhrnutie`: počty na prvý pohľad (objekt pod dvoma kontajnermi sa ráta raz). */
function zhrnutie(r: Retazec) {
  const u: Krok[] = [...r.ciele, ...(r.spusta ? [r.spusta] : [])];
  const objekty = new Set<string>();
  const kontajnery = new Set<string>();
  for (const v of r.vymeny) {
    u.push(v.er, ...objektyVymeny(v), ...v.kontajnery.map((c) => c.krok));
    for (const o of objektyVymeny(v)) objekty.add(o.id);
    for (const c of v.kontajnery) kontajnery.add(c.krok.id);
  }
  return { ciele: r.ciele.length, spusta: r.spusta !== null, ulohy: r.ulohy.length, vymeny: r.vymeny.length, jednotky: objekty.size, kontajnery: kontajnery.size, visiace: u.filter((x) => x.visiaci).length };
}

/** `app_json._retazce`: všetky stromy knižnice pre dokument editora. */
export function retazceJson(k: Kniznica) {
  return retazce(k).map((r) => ({ ...retazecJson(r), nazov: r.ucel.nazov, zhrnutie: zhrnutie(r) }));
}
