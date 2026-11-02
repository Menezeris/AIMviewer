/**
 * Graf knižnice ako JSON (port `assetin/engine/graf_json.py`, D-186 krok 4a): uzly, typované hrany, stĺpce
 * kaskády, rodiny hrán, diagnostiky. Jeden export pre dokument editora a stránku grafu; projekcia `Kniznica`.
 */

import { idPoznamky, SCHEMA_VERZIA, typPoznamky, type Kniznica } from "./graf";
import type { Diagnostika, Poznamka } from "./loader";
import { parseWikilink } from "./projekcia";

export const KASKADA = [
  { kluc: "ciel", nazov: "Ciele", popis: "OIR → AIR → PIR (19650-1)" },
  { kluc: "podnet", nazov: "Podnet", popis: "impact event — prečo projekt vzniká" },
  { kluc: "scenar", nazov: "Účel užitia", popis: "use case a jeho úlohy (29481-1)" },
  { kluc: "milnik", nazov: "Míľnik", popis: "delivery event — kedy sa odovzdáva" },
  { kluc: "vymena", nazov: "Výmena", popis: "exchange requirement = UC × udalosť × príjemca" },
  { kluc: "kontajner", nazov: "Kontajnery", popis: "čo sa fyzicky odovzdá (IU-C)" },
  { kluc: "objekt", nazov: "Typy objektov", popis: "šablóny IDS špecifikácií (IU-O)" },
  { kluc: "standard", nazov: "Štandard a definície", popis: "STD pravidlá, GEO profily, slovníky, DEF, PROP" },
  { kluc: "akter", nazov: "Aktéri", popis: "strana → tím → funkcia (19650-2)" },
  { kluc: "projekt", nazov: "Projekt", popis: "dosadenie knižnice do zákazky (PROJ, PROT)" },
];

export const RODINY: Record<string, Record<string, unknown>> = {
  kaskada: { nazov: "Kaskáda", popis: "cieľ → scenár → výmena → jednotka" },
  roly: { nazov: "Roly", popis: "kto dodáva, kto preberá, kto overuje" },
  standard: { nazov: "Štandard", popis: "odkaz na pravidlo, profil, slovník alebo definíciu" },
  doklad: { nazov: "Doklad", popis: "čím je hodnota doložená" },
  ukotvenie: { nazov: "Ukotvenie", popis: "kam kontajner patrí" },
  poradie: { nazov: "Poradie a prednosť", popis: "TIDP nadväznosť, prednosť pri rozpore" },
  vystup: { nazov: "Výstup úlohy", popis: "čo úloha vyrobí", zapnuta: false },
};

const RODINA_POLA: Record<string, string> = {
  uc: "kaskada", spustacia_udalost: "kaskada", obsahuje: "kaskada", vyvolava: "kaskada", nadradeny_uc: "kaskada",
  precondition: "kaskada", prispieva_k: "kaskada", podporuje_ciel: "kaskada", er: "kaskada", ciele: "kaskada",
  ev: "kaskada", objekt: "kaskada",
  aktor: "roly", poskytovatel: "roly", prijemca: "roly", overuje: "roly", poskytovatel_predvoleny: "roly",
  zodpovedny_za_meranie: "roly", funkcie: "roly", strany: "roly",
  standard: "standard", zapnute: "standard", pravidlo: "standard", clenenie: "standard", hodnoty_ref: "standard",
  profil: "standard", definicia_ref: "standard", zdroj_hodnot: "standard", prepisuje: "standard",
  odkazuje_na: "standard", std_projekt: "standard", odvodene_z: "standard", iu: "standard",
  dokladuje: "doklad", dolozene_v: "doklad", dok: "doklad", referencne_info: "doklad", zdroj_oir: "doklad",
  viaze_sa_na: "ukotvenie",
  predchodca: "poradie", nadvaznost: "poradie", nadradene_pri_rozpore: "poradie", doplnuje: "poradie",
  vystup: "vystup",
};

const KASKADA_TYPU: Record<string, string> = {
  GOAL: "ciel", UC: "scenar", ER: "vymena", "IU-C": "kontajner", "IU-O": "objekt", STD: "standard", GEO: "standard",
  DEF: "standard", PROP: "standard", ACT: "akter", PROJ: "projekt", PROT: "projekt",
};

/** `priradenie.segmenty_pointera`: ukazovateľ bez indexov a bez úvodného `#<pod-záznam>`. */
export const segmentyPointera = (p: string) =>
  p.replace(/^\/+|\/+$/g, "").split("/").filter((s) => s && !/^\d+$/.test(s)).map((s) => s.replace(/^#+/, ""));

/** `priradenie.pole_pointera`: najvnútornejšie pole, okrem záznamu priradenia (`obsahuje[].iu` = `obsahuje`). */
export function polePointera(p: string): string {
  const seg = segmentyPointera(p);
  if (!seg.length) return "";
  if (seg.length >= 2 && seg[seg.length - 2] === "obsahuje" && seg[seg.length - 1] === "iu") return "obsahuje";
  return seg[seg.length - 1];
}

type M = Record<string, unknown> | null;
const g = (m: M, k: string): unknown => (m ? m[k] : undefined) ?? null;
const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
const zoznam = (v: unknown) => (Array.isArray(v) ? [...v] : []);
const ciel = (raw: unknown) => (typeof raw === "string" ? (parseWikilink(raw)?.ciel ?? raw) : null);

function kaskada(typ: string | null, model: M): string {
  if (typ === "EV") return g(model, "typ_udalosti") === "impact" ? "podnet" : "milnik";
  return KASKADA_TYPU[typ ?? ""] ?? "standard";
}

export function rodinaHrany(pointer: string): string {
  const seg = segmentyPointera(pointer);
  if (seg.length) {
    const pole = polePointera(pointer);
    if (pole in RODINA_POLA && pole !== seg[seg.length - 1]) return RODINA_POLA[pole];
  }
  for (const s of [...seg].reverse()) if (s in RODINA_POLA) return RODINA_POLA[s];
  return "kaskada";
}

function ulohaHrany(pointer: string, ulohy: Array<{ id: unknown }>): string | null {
  const c = pointer.replace(/^\/+|\/+$/g, "").split("/");
  if (c.length >= 2 && c[0] === "ulohy" && /^\d+$/.test(c[1])) {
    const i = Number(c[1]);
    if (i < ulohy.length) return String(ulohy[i].id);
  }
  return null;
}

function suhrn(n: Poznamka): Record<string, unknown> {
  const m = n.model;
  if (!m) return {};
  const typ = typPoznamky(n);
  const o = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);
  switch (typ) {
    case "GOAL":
      return { uroven: g(m, "uroven"), zdroj_ir: g(m, "zdroj_ir"), kpi: len(g(m, "kpi")) };
    case "UC":
      return { typ_ulohy: g(m, "typ_ulohy"), faza: zoznam(g(m, "faza_iso22263")), pouzitie: zoznam(g(m, "pouzitie")), ulohy: len(g(m, "ulohy")), zrelost: g(m, "zrelost") };
    case "ER": {
      const f = o(g(m, "forma"));
      return { format: g(f, "format"), verzia_schemy: g(f, "verzia_schemy"), prijemca: g(m, "prijemca") ? String(g(m, "prijemca")) : null, prepisy: len(g(m, "prepisy")) };
    }
    case "EV":
      return { typ_udalosti: g(m, "typ_udalosti"), planovana: g(m, "planovana"), faza: zoznam(g(m, "faza_iso22263")) };
    case "IU-O": {
      const geo = o(g(m, "geometria"));
      const prof = g(geo, "profil");
      return {
        ifc_entita: g(o(g(m, "objekt")), "ifc_entita"),
        pritomnost: g(m, "pritomnost_v_modeli"),
        uroven: g(m, "uroven"),
        polozky: len(g(m, "alfanumerika")),
        dokumentacia: len(g(m, "dokumentacia")),
        geometria: geo === null ? null : prof ? String(prof) : prof,
        typ_poziadavky: zoznam(g(m, "typ_poziadavky")),
      };
    }
    case "IU-C":
      return { druh: g(m, "druh"), format: g(o(g(m, "forma")), "format"), status_cde: g(o(g(m, "metadata_cde")), "status"), typ_poziadavky: g(m, "typ_poziadavky") };
    case "ACT":
      return { uroven: g(m, "uroven"), strana: g(m, "strana") };
    case "DEF":
      return { jednotka: g(m, "jednotka"), tolerancia: g(m, "tolerancia"), zaokruhlenie: g(m, "zaokruhlenie") };
    case "PROP":
      return { datovy_typ: g(m, "datovy_typ"), jednotka: g(m, "jednotka") };
    case "STD":
      return { pravidla: n.pod_zaznamy.filter((p) => p.druh === "pravidlo").length, profily: n.pod_zaznamy.filter((p) => p.druh === "profil").length, slovniky: n.pod_zaznamy.filter((p) => p.druh === "slovnik").length };
    case "PROJ":
      return { projekt: g(m, "projekt"), er: len(g(m, "er")) };
  }
  return {};
}

function ifcPopis(ifc: M): string {
  if (!ifc) return "";
  if ("atribut" in ifc) return String(ifc.atribut);
  if ("material" in ifc) return `material: ${ifc.material}`;
  return `${ifc.pset} · ${ifc.nazov}`;
}

/** `Polozka.kluc`: kľúč položky pre `prepisy[].polozka` a `dokumentacia[].dokladuje`. */
export function klucPolozky(p: Record<string, unknown>): string {
  if (p.prop) return ciel(p.prop) ?? "";
  const i = (p.ifc ?? {}) as Record<string, unknown>;
  if ("atribut" in i) return String(i.atribut);
  if ("material" in i) return `material:${i.material}`;
  return String(i.nazov);
}

function polozky(n: Poznamka) {
  if (typPoznamky(n) !== "IU-O" || !n.model) return [];
  return zoznam(n.model.alfanumerika).map((x, i) => {
    const p = x as Record<string, unknown>;
    const s = (v: unknown) => (v ? String(v) : null);
    return {
      index: i, kluc: klucPolozky(p), ifc: ifcPopis((p.ifc as M) ?? null), prop: s(p.prop), rola: p.rola ?? null, povinnost: p.povinnost ?? null,
      overenie: p.overenie ?? null, povaha: p.povaha ?? null, vzor: p.vzor ?? null, hodnoty: Array.isArray(p.hodnoty) && p.hodnoty.length ? [...p.hodnoty] : null,
      hodnoty_ref: s(p.hodnoty_ref), definicia_ref: s(p.definicia_ref), dolozene_v: s(p.dolozene_v), tolerancia: p.tolerancia ?? null, pokyn: p.pokyn ?? null,
      pointer: `/alfanumerika/${i}`,
    };
  });
}

function ulohy(n: Poznamka) {
  return zoznam(n.model?.ulohy).map((x) => {
    const u = x as Record<string, unknown>;
    return { id: u.id, nazov: u.nazov, typ: u.typ ?? null, aktor: ciel(u.aktor), vystup: zoznam(u.vystup).map(ciel) };
  });
}

function pocty(diag: Diagnostika[], nid: string | null) {
  const p: Record<string, number> = { E: 0, W: 0, I: 0 };
  for (const d of diag) if (d.note_id === nid) p[d.uroven] += 1;
  return p;
}

export function typZId(id: string): string {
  for (const [prefix, typ] of [["IU-O", "IU-O"], ["IU-C", "IU-C"], ["GEO-", "GEO"], ["STD", "STD"], ["GOAL", "GOAL"], ["UC-", "UC"], ["ER-", "ER"], ["EV-", "EV"], ["ACT-", "ACT"], ["DEF-", "DEF"], ["PROP-", "PROP"], ["PROT", "PROT"], ["PROJ", "PROJ"]]) {
    if (id.startsWith(prefix)) return typ;
  }
  return "?";
}

const prazdne = () => ({ E: 0, W: 0, I: 0 });
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** `graf_json`: celá knižnica ako graf; visiace ciele sú uzly-duchovia, nie chýbajúce hrany. */
export function grafJson(k: Kniznica, diagnostiky?: Diagnostika[]) {
  const diag = diagnostiky ?? k.diagnostiky;
  const uzly = new Map<string, Record<string, unknown>>();
  for (const n of k.vsetky) {
    const nid = idPoznamky(n);
    if (nid === null) continue;
    const typ = typPoznamky(n);
    uzly.set(nid, {
      id: nid, typ, nazov: n.model ? (n.model.nazov ?? nid) : nid, nazov_en: n.model?.nazov_en ?? null, stav: n.model?.stav ?? null,
      vrstva: n.umiestnenie ? n.umiestnenie.vrstva : "zadanie", subor: n.rel, kaskada: kaskada(typ, n.model), visiaci: false,
      suhrn: suhrn(n), ulohy: ulohy(n), polozky: polozky(n), diagnostiky: pocty(diag, nid),
    });
    for (const pz of n.pod_zaznamy) {
      if (uzly.has(pz.id)) continue;
      const s: Record<string, unknown> = {};
      for (const kl of ["rozsah", "plati", "overenie", "zavaznost", "ucel_federacie", "vhodne_pre"]) if (pz.data[kl] !== undefined && pz.data[kl] !== null) s[kl] = pz.data[kl];
      uzly.set(pz.id, {
        id: pz.id, typ: pz.druh === "profil" ? "GEO" : "STD", druh: pz.druh, nazov: pz.data.nazov || pz.id, nazov_en: null, stav: null,
        vrstva: n.umiestnenie ? n.umiestnenie.vrstva : "zadanie", subor: n.rel, kaskada: "standard", visiaci: false, rodic: nid,
        suhrn: s, ulohy: [], polozky: [], diagnostiky: prazdne(),
      });
    }
  }
  const hrany: Array<Record<string, unknown>> = [];
  for (const o of k.odkazy) {
    if (!uzly.has(o.zdroj)) continue;
    const c = o.ciel ?? o.link.ciel;
    if (!uzly.has(c)) {
      const t = typZId(c);
      uzly.set(c, { id: c, typ: t, nazov: c, nazov_en: null, stav: null, vrstva: null, subor: null, kaskada: KASKADA_TYPU[t] ?? "standard", visiaci: true, suhrn: {}, ulohy: [], polozky: [], diagnostiky: prazdne() });
    }
    hrany.push({
      z: o.zdroj, na: c, pole: polePointera(o.pointer), pointer: o.pointer, rodina: rodinaHrany(o.pointer), kotva: o.link.kotva,
      rozlisene: o.ciel !== null, uloha: ulohaHrany(o.pointer, uzly.get(o.zdroj)!.ulohy as Array<{ id: unknown }>), riadok: o.riadok,
    });
  }
  return {
    kniznica: { schema_verzia: k.schema_verzia || SCHEMA_VERZIA, poznamky: k.poznamky.size, pod_zaznamy: k.pod_zaznamy.size, odkazy: k.odkazy.length },
    kaskada: KASKADA,
    rodiny: RODINY,
    uzly: [...uzly.values()].sort((a, b) => cmp(String(a.kaskada), String(b.kaskada)) || cmp(String(a.id), String(b.id))),
    hrany,
    diagnostiky: diag,
  };
}
