/**
 * Blokový model poznámky knižnice požiadaviek (port `assetin/engine/dokument.py`, krok 1, assetin-library V30).
 *
 * Bajtovo verný: `serializuj(parsuj(text)) === text` pre ľubovoľný vstup (princíp 7 knižnice). Do súboru sa
 * zapisuje len táto vrstva; typovaná poznámka (krok 2, zod) sa nikdy neserializuje priamo.
 *
 * Správanie kopíruje Python (orákulum do konca portu, korpus `library/korpus/stromy/<s>/bloky.json`):
 * - riadky ako `str.splitlines(keepends=True)` (aj `\r`, `\v`, `\f`, `\x1c`-`\x1e`, `\x85`, `\u2028`, `\u2029`);
 * - `rstrip("\r\n")`, `lstrip()` a `\s` / `\w` s množinami Pythonu (`str.isspace`, Unicode písmená a čísla), nie JS;
 * - YAML len na čítanie (`data`, `chyba`); text bloku sa nikdy neprepisuje z dát.
 */

import { load as yamlLoad } from "js-yaml";

export type Druh = "Nadpis" | "InlinePole" | "YamlBlok" | "SurovyBlok" | "HtmlKomentar" | "Proza";

export interface Frontmatter {
  raw: string;
  /** 0-based index prvého riadku (vždy 0). */
  riadok: number;
  yaml_text: string;
  /** Dáta YAML ako čisté JSON hodnoty; null pri chybe. */
  data: Record<string, unknown> | null;
  chyba: boolean;
  /** Text chyby parsera YAML (informatívny, nezhoduje sa s ruamel). */
  sprava?: string;
}

interface Zaklad {
  raw: string;
  riadok: number;
}

export interface Nadpis extends Zaklad {
  druh: "Nadpis";
  uroven: number;
  text: string;
}
export interface InlinePole extends Zaklad {
  druh: "InlinePole";
  kluc: string;
  raw_hodnota: string;
  v_polozke: boolean;
}
export interface YamlBlok extends Zaklad {
  druh: "YamlBlok";
  jazyk: string;
  raw_open: string;
  yaml_text: string;
  raw_close: string;
  data: Record<string, unknown> | null;
  chyba: boolean;
  sprava?: string;
}
export interface SurovyBlok extends Zaklad {
  druh: "SurovyBlok";
  jazyk: string;
}
export interface HtmlKomentar extends Zaklad {
  druh: "HtmlKomentar";
}
export interface Proza extends Zaklad {
  druh: "Proza";
}

export type Blok = Nadpis | InlinePole | YamlBlok | SurovyBlok | HtmlKomentar | Proza;

export interface Dokument {
  frontmatter: Frontmatter | null;
  telo: Blok[];
}

// ------------------------------------------------------------------------------------------------ Python kompatibilita

/** Znaky `str.isspace()` (Python `\s` v Unicode režime). */
const PY_WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
/** Python `\w` (Unicode): písmená, čísla a podčiarkovník. */
const PY_W = "\\p{L}\\p{N}_";

const INLINE_RE = new RegExp(`^(- )?([a-z_][a-z0-9_.]*)::[ \\t]*([^]*?)[${PY_WS}]*$`, "u");
const NADPIS_RE = new RegExp(`^(#{1,6}) ([^]*?)[${PY_WS}]*$`, "u");
const FENCE_RE = new RegExp(`^\`\`\`([${PY_W}-]*)[${PY_WS}]*$`, "u");
const LSTRIP_RE = new RegExp(`^[${PY_WS}]+`, "u");
/** Hranice riadkov `str.splitlines`. */
const LINE_RE = /[^\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]*(?:\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029])?/gu;

/** `str.splitlines(keepends=True)`. */
export function splitlines(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(LINE_RE)) {
    if (m[0] === "") break;
    out.push(m[0]);
  }
  return out;
}

/** `s.rstrip("\r\n")`. */
const rstripNl = (s: string) => s.replace(/[\r\n]+$/, "");
const lstrip = (s: string) => s.replace(LSTRIP_RE, "");

// ------------------------------------------------------------------------------------------------ YAML (len čítanie)

/** `na_plain` z Pythonu: dátum ako `YYYY-MM-DD` (json `default=str`), čas ako `YYYY-MM-DD HH:MM:SS[.ffffff][+zz:zz]`. */
function naPlain(v: unknown): unknown {
  if (v instanceof Date) {
    const iso = v.toISOString();
    if (iso.endsWith("T00:00:00.000Z")) return iso.slice(0, 10);
    return iso.replace("T", " ").replace(/\.000Z$/, "").replace(/Z$/, "");
  }
  if (Array.isArray(v)) return v.map(naPlain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, naPlain(x)]));
  return v;
}

/** YAML mapa ako čisté dáta; prázdny text = `{}`, iný koreň než mapa je chyba (ako `_nacitaj_yaml`). */
export function nacitajYaml(text: string): { data: Record<string, unknown> | null; chyba: boolean; sprava?: string } {
  try {
    const data = yamlLoad(text);
    if (data === null || data === undefined) return { data: {}, chyba: false };
    if (typeof data !== "object" || Array.isArray(data) || data instanceof Date) {
      return { data: null, chyba: true, sprava: `očakávaná YAML mapa, je ${Array.isArray(data) ? "zoznam" : typeof data}` };
    }
    return { data: naPlain(data) as Record<string, unknown>, chyba: false };
  } catch (e) {
    return { data: null, chyba: true, sprava: e instanceof Error ? e.message : String(e) };
  }
}

// ------------------------------------------------------------------------------------------------ parser

export function parsuj(text: string): Dokument {
  const lines = splitlines(text);
  let i = 0;
  let frontmatter: Frontmatter | null = null;

  if (lines.length > 0 && rstripNl(lines[0]) === "---") {
    let j = 1;
    while (j < lines.length && rstripNl(lines[j]) !== "---") j++;
    if (j < lines.length) {
      const yaml_text = lines.slice(1, j).join("");
      const y = nacitajYaml(yaml_text);
      frontmatter = { raw: lines.slice(0, j + 1).join(""), riadok: 0, yaml_text, data: y.data, chyba: y.chyba, ...(y.sprava ? { sprava: y.sprava } : {}) };
      i = j + 1;
    }
  }

  const telo: Blok[] = [];
  let proza: string[] = [];
  let prozaStart = i;
  const flush = () => {
    if (proza.length > 0) {
      telo.push({ druh: "Proza", raw: proza.join(""), riadok: prozaStart });
      proza = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const s = rstripNl(line);
    let m = FENCE_RE.exec(s);
    if (m) {
      flush();
      const jazyk = m[1];
      let j = i + 1;
      while (j < lines.length && !rstripNl(lines[j]).startsWith("```")) j++;
      const body = lines.slice(i + 1, j).join("");
      const close = j < lines.length ? lines[j] : "";
      const raw = line + body + close;
      if (jazyk === "yaml") {
        const y = nacitajYaml(body);
        telo.push({ druh: "YamlBlok", raw, riadok: i, jazyk: "yaml", raw_open: line, yaml_text: body, raw_close: close, data: y.data, chyba: y.chyba, ...(y.sprava ? { sprava: y.sprava } : {}) });
      } else {
        telo.push({ druh: "SurovyBlok", raw, riadok: i, jazyk });
      }
      i = j + 1;
      prozaStart = i;
      continue;
    }
    if (lstrip(s).startsWith("<!--")) {
      flush();
      let j = i;
      while (j < lines.length && !lines[j].includes("-->")) j++;
      telo.push({ druh: "HtmlKomentar", raw: lines.slice(i, j + 1).join(""), riadok: i });
      i = j + 1;
      prozaStart = i;
      continue;
    }
    m = NADPIS_RE.exec(s);
    if (m) {
      flush();
      telo.push({ druh: "Nadpis", raw: line, riadok: i, uroven: m[1].length, text: m[2] });
      i += 1;
      prozaStart = i;
      continue;
    }
    m = INLINE_RE.exec(s);
    if (m) {
      flush();
      telo.push({ druh: "InlinePole", raw: line, riadok: i, kluc: m[2], raw_hodnota: m[3], v_polozke: !!m[1] });
      i += 1;
      prozaStart = i;
      continue;
    }
    if (proza.length === 0) prozaStart = i;
    proza.push(line);
    i += 1;
  }
  flush();
  return { frontmatter, telo };
}

/** Spojenie `raw` všetkých blokov = vstupný text (bajtovo). */
export function serializuj(doc: Dokument): string {
  return (doc.frontmatter ? doc.frontmatter.raw : "") + doc.telo.map((b) => b.raw).join("");
}

/** Prepočet `riadok` po štrukturálnej úprave (`preindexuj` v Pythone). */
export function preindexuj(doc: Dokument): void {
  let line = 0;
  for (const b of [...(doc.frontmatter ? [doc.frontmatter] : []), ...doc.telo]) {
    b.riadok = line;
    line += b.raw.split("\n").length - 1;
  }
}

/** Tvar `bloky.json` korpusu (bez informatívneho `sprava`). */
export function blokyJson(text: string): { frontmatter: Omit<Frontmatter, "sprava"> | null; telo: Array<Record<string, unknown>> } {
  const d = parsuj(text);
  const strip = <T extends { sprava?: string }>(o: T) => {
    const { sprava, ...rest } = o;
    void sprava;
    return rest;
  };
  return { frontmatter: d.frontmatter ? strip(d.frontmatter) : null, telo: d.telo.map((b) => ("sprava" in b ? strip(b) : b) as Record<string, unknown>) };
}
