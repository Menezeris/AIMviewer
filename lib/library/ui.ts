/**
 * Popisy polí pre editor (port `assetin/schema/ui.py` a `pasma.py`, D-186 krok 4c): zo schémy (JSON Schema
 * modelov) a triednych metadát typov vyrobí, čo potrebuje generický tabuľkový editor (stĺpce, editory buniek,
 * cieľové typy odkazov, politika kotvy), a tabuľku pásiem noriem. Stránka nič z toho nedrží (princíp 3).
 */

import { jsonSchema } from "./schema/jsonSchema";
import { SCHEMY } from "./schema/models";
import { SUB_RECORD_CLASSES, TYPE_CLASSES, type TriedaTypu } from "./schema/classes";

type JS = Record<string, unknown>;

const WIKILINK_PATTERN = "^\\[\\[[^\\[\\]]+\\]\\]$";
const DLHY_TEXT = new Set(["pokyn", "postup", "zdovodnenie", "definicia", "text", "content", "popis", "metoda_merania", "hranica_merania", "referencny_dokument", "klasifikacia_19650", "zdroj_normy", "nazov"]);
const TYPY_POZNAMOK = ["GOAL", "UC", "ER", "IU-O", "IU-C", "STD", "PROP", "DEF", "EV", "ACT", "PROT", "PROJ"];
const POD = ["pravidlo", "profil", "slovnik"];

/**
 * Explicitný `title` poľa, ktorého typ je definícia (`$ref`): JSON Schema ho nenesie (pydantic ho vedľa `$ref`
 * nevypíše), preto je tu podľa titulku modelu. Výpis z Pythonu (assetin-library f7c103c); polia, ktorých title JSON
 * Schema nesie, tu nie sú.
 */
const TITULKY_ODKAZOV: Record<string, Record<string, string>> = { IU_O: { objekt: "Objekt" }, ProfilGEO: { aspekty: "Aspekty" } };

/**
 * Polia bez explicitného `title` (titulok editora je kľúč): pydantic im v JSON Schema vymyslí titulok
 * (`FirstCoordinate` -> `Firstcoordinate`), ktorý sa od explicitného (`typ` -> `Typ`) nedá odlíšiť. Výpis z Pythonu.
 */
const GEO = ["ShapeAssembly", "ShapeRepresentation", "ShapeInfluence", "Dimensionality", "Appearance", "ParametricBehaviour", "Location"];
const BEZ_TITULKU: Record<string, string[]> = {
  ...Object.fromEntries(["FacetPartOf", "FacetMaterial", "FacetProperty", "FacetClassification", "FacetAttribute", "FacetEntity"].map((m) => [m, ["facet"]])),
  Geometria: GEO,
  Aspekty: GEO,
  ShapeInfluenceModel: ["InsideGeometry", "Connections", "Openings", "OperatingAndClearanceZones", "Features", "ThresholdDimension"],
  LocationModel: ["PositioningType", "ReferenceObject"],
  ModelCS: ["FirstCoordinate", "SecondCoordinate", "Height", "XAxisAbscissa", "XAxisOrdinate"],
};

interface Ctx {
  defs: Record<string, JS>;
}

const jeWikilink = (n: JS) => n.type === "string" && n.pattern === WIKILINK_PATTERN;
const refMeno = (n: JS) => (typeof n.$ref === "string" ? n.$ref.replace("#/$defs/", "") : null);
const xa = (n: JS) => (n["x-assetin"] ?? {}) as JS;

/** `_bez_none`: vetvy únie bez `null`. */
function bezNone(n: JS): JS[] {
  const vetvy = (Array.isArray(n.anyOf) ? n.anyOf : Array.isArray(n.oneOf) ? n.oneOf : null) as JS[] | null;
  if (!vetvy) return [n];
  return vetvy.filter((x) => x.type !== "null").flatMap((x) => (Array.isArray(x.anyOf) || Array.isArray(x.oneOf) ? bezNone(x) : [x]));
}

function jeModel(n: JS, ctx: Ctx): string | null {
  const r = refMeno(n);
  return r && ctx.defs[r]?.properties ? r : null;
}

function diskriminator(def: JS) {
  for (const [k, n] of Object.entries((def.properties ?? {}) as Record<string, JS>)) {
    const v = bezNone(n);
    if (v.length === 1 && "const" in v[0]) return { kluc: k, hodnota: v[0].const };
    if (v.length === 1 && Array.isArray(v[0].enum) && (v[0].enum as unknown[]).length === 1) return { kluc: k, hodnota: (v[0].enum as unknown[])[0] };
  }
  return null;
}

function druhSkalara(n: JS, meno: string, ctx: Ctx): Record<string, unknown> {
  if (Array.isArray(n.enum)) return { druh: "enum", hodnoty: [...(n.enum as unknown[])] };
  if ("const" in n) return { druh: "enum", hodnoty: [n.const] };
  if (jeWikilink(n)) return { druh: "odkaz" };
  if (n.type === "boolean") return { druh: "boolean" };
  if (n.type === "integer") return { druh: "cislo", cele: true };
  if (n.type === "number") return { druh: "cislo" };
  if (n.type === "string" && n.format === "date") return { druh: "datum" };
  if (n.type === "string") return { druh: DLHY_TEXT.has(meno) ? "dlhy-text" : "text" };
  const m = jeModel(n, ctx);
  if (m) return { druh: "objekt", polia: popisPoli(ctx.defs[m], ctx) };
  if (n.type === "array") {
    const items = (n.items ?? {}) as JS;
    const v = bezNone(items);
    const vm = v.length === 1 ? jeModel(v[0], ctx) : null;
    if (vm) return { druh: "zoznam-objektov", polia: popisPoli(ctx.defs[vm], ctx) };
    const vn = druh(items, meno, ctx);
    if (vn.druh === "odkaz") return { druh: "zoznam-odkazov" };
    if (vn.druh === "unia-objektov") return { druh: "zoznam-unii", varianty: vn.varianty };
    return { druh: "zoznam-textov", polozka: vn };
  }
  if (n.type === "object" && n.additionalProperties !== undefined && !n.properties) {
    const h = typeof n.additionalProperties === "object" ? (n.additionalProperties as JS) : null;
    const hm = h ? jeModel(h, ctx) : null;
    return hm ? { druh: "mapa-objektov", polia: popisPoli(ctx.defs[hm], ctx) } : { druh: "mapa" };
  }
  return { druh: "text" };
}

/** `_druh`: druh editora pre typ poľa (už bez `None`). */
function druh(n: JS, meno: string, ctx: Ctx): Record<string, unknown> {
  const vetvy = bezNone(n);
  if (vetvy.length <= 1) return druhSkalara(vetvy[0] ?? {}, meno, ctx);
  const varianty: unknown[] = [];
  const skalary: Array<Record<string, unknown>> = [];
  for (const a of vetvy) {
    const m = jeModel(a, ctx);
    if (m) {
      const def = ctx.defs[m];
      varianty.push({ nazov: m, diskriminator: diskriminator(def), povinne_kluce: [...((def.required as string[]) ?? [])], polia: popisPoli(def, ctx) });
    } else skalary.push(druhSkalara(a, meno, ctx));
  }
  if (varianty.length) return { druh: "unia-objektov", varianty };
  if (skalary.some((s) => s.druh === "enum")) {
    const hodnoty = skalary.flatMap((s) => (s.hodnoty as unknown[] | undefined) ?? []);
    return hodnoty.length ? { druh: "enum-alebo-text", hodnoty } : { druh: "text" };
  }
  return { druh: "text" };
}

function obmedzenia(n: JS): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const vetvy = bezNone(n);
  const c = vetvy.length === 1 ? vetvy[0] : n;
  if (typeof c.pattern === "string" && c.pattern !== WIKILINK_PATTERN) out.vzor = c.pattern;
  if (typeof c.minLength === "number") out.min_dlzka = c.minLength;
  if (typeof c.minItems === "number") out.min_dlzka = c.minItems;
  if (typeof c.maxLength === "number") out.max_dlzka = c.maxLength;
  if (typeof c.maxItems === "number") out.max_dlzka = c.maxItems;
  if (typeof c.minimum === "number") out.min = c.minimum;
  if (typeof c.maximum === "number") out.max = c.maximum;
  if (typeof c.exclusiveMinimum === "number") out.vac_ako = c.exclusiveMinimum;
  if (typeof c.exclusiveMaximum === "number") out.men_ako = c.exclusiveMaximum;
  return out;
}

function popisPola(kluc: string, n: JS, povinne: boolean, ctx: Ctx, model: string): Record<string, unknown> {
  // pole bez `pole()` nesie len x-assetin typu (WikiLink), nie vlastné
  let x = xa(n);
  if (JSON.stringify(x) === JSON.stringify({ widget: "wikilink" }) && jeWikilink(n)) x = {};
  const atribut = kluc.replace(/\./g, "_");
  const titulok = BEZ_TITULKU[model]?.includes(kluc) ? kluc : (TITULKY_ODKAZOV[model]?.[kluc] ?? (typeof n.title === "string" ? n.title : kluc));
  const p: Record<string, unknown> = {
    kluc,
    atribut,
    titulok,
    popis: typeof n.description === "string" && !refMeno(n) ? n.description : null,
    povinne,
    zdroj: (x.zdroj as string) ?? "frontmatter",
    ...druh(n, atribut, ctx),
  };
  if ((x.widget === "text" || x.widget === "dlhy-text") && (p.druh === "text" || p.druh === "dlhy-text")) p.druh = x.widget;
  if (x.sekcia) p.sekcia = x.sekcia;
  if (x.cielove_typy) {
    p.cielove_typy = x.cielove_typy;
    p.kotva = x.kotva ?? "ziadna";
  }
  for (const k of ["widget", "odvodene", "polozky", "technicky", "trieda_obmedzenia", "export"]) if (x[k]) p[k] = x[k];
  const o = obmedzenia(n);
  if (Object.keys(o).length) p.obmedzenia = o;
  return p;
}

function popisPoli(def: JS, ctx: Ctx): Array<Record<string, unknown>> {
  const req = new Set((def.required as string[]) ?? []);
  return Object.entries((def.properties ?? {}) as Record<string, JS>).map(([k, n]) => popisPola(k, n, req.has(k), ctx, String(def.title ?? "")));
}

function popisTypu(js: JS, t: TriedaTypu, typ: string) {
  const ctx: Ctx = { defs: (js.$defs ?? {}) as Record<string, JS> };
  return {
    typ,
    nazov: String(js.title),
    popis: typeof js.description === "string" ? js.description.trim().split("\n")[0] : "",
    sekcie: [...(t.SEKCIE ?? [])],
    sekcia_preco: t.SEKCIA_PRECO ?? "",
    pod_zaznamy: [...(t.POD_ZAZNAMY ?? [])],
    ramec: t.RAMEC ?? "",
    prierezove: !!t.PRIEREZOVE,
    hranicne: [...(t.HRANICNE ?? [])],
    hranicne_ak: [...(t.HRANICNE_AK ?? [])],
    ikona: t.IKONA ?? "ti-file",
    popisok: t.POPISOK || typ,
    popisok_export: t.POPISOK_EXPORT || t.POPISOK || typ,
    poradie_ui: t.PORADIE_UI ?? 99,
    stlpce: [...(t.STLPCE ?? [])],
    polia: popisPoli(js, ctx),
  };
}

/** `vsetky_popisy`: opis každého typu poznámky a druhu pod-záznamu pre editor. */
export function vsetkyPopisy() {
  const out: Record<string, unknown> = {};
  for (const typ of TYPY_POZNAMOK) out[typ] = popisTypu(jsonSchema(SCHEMY[typ as keyof typeof SCHEMY]), TYPE_CLASSES[typ], typ);
  for (const d of POD) out[`pod-${d}`] = popisTypu(jsonSchema(SCHEMY[`pod-${d}` as keyof typeof SCHEMY]), SUB_RECORD_CLASSES[d], SUB_RECORD_CLASSES[d].DRUH ?? d);
  return out;
}

// ------------------------------------------------------------------------------------------------ pásma (V20)

export const RAMCE = [
  { kluc: "19650-1", otazka: "Prečo?", norma: "19650-1", upresnenie: "cieľ", farba: "--pasmo-preco" },
  { kluc: "29481", otazka: "Kto a kedy?", norma: "29481", upresnenie: "PAS 6.1.3 — udalosť spúšťa účel, úlohy sa delia na dodanie a použitie", farba: "--pasmo-kto", skupina_panela: "jadro" },
  { kluc: "7817", otazka: "Čo a ako podrobne?", norma: "7817", upresnenie: "PAS 6.3.2 — výmena je kolekcia jednotiek", farba: "--pasmo-co", skupina_panela: "jadro" },
  { kluc: "19650-2-eir", otazka: "Pre koho a dokedy?", norma: "", upresnenie: "", farba: "", sev: true, poznamka: "knižnica tu končí — dopĺňa poverenie" },
];
export const PRIEREZOVE_POPIS = "prierezové — dopadá na každé pásmo, preto sa nečísluje";

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** `poradie_panela`: typy v poradí ľavého panela (PORADIE_UI, potom kód). */
export const poradiePanela = () => [...TYPY_POZNAMOK].sort((a, b) => (TYPE_CLASSES[a].PORADIE_UI ?? 99) - (TYPE_CLASSES[b].PORADIE_UI ?? 99) || cmp(a, b));

function skupinaPanela(typ: string): string {
  const t = TYPE_CLASSES[typ];
  if (!t) return "";
  if (t.PRIEREZOVE) return "prierezove";
  const r = RAMCE.find((x) => x.kluc === (t.RAMEC ?? ""));
  return r ? String(("skupina_panela" in r && r.skupina_panela) || t.RAMEC) : (t.RAMEC ?? "");
}

function skupinyPanela(): string[][] {
  const out: string[][] = [];
  let posledna: string | null = null;
  for (const typ of poradiePanela()) {
    const s = skupinaPanela(typ);
    if (s !== posledna) {
      out.push([]);
      posledna = s;
    }
    out[out.length - 1].push(typ);
  }
  return out;
}

function popisky() {
  const out: Record<string, Record<string, string>> = {};
  for (const typ of TYPY_POZNAMOK) {
    const t = TYPE_CLASSES[typ];
    out[typ] = { popisok: t.POPISOK || typ, popisok_export: t.POPISOK_EXPORT || t.POPISOK || typ, ikona: t.IKONA ?? "ti-file" };
  }
  for (const d of POD) {
    const t = SUB_RECORD_CLASSES[d];
    out[`pod-${d}`] = { popisok: t.POPISOK ?? d, popisok_export: t.POPISOK_EXPORT ?? d, ikona: t.IKONA ?? "ti-ruler" };
  }
  return out;
}

/** `pasma.dokument`. */
export function documentBands() {
  return { ramce: RAMCE.map((r) => ({ ...r })), poradie: poradiePanela(), skupiny: skupinyPanela(), popisky: popisky(), prierezove_popis: PRIEREZOVE_POPIS };
}
