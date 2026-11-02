/**
 * Writer knižnice požiadaviek (port `assetin/engine/writer.py`, D-186 krok 3): chirurgické záplaty na blokovom
 * dokumente. Próza, poradie sekcií, `#` komentáre a HTML komentáre sa nedotknú; mení sa len dotknutý riadok
 * alebo segment (princíp 7).
 *
 * Úrovne: 1 skalár na svojom riadku · 1b celé riadky blokového zoznamu · 2 segment kľúča najvyššej úrovne
 * vypísaný znova · 3 inline pole · 4 nový pod-záznam / blokové pole / poznámka · 5 `aliases` (V18).
 * Pozície uzlov (ruamel `lc`) a flow štýl dáva `yaml` (eemeli, ISC); nové hodnoty vypisuje `yaml-zapis.ts`
 * ako ruamel. Zhodu stráži korpus `upravy/*` (bajtovo).
 */

import { isDeepStrictEqual } from "node:util";

import { Document, LineCounter, YAMLMap, isMap, isScalar, isSeq, parseDocument, Scalar, type Node as YamlNode, type Pair } from "yaml";

import { nacitajYaml, parsuj, preindexuj, serializuj, splitlines, type Blok, type Dokument, type Frontmatter, type InlinePole, type Nadpis, type Proza, type YamlBlok } from "./bloky";
import { dumpYaml, dumpZoznam } from "./yaml-zapis";

export class ChybaZapisu extends Error {}

type Obj = Record<string, unknown>;
type Cesta = ReadonlyArray<string | number>;
type YB = Frontmatter | YamlBlok;

const jeMapa = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const jeSkalar = (v: unknown) => v === null || v === undefined || ["string", "number", "boolean"].includes(typeof v);
/** Rovnosť ako `==` v Pythone (slovníky bez ohľadu na poradie kľúčov). */
const rovnake = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);
const bezKonca = (s: string) => s.replace(/[\r\n]+$/, "");
const odsadenie = (r: string) => r.length - r.replace(/^\s+/, "").length;
const lstrip = (s: string) => s.replace(/^\s+/, "");
const strip = (s: string) => s.trim();
/** `str.splitlines()` bez koncov riadkov. */
const riadky = (t: string) => splitlines(t).map((l) => l.replace(/(?:\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029])$/, ""));

const jeFrontmatter = (b: YB): b is Frontmatter => !("druh" in b);

// ------------------------------------------------------------------------------------------------ YAML pozície

function rt(text: string) {
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc, uniqueKeys: false, keepSourceTokens: true });
  return { doc, lc };
}

const kluc = (p: Pair) => (isScalar(p.key) ? String(p.key.value) : String(p.key));
const najdiPar = (m: YAMLMap, k: string | number) => (m.items as Pair[]).find((p) => kluc(p) === String(k));

interface Poloha {
  line: number | null;
  /** Rodič posledného kľúča (alebo uzol, kde sa cesta zastavila). */
  parent: YamlNode | null;
  k: string | number;
  ma: boolean;
  stare: unknown;
  stareJeBlokovyZoznam: boolean;
}

/** `_riadok_kluca`: riadok posledného kľúča cesty (0-based voči textu YAML), rodič a kľúč; flow = bez riadku. */
function riadokKluca(text: string, cesta: Cesta): Poloha {
  const { doc, lc } = rt(text);
  let node: unknown = doc.contents;
  let line: number | null = null;
  const vysledok = (l: number | null, parent: unknown, k: string | number): Poloha => {
    let ma = false;
    let child: unknown = undefined;
    if (isMap(parent)) {
      const p = najdiPar(parent, k);
      ma = !!p;
      child = p?.value;
    } else if (isSeq(parent) && typeof k === "number") {
      ma = k >= 0 && k < parent.items.length;
      child = ma ? parent.items[k] : undefined;
    }
    const stare = ma ? (child && typeof (child as YamlNode).toJSON === "function" ? (child as YamlNode).toJSON() : child) : null;
    return { line: l, parent: (parent as YamlNode) ?? null, k, ma, stare: plain(stare), stareJeBlokovyZoznam: ma && isSeq(child) && !child.flow };
  };
  for (let i = 0; i < cesta.length; i++) {
    const k = cesta[i];
    if (isMap(node) && najdiPar(node, k)) {
      if (node.flow) return vysledok(null, node, k);
      const p = najdiPar(node, k)!;
      line = lc.linePos((p.key as YamlNode).range![0]).line - 1;
      if (i < cesta.length - 1) node = p.value;
      else return vysledok(line, node, k);
    } else if (isSeq(node) && typeof k === "number" && k < node.items.length) {
      if (node.flow) return vysledok(null, node, k);
      const item = node.items[k] as YamlNode;
      line = lc.linePos(item.range![0]).line - 1;
      if (i < cesta.length - 1) node = item;
      else return vysledok(line, node, k);
    } else return vysledok(null, node, k);
  }
  return vysledok(line, node, cesta[cesta.length - 1]);
}

function plain(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(plain);
  if (jeMapa(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [String(k), plain(x)]));
  return v ?? null;
}

// ------------------------------------------------------------------------------------------------ blok: náhrada textu

function nahradYamlText(doc: Dokument, blok: YB, novy: string) {
  const y = nacitajYaml(novy);
  if (y.chyba) throw new ChybaZapisu(`po zápise neplatný YAML: ${y.sprava ?? ""}`);
  blok.yaml_text = novy;
  blok.raw = jeFrontmatter(blok) ? `---\n${novy}---\n` : `${(blok as YamlBlok).raw_open}${novy}${(blok as YamlBlok).raw_close}`;
  blok.data = y.data;
  blok.chyba = false;
  delete blok.sprava;
  preindexuj(doc);
}

// ------------------------------------------------------------------------------------------------ úroveň 1

const PLAIN_SAFE = /^[A-Za-z0-9_][A-Za-z0-9_ .\-/()+]*$/;
const BOOL_LIKE = new Set(["true", "false", "yes", "no", "null", "~", "on", "off"]);
const PY_FLOAT = /^\s*[+-]?(?:(?:\d(?:_?\d)*)(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?\s*$|^\s*[+-]?(?:inf|infinity|nan)\s*$/i;

/** `_skalar_text`: skalár so zachovaním pôvodných úvodzoviek, kde sa dá. */
export function skalarText(v: unknown, styl: string | null): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  const s = String(v);
  if (styl === "'") return `'${s.replace(/'/g, "''")}'`;
  if (styl === '"' || s.includes("[[") || !PLAIN_SAFE.test(s) || BOOL_LIKE.has(s.toLowerCase()) || PY_FLOAT.test(s)) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

/** `_rozdel_hodnotu`: `hodnota   # komentár` -> (hodnota, zvyšok s komentárom). */
export function rozdelHodnotu(t: string): [string, string] {
  if (t.startsWith("'") || t.startsWith('"')) {
    const q = t[0];
    let i = 1;
    while (i < t.length) {
      if (q === '"' && t[i] === "\\") {
        i += 2;
        continue;
      }
      if (t[i] === q) {
        if (q === "'" && t.slice(i + 1, i + 2) === "'") {
          i += 2;
          continue;
        }
        return [t.slice(0, i + 1), t.slice(i + 1)];
      }
      i += 1;
    }
    return [t, ""];
  }
  const m = /\s+#/.exec(t);
  if (m) return [t.slice(0, m.index), t.slice(m.index)];
  const r = t.replace(/\s+$/, "");
  return [r, t.slice(r.length)];
}

/** `_jednoriadkovy`: skalár na riadku nepokračuje na ďalšom (blokový / zložený skalár). */
function jednoriadkovy(text: string, line: number): boolean {
  const ls = riadky(text);
  const s = ls[line];
  if (/(?:\||>|\|-|>-|\|\+|>\+)$/.test(s.replace(/\s+$/, ""))) return false;
  if (line + 1 < ls.length) {
    const nxt = ls[line + 1];
    if (strip(nxt) && !lstrip(nxt).startsWith("#") && odsadenie(nxt) > odsadenie(s) && !nxt.split("#")[0].includes(":") && !lstrip(nxt).startsWith("- ")) return false;
  }
  return true;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function level1(doc: Dokument, blok: YB, line: number, k: string | number, hodnota: unknown, cesta: Cesta) {
  const lines = splitlines(blok.yaml_text);
  const s = lines[line];
  const body = bezKonca(s);
  const nl = s.slice(body.length);
  const m = typeof k === "number" ? /^(\s*- )([^]*)$/.exec(body) : new RegExp(`^(\\s*${escapeRe(String(k))}:)([ \\t]*)([^]*)$`).exec(body);
  if (!m) {
    level2(doc, blok, cesta, hodnota);
    return;
  }
  const pre = m[1];
  let medzera = typeof k === "number" ? "" : m[2];
  const zvysok = typeof k === "number" ? m[2] : m[3];
  const [staraHodnota, zk] = rozdelHodnotu(zvysok);
  let zvysokKomentar = zk;
  const styl = staraHodnota[0] === "'" || staraHodnota[0] === '"' ? staraHodnota[0] : null;
  const novy = skalarText(hodnota, styl);
  if (!medzera && novy && typeof k !== "number") medzera = " ";
  if (!novy) {
    medzera = "";
    zvysokKomentar = lstrip(zvysokKomentar) ? ` ${lstrip(zvysokKomentar)}` : "";
  } else if (strip(zvysokKomentar)) {
    const stlpec = pre.length + medzera.length + staraHodnota.length + (zvysokKomentar.length - lstrip(zvysokKomentar).length);
    const vypln = Math.max(1, stlpec - pre.length - medzera.length - novy.length);
    zvysokKomentar = " ".repeat(vypln) + lstrip(zvysokKomentar);
  }
  lines[line] = pre + medzera + novy + zvysokKomentar + nl;
  nahradYamlText(doc, blok, lines.join(""));
}

// ------------------------------------------------------------------------------------------------ úroveň 1b

/** `_hranice_zoznamu`: (odsadenie pomlčky, prvý riadok každej položky, koniec) blokového zoznamu. */
function hraniceZoznamu(text: string, cesta: Cesta): [number, number[], number] | null {
  const { doc, lc } = rt(text);
  const seq = doc.getIn(cesta as (string | number)[], true) as unknown;
  if (!isSeq(seq) || seq.items.length === 0 || seq.flow) return null;
  const lines = riadky(text);
  const zaciatky: number[] = [];
  for (const item of seq.items as YamlNode[]) {
    const r = item?.range;
    if (!r) return null;
    const l = lc.linePos(r[0]).line - 1;
    if (l >= lines.length || !lstrip(lines[l]).startsWith("- ")) return null;
    if (zaciatky.length && l <= zaciatky[zaciatky.length - 1]) return null;
    zaciatky.push(l);
  }
  const ods = odsadenie(lines[zaciatky[0]]);
  if (zaciatky.some((r) => odsadenie(lines[r]) !== ods)) return null;
  let koniec = zaciatky[zaciatky.length - 1] + 1;
  while (koniec < lines.length) {
    const s = lines[koniec];
    if (strip(s) && !lstrip(s).startsWith("#") && odsadenie(s) <= ods) break;
    koniec += 1;
  }
  while (koniec - 1 > zaciatky[zaciatky.length - 1] && (!strip(lines[koniec - 1]) || (lstrip(lines[koniec - 1]).startsWith("#") && odsadenie(lines[koniec - 1]) <= ods))) koniec -= 1;
  return [ods, zaciatky, koniec];
}

function rozdielZoznamu(stare: unknown[], nove: unknown[]): ["vloz" | "zmaz", number, number] | null {
  let p = 0;
  while (p < stare.length && p < nove.length && rovnake(stare[p], nove[p])) p += 1;
  let s = 0;
  while (s < stare.length - p && s < nove.length - p && rovnake(stare[stare.length - 1 - s], nove[nove.length - 1 - s])) s += 1;
  const ss = stare.length - s - p;
  const ns = nove.length - s - p;
  if (ss === 0 && ns > 0) return ["vloz", p, ns];
  if (ns === 0 && ss > 0) return ["zmaz", p, ss];
  return null;
}

function dumpPolozky(polozky: unknown[], ods: number): string {
  const text = dumpZoznam(polozky);
  const lines = splitlines(text);
  const posun = ods - odsadenie(lines[0]);
  if (posun > 0) return lines.map((r) => (strip(r) ? " ".repeat(posun) + r : r)).join("");
  if (posun < 0) {
    if (lines.some((r) => strip(r) && odsadenie(r) < -posun)) return text;
    return lines.map((r) => (strip(r) ? r.slice(-posun) : r)).join("");
  }
  return text;
}

function level1b(doc: Dokument, blok: YB, cesta: Cesta, stare: unknown[], hodnota: unknown[]): boolean {
  const hranice = hraniceZoznamu(blok.yaml_text, cesta);
  const zmena = rozdielZoznamu(stare.map(plain), hodnota.map(plain));
  if (!hranice || !zmena) return false;
  const [ods, zaciatky, koniec] = hranice;
  const [druh, i, pocet] = zmena;
  const lines = splitlines(blok.yaml_text);
  const hranica = [...zaciatky, koniec];
  const novy =
    druh === "vloz"
      ? lines.slice(0, hranica[i]).join("") + dumpPolozky(hodnota.slice(i, i + pocet), ods) + lines.slice(hranica[i]).join("")
      : lines.slice(0, hranica[i]).join("") + lines.slice(hranica[i + pocet]).join("");
  const kontrola = nacitajYaml(novy);
  if (kontrola.chyba) return false;
  const po = riadokKluca(novy, cesta);
  if (!(isMap(po.parent) || isSeq(po.parent)) || !po.ma || !rovnake(po.stare, plain(hodnota))) return false;
  nahradYamlText(doc, blok, novy);
  return true;
}

// ------------------------------------------------------------------------------------------------ úroveň 2

/** `_segment`: [start, end) riadkov kľúča najvyššej úrovne; koncové prázdne a komentárové riadky ostávajú mimo. */
function segment(text: string, k: string): [number, number] {
  const { doc, lc } = rt(text);
  const lines = splitlines(text);
  const m = doc.contents as YAMLMap;
  const pary = m.items as Pair[];
  const i = pary.findIndex((p) => kluc(p) === k);
  const start = lc.linePos((pary[i].key as YamlNode).range![0]).line - 1;
  let end = i + 1 < pary.length ? lc.linePos((pary[i + 1].key as YamlNode).range![0]).line - 1 : lines.length;
  while (end - 1 > start && (!strip(lines[end - 1]) || lstrip(lines[end - 1]).startsWith("#"))) end -= 1;
  return [start, end];
}

/** Koncové prázdne a komentárové riadky výpisu patria oblasti mimo segmentu. */
function orezKoniec(text: string): string {
  const out = splitlines(text);
  while (out.length && (!strip(out[out.length - 1]) || lstrip(out[out.length - 1]).startsWith("#"))) out.pop();
  return out.join("");
}

/** Komentár na konci riadku (mimo úvodzoviek) -> [obsah, medzera, komentár]. */
function eolKomentar(line: string): [string, string, string] | null {
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (q === '"' && c === "\\") i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === "#" && i > 0 && /\s/.test(line[i - 1])) {
      const obsah = line.slice(0, i).replace(/\s+$/, "");
      if (!strip(obsah)) return null;
      return [obsah, line.slice(obsah.length, i), line.slice(i)];
    }
  }
  return null;
}

const OPTS = { indent: 2, indentSeq: true, lineWidth: 0, minContentWidth: 0, flowCollectionPadding: false, singleQuote: true } as const;

/** Nová hodnota ako uzol so štýlom `_do_ruamel`: `[[` v dvojitých úvodzovkách, zoznam skalárov vo flow. */
function uzol(d: Document, v: unknown): unknown {
  const n = d.createNode(v);
  const styl = (x: unknown) => {
    if (isScalar(x) && typeof x.value === "string" && x.value.includes("[[")) x.type = Scalar.QUOTE_DOUBLE;
    if (isSeq(x)) {
      x.flow = x.items.every((i) => isScalar(i));
      x.items.forEach(styl);
    }
    if (isMap(x)) (x.items as Pair[]).forEach((p) => styl(p.value));
  };
  styl(n);
  return n;
}

/**
 * Úroveň 2 (`_nastav_v_mape` + `_prepis_segment`): hodnota na ceste sa nahradí a segment kľúča najvyššej úrovne sa
 * vypíše znova. Celý kľúč = čerstvý výpis ako ruamel; hlbšia cesta = pôvodné uzly segmentu ostávajú (komentáre,
 * úvodzovky, flow) a stĺpec komentára na konci riadku sa vráti na pôvodný.
 */
function level2(doc: Dokument, blok: YB, cesta: Cesta, hodnota: unknown) {
  const top = String(cesta[0]);
  const lines = splitlines(blok.yaml_text);
  const [start, end] = segment(blok.yaml_text, top);
  let novy: string;
  if (cesta.length === 1) novy = orezKoniec(dumpYaml({ [top]: hodnota }));
  else {
    const { doc: d } = rt(blok.yaml_text);
    let cur: unknown = d.contents;
    for (const k of cesta.slice(0, -1)) {
      if (isMap(cur) && najdiPar(cur, k)) cur = najdiPar(cur, k)!.value;
      else if (isSeq(cur) && typeof k === "number" && k < cur.items.length) cur = cur.items[k];
      else throw new ChybaZapisu(`cesta ${cesta.join("/")} v YAML neexistuje`);
    }
    d.setIn(cesta as (string | number)[], uzol(d, hodnota));
    const par = najdiPar(d.contents as YAMLMap, top)!;
    const key = par.key as YamlNode & { commentBefore?: string; spaceBefore?: boolean };
    key.commentBefore = undefined;
    key.spaceBefore = false;
    const tmp = new Document();
    const m = new YAMLMap();
    m.items.push(par);
    tmp.contents = m;
    novy = orezKoniec(tmp.toString(OPTS));
    const povodne = new Map<string, string>();
    for (const l of lines.slice(start, end)) {
      const e = eolKomentar(bezKonca(l));
      if (e) povodne.set(`${e[0]}\u0000${e[2]}`, e[1]);
    }
    novy = splitlines(novy)
      .map((l) => {
        const telo = bezKonca(l);
        const e = eolKomentar(telo);
        const medzera = e ? povodne.get(`${e[0]}\u0000${e[2]}`) : undefined;
        return e && medzera !== undefined ? e[0] + medzera + e[2] + l.slice(telo.length) : l;
      })
      .join("");
  }
  nahradYamlText(doc, blok, lines.slice(0, start).join("") + novy + lines.slice(end).join(""));
}

/** `_pridaj_top_kluc`: nový kľúč najvyššej úrovne za `za`, inak na koniec. */
function pridajTopKluc(doc: Dokument, blok: YB, k: string, hodnota: unknown, za: string | null = null): number {
  const lines = splitlines(blok.yaml_text);
  let poz = lines.length;
  if (za !== null && blok.data && za in blok.data) {
    let [, end] = segment(blok.yaml_text, za);
    while (end < lines.length && lstrip(lines[end]).startsWith("#")) end += 1;
    poz = end;
  }
  let novy = dumpYaml({ [k]: hodnota });
  if (lines.length && poz === lines.length && !lines[lines.length - 1].endsWith("\n")) novy = `\n${novy}`;
  nahradYamlText(doc, blok, lines.slice(0, poz).join("") + novy + lines.slice(poz).join(""));
  return 2;
}

/** `nastav_yaml`: hodnota vnútri YAML bloku; vráti použitú úroveň (1 alebo 2). */
export function nastavYaml(doc: Dokument, blok: YB, cesta: Cesta, hodnota: unknown): number {
  const data = blok.data ?? {};
  const top = String(cesta[0]);
  if (!(top in data)) {
    if (cesta.length !== 1) throw new ChybaZapisu(`nadradený kľúč '${top}' neexistuje`);
    return pridajTopKluc(doc, blok, top, hodnota);
  }
  const p = riadokKluca(blok.yaml_text, cesta);
  const stare = isMap(p.parent) || isSeq(p.parent) ? (p.ma ? p.stare : null) : null;
  if (p.line !== null && jeSkalar(hodnota) && jeSkalar(stare) && jednoriadkovy(blok.yaml_text, p.line)) {
    level1(doc, blok, p.line, p.k, hodnota, cesta);
    return 1;
  }
  if (Array.isArray(hodnota) && p.stareJeBlokovyZoznam && Array.isArray(stare) && level1b(doc, blok, cesta, stare, hodnota)) return 1;
  level2(doc, blok, cesta, hodnota);
  return 2;
}

export function odstranYaml(doc: Dokument, blok: YB, k: string) {
  if (!blok.data || !(k in blok.data)) return;
  const lines = splitlines(blok.yaml_text);
  const [start, end] = segment(blok.yaml_text, k);
  nahradYamlText(doc, blok, lines.slice(0, start).join("") + lines.slice(end).join(""));
}

/** `nastav_frontmatter`: nový kľúč ide za najbližší predchádzajúci kľúč z `poradie` (poradie schémy). */
export function nastavFrontmatter(doc: Dokument, cesta: Cesta, hodnota: unknown, poradie: string[] = []): number {
  const fm = doc.frontmatter;
  if (!fm) throw new ChybaZapisu("dokument nemá frontmatter");
  const top = String(cesta[0]);
  if (!(fm.data && top in fm.data) && cesta.length === 1 && poradie.length) {
    let za: string | null = null;
    const i = poradie.indexOf(top);
    if (i >= 0) {
      for (const k of poradie.slice(0, i).reverse()) {
        if (fm.data && k in fm.data) {
          za = k;
          break;
        }
      }
    }
    return pridajTopKluc(doc, fm, top, hodnota, za);
  }
  return nastavYaml(doc, fm, cesta, hodnota);
}

export function odstranFrontmatter(doc: Dokument, k: string) {
  if (doc.frontmatter) odstranYaml(doc, doc.frontmatter, k);
}

// ------------------------------------------------------------------------------------------------ úroveň 3: inline

const inlineText = (h: unknown[]) => h.map((x) => String(x)).join(", ");
const najdiSekciu = (doc: Dokument, sekcia: string) => doc.telo.findIndex((b) => b.druh === "Nadpis" && b.text === sekcia);

function koniecSekcie(doc: Dokument, iNadpis: number): number {
  const u = (doc.telo[iNadpis] as Nadpis).uroven;
  let j = iNadpis + 1;
  while (j < doc.telo.length && !(doc.telo[j].druh === "Nadpis" && (doc.telo[j] as Nadpis).uroven <= u)) j += 1;
  return j;
}

const proza = (raw: string): Proza => ({ druh: "Proza", raw, riadok: 0 });

function zabezpecPrazdnyRiadokPred(doc: Dokument, poz: number) {
  if (poz === 0) {
    if (doc.frontmatter) doc.telo.splice(0, 0, proza("\n"));
    return;
  }
  const prev = doc.telo[poz - 1];
  if (!prev.raw.endsWith("\n")) prev.raw += "\n";
  if (!prev.raw.endsWith("\n\n")) doc.telo.splice(poz, 0, proza("\n"));
}

export function pridajSekciu(doc: Dokument, sekcia: string, sekcieTypu: string[], uroven = 2): number {
  const i = najdiSekciu(doc, sekcia);
  if (i >= 0) return i;
  let poz = doc.telo.length;
  const si = sekcieTypu.indexOf(sekcia);
  if (si >= 0) {
    let najdene = false;
    for (const prev of sekcieTypu.slice(0, si).reverse()) {
      const pi = najdiSekciu(doc, prev);
      if (pi >= 0) {
        poz = koniecSekcie(doc, pi);
        najdene = true;
        break;
      }
    }
    if (!najdene) {
      for (const nxt of sekcieTypu.slice(si + 1)) {
        const ni = najdiSekciu(doc, nxt);
        if (ni >= 0) {
          poz = ni;
          break;
        }
      }
    }
  }
  zabezpecPrazdnyRiadokPred(doc, poz);
  // ako Python: nadpis ide na `poz` (pred prípadný práve vložený prázdny riadok)
  const n: Nadpis = { druh: "Nadpis", raw: `${"#".repeat(uroven)} ${sekcia}\n`, riadok: 0, uroven, text: sekcia };
  doc.telo.splice(poz, 0, n);
  if (poz + 1 < doc.telo.length && doc.telo[poz + 1].druh !== "Proza") doc.telo.splice(poz + 1, 0, proza("\n"));
  preindexuj(doc);
  return poz;
}

function rozdelKoncovyPrazdny(doc: Dokument, poz: number): number {
  if (poz > 0 && doc.telo[poz - 1].druh === "Proza") {
    const prev = doc.telo[poz - 1];
    if (prev.raw.endsWith("\n\n") && strip(prev.raw)) {
      const body = `${prev.raw.replace(/\n+$/, "")}\n`;
      const rest = prev.raw.slice(body.length);
      prev.raw = body;
      doc.telo.splice(poz, 0, proza(rest));
    }
  }
  return poz;
}

const inlinePole = (k: string, raw: string, hodnota: string, vPolozke: boolean): InlinePole => ({ druh: "InlinePole", raw, riadok: 0, kluc: k, raw_hodnota: hodnota, v_polozke: vPolozke });

/** `nastav_inline`: existujúce riadky sa prepíšu na mieste (len text za `:: `). */
export function nastavInline(doc: Dokument, k: string, hodnoty: unknown, sekcia: string, sekcieTypu: string[] = [], vPolozke: boolean | null = null) {
  const h = Array.isArray(hodnoty) ? hodnoty : hodnoty === null || hodnoty === undefined ? [] : [hodnoty];
  const existujuce = doc.telo.map((b, i) => (b.druh === "InlinePole" && b.kluc === k ? i : -1)).filter((i) => i >= 0);
  if (existujuce.length) {
    const prvy = doc.telo[existujuce[0]] as InlinePole;
    const stylPolozka = vPolozke === null ? prvy.v_polozke : vPolozke;
    if (stylPolozka) {
      const nove = h.map((x) => inlinePole(k, `- ${k}:: ${String(x)}\n`, String(x), true));
      for (const i of [...existujuce].reverse()) doc.telo.splice(i, 1);
      doc.telo.splice(existujuce[0], 0, ...nove);
    } else {
      const text = inlineText(h);
      prvy.raw_hodnota = text;
      prvy.raw = `${k}::${text ? ` ${text}` : ""}\n`;
      for (const i of existujuce.slice(1).reverse()) doc.telo.splice(i, 1);
    }
    preindexuj(doc);
    return;
  }
  const i = pridajSekciu(doc, sekcia, sekcieTypu);
  const koniec = koniecSekcie(doc, i);
  let poz = i + 1;
  for (let j = i + 1; j < koniec; j++) if (!(doc.telo[j].druh === "Proza" && !strip(doc.telo[j].raw))) poz = j + 1;
  poz = rozdelKoncovyPrazdny(doc, poz);
  const nove = vPolozke
    ? h.map((x) => inlinePole(k, `- ${k}:: ${String(x)}\n`, String(x), true))
    : [inlinePole(k, `${k}::${inlineText(h) ? ` ${inlineText(h)}` : ""}\n`, inlineText(h), false)];
  doc.telo.splice(poz, 0, ...nove);
  preindexuj(doc);
}

export function odstranInline(doc: Dokument, k: string) {
  doc.telo = doc.telo.filter((b) => !(b.druh === "InlinePole" && b.kluc === k));
  preindexuj(doc);
}

// ------------------------------------------------------------------------------------------------ úroveň 4: bloky, pod-záznamy, poznámky

function yamlBlok(data: Obj): YamlBlok {
  const text = dumpYaml(data);
  const y = nacitajYaml(text);
  return { druh: "YamlBlok", raw: "```yaml\n" + text + "```\n", riadok: 0, jazyk: "yaml", raw_open: "```yaml\n", yaml_text: text, raw_close: "```\n", data: y.data, chyba: false };
}

function vlozBlok(doc: Dokument, poz: number, blok: YamlBlok) {
  if (poz < doc.telo.length && doc.telo[poz].druh === "Nadpis") {
    const prev = poz > 0 ? doc.telo[poz - 1] : null;
    if (prev && prev.druh === "Proza" && !strip(prev.raw)) {
      doc.telo.splice(poz - 1, 0, blok);
      preindexuj(doc);
      return;
    }
    doc.telo.splice(poz, 0, blok, proza("\n"));
  } else doc.telo.splice(poz, 0, blok);
  preindexuj(doc);
}

/** `nastav_blokove_pole`: YAML blok s jediným kľúčom `k` (celý segment sa vypíše znova). */
export function nastavBlokovePole(doc: Dokument, k: string, hodnota: unknown, sekcia: string, sekcieTypu: string[] = []) {
  for (const b of doc.telo) {
    if (b.druh === "YamlBlok" && !b.chyba && b.data && rovnake(Object.keys(b.data), [k])) {
      level2(doc, b, [k], hodnota);
      return;
    }
  }
  const i = pridajSekciu(doc, sekcia, sekcieTypu);
  vlozBlok(doc, koniecSekcie(doc, i), yamlBlok({ [k]: hodnota }));
}

export function pridajPodZaznam(doc: Dokument, id: string, nazov: string, data: Obj, uroven = 2) {
  const d: Obj = { id, ...Object.fromEntries(Object.entries(data).filter(([k]) => k !== "id")) };
  zabezpecPrazdnyRiadokPred(doc, doc.telo.length);
  doc.telo.push({ druh: "Nadpis", raw: `${"#".repeat(uroven)} ${id} ${nazov}\n`, riadok: 0, uroven, text: `${id} ${nazov}` }, yamlBlok(d));
  preindexuj(doc);
}

/** `nastav_pod_zaznam`: hodnota v YAML bloku pod-záznamu `id`. */
export function nastavPodZaznam(doc: Dokument, id: string, cesta: Cesta, hodnota: unknown): number {
  let nadpis: Nadpis | null = null;
  for (const b of doc.telo) {
    if (b.druh === "Nadpis") nadpis = b;
    else if (nadpis && nadpis.text.split(" ")[0] === id && b.druh === "YamlBlok" && !b.chyba && b.data && b.data.id === id) return nastavYaml(doc, b, cesta, hodnota);
  }
  throw new ChybaZapisu(`pod-záznam '${id}' sa nenašiel`);
}

/** Metadáta poľa pre šablónu novej poznámky (z JSON Schema modelu, poradie polí pydantic). */
export interface PoleSablony {
  kluc: string;
  zdroj: string;
  sekcia: string;
  odvodene: boolean;
  povinne: boolean;
  /** `default` v schéme (undefined = žiadny). */
  predvolene: unknown;
  zoznam: boolean;
}

/** `nova_poznamka`: frontmatter v poradí schémy, telo = sekcie typu s inline a blokovými poľami. */
export function novaPoznamka(typ: string, sekcie: string[], polia: PoleSablony[], vstup: Obj): Dokument {
  const data: Obj = { ...vstup };
  if (!("typ" in data)) data.typ = typ;
  if (!("aliases" in data)) data.aliases = [data.id ?? null];
  const fm: Obj = {};
  const inline: Array<[string, string, unknown]> = [];
  const blok: Array<[string, string, unknown]> = [];
  for (const f of polia) {
    if (f.odvodene) continue;
    const pritomne = f.kluc in data;
    if (f.zdroj === "frontmatter") {
      if (pritomne) fm[f.kluc] = data[f.kluc];
      else if (f.povinne || f.predvolene === null) fm[f.kluc] = f.zoznam ? [] : null;
      else fm[f.kluc] = JSON.parse(JSON.stringify(f.predvolene ?? null));
    } else if (f.zdroj === "inline" && pritomne) inline.push([f.kluc, f.sekcia, data[f.kluc]]);
    else if (f.zdroj === "blok" && pritomne) blok.push([f.kluc, f.sekcia, data[f.kluc]]);
  }
  let text = `---\n${dumpYaml(fm)}---\n`;
  for (const s of sekcie) {
    text += `\n## ${s}\n`;
    for (const [k, sek, v] of inline) if (sek === s) text += `${k}:: ${inlineText(Array.isArray(v) ? v : [v])}\n`;
    for (const [k, sek, v] of blok) if (sek === s) text += "```yaml\n" + dumpYaml({ [k]: v }) + "```\n";
  }
  return parsuj(text);
}

// ------------------------------------------------------------------------------------------------ úroveň 5: aliases

/** `zabezpec_aliases`: `aliases` obsahuje `id` (cudzie aliasy sa nikdy nemažú). */
export function zabezpecAliases(doc: Dokument, id: string): boolean {
  const fm = doc.frontmatter;
  if (!fm || fm.chyba || !fm.data) return false;
  if ("aliases" in fm.data) {
    const cur = fm.data.aliases;
    if (cur === null || cur === undefined) {
      nastavYaml(doc, fm, ["aliases"], [id]);
      return true;
    }
    if (typeof cur === "string") {
      if (cur === id) return false;
      nastavYaml(doc, fm, ["aliases"], [cur, id]);
      return true;
    }
    const zoznam = Array.isArray(cur) ? cur : [];
    if (zoznam.includes(id)) return false;
    level2(doc, fm, ["aliases"], [...zoznam, id]);
    return true;
  }
  pridajTopKluc(doc, fm, "aliases", [id], "id" in fm.data ? "id" : null);
  return true;
}

// ------------------------------------------------------------------------------------------------ próza (V29, Q64 d)

const telo = (b: Blok) => `${b.druh}\u0000${b.raw}`;

/** `nastav_prozu`: text jedného bloku prózy; próza nesmie zmeniť štruktúru poznámky. */
export function nastavProzu(doc: Dokument, index: number, text: string) {
  if (index < 0 || index >= doc.telo.length || doc.telo[index].druh !== "Proza") throw new ChybaZapisu(`blok ${index} nie je próza`);
  const blok = doc.telo[index];
  const raw = blok.raw;
  const zaciatok = raw.slice(0, raw.length - raw.replace(/^\s+/, "").length);
  const koniec = raw.slice(raw.replace(/\s+$/, "").length);
  let novy = strip(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  if (raw.includes("\r\n")) novy = novy.replace(/\n/g, "\r\n");
  blok.raw = novy ? zaciatok + novy + koniec : koniec || zaciatok;
  const pred = doc.telo.filter((b) => b.druh !== "Proza").map(telo);
  const poDoc = parsuj(serializuj(doc));
  const po = poDoc.telo.filter((b) => b.druh !== "Proza").map(telo);
  if (!rovnake(po, pred) || (poDoc.frontmatter === null) !== (doc.frontmatter === null)) {
    blok.raw = raw;
    throw new ChybaZapisu("próza nesmie obsahovať nadpis (#), pole `kluc::`, blok ``` , HTML komentár ani ---; polia sa menia vo formulári");
  }
}
