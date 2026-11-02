/**
 * Loader knižnice požiadaviek (port `assetin/engine/loader.py`, D-186 krok 2b): text súboru -> blokový model ->
 * zlúčené dáta + pôvod poľa -> typovaná poznámka (zod). Nikdy nespadne na jednej poznámke: zbiera diagnostiky
 * a poznámku nechá "surovú".
 *
 * Výstup `poznamkaJson` má tvar `korpus/stromy/<s>/poznamky.json` (orákulum). Riadky diagnostík ráta `yaml`
 * (eemeli, ISC) z pozícií uzlov ako ruamel `lc`; text správ je informatívny (pydantic a zod sa líšia).
 */

import { createHash } from "node:crypto";

import { LineCounter, parseDocument, isMap, isSeq, isScalar, type Node as YamlNode } from "yaml";
import type { z } from "zod";

import { parsuj, type Dokument, type Nadpis, type SurovyBlok, type YamlBlok } from "./bloky";
import { ChybaCesty, rozober, type Umiestnenie } from "./cesty";
import { jsonSchema } from "./schema/jsonSchema";
import { SCHEMY } from "./schema/modely";

export type Uroven = "E" | "W" | "I";

export interface Diagnostika {
  note_id: string | null;
  json_pointer: string;
  uroven: Uroven;
  kod: string;
  sprava: string;
  subor: string | null;
  riadok: number | null;
}

export interface PodZaznam {
  druh: string;
  id: string;
  nadpis: Nadpis;
  blok: YamlBlok;
  data: Record<string, unknown>;
  model: unknown | null;
  ids_blok: SurovyBlok | null;
}

export interface Poznamka {
  rel: string;
  dokument: Dokument;
  umiestnenie: Umiestnenie | null;
  data: Record<string, unknown>;
  model: Record<string, unknown> | null;
  pod_zaznamy: PodZaznam[];
  diagnostiky: Diagnostika[];
  zdroje: Record<string, string>;
  /** sha256 textu (`sklad.verzia_textu`). */
  verzia: string;
  /** inline kľúč -> riadok prvého výskytu; blokový kľúč -> riadok YAML bloku (0-based). */
  riadky: Record<string, number>;
}

// ------------------------------------------------------------------------------------------------ metadáta polí

const TYPY_POZNAMOK = ["GOAL", "UC", "ER", "IU-O", "IU-C", "STD", "PROP", "DEF", "EV", "ACT", "PROT", "PROJ"] as const;
const POD = { pravidlo: SCHEMY["pod-pravidlo"], profil: SCHEMY["pod-profil"], slovnik: SCHEMY["pod-slovnik"] } as Record<string, z.ZodType>;
const WIKILINK_PATTERN = "^\\[\\[[^\\[\\]]+\\]\\]$";

interface Pole {
  zdroj: string;
  /** Typ obsahuje WikiLink alebo tag `#aktivum` / `#proces`: inline hodnota sa delí na tokeny. */
  odkaz: boolean;
  zoznam: boolean;
}

interface Model {
  typ: string;
  schema: z.ZodType;
  polia: Map<string, Pole>;
  pod_zaznamy: string[];
}

function obsahuje(n: unknown, pred: (o: Record<string, unknown>) => boolean): boolean {
  if (Array.isArray(n)) return n.some((x) => obsahuje(x, pred));
  if (!n || typeof n !== "object") return false;
  const o = n as Record<string, unknown>;
  if (pred(o)) return true;
  return Object.entries(o).some(([k, v]) => k !== "x-assetin" && k !== "$defs" && obsahuje(v, pred));
}

const jeOdkaz = (o: Record<string, unknown>) =>
  o.pattern === WIKILINK_PATTERN || (Array.isArray(o.enum) && o.enum.length === 2 && o.enum[0] === "#aktivum" && o.enum[1] === "#proces");

/** `_je_zoznam`: typ je zoznam alebo únia so zoznamom (nie zoznam vnútri záznamu). */
function jeZoznam(n: Record<string, unknown>): boolean {
  if (n.type === "array") return true;
  return Array.isArray(n.anyOf) && (n.anyOf as Array<Record<string, unknown>>).some(jeZoznam);
}

const modely = new Map<string, Model>();
export function modelPreTyp(typ: string): Model | null {
  if (!(TYPY_POZNAMOK as readonly string[]).includes(typ)) return null;
  let m = modely.get(typ);
  if (!m) {
    const schema = SCHEMY[typ as (typeof TYPY_POZNAMOK)[number]];
    const js = jsonSchema(schema) as { properties: Record<string, Record<string, unknown>>; "x-assetin": { pod_zaznamy: string[] } };
    const polia = new Map<string, Pole>();
    for (const [k, v] of Object.entries(js.properties)) {
      const x = (v["x-assetin"] ?? {}) as { zdroj?: string };
      polia.set(k, { zdroj: x.zdroj ?? "frontmatter", odkaz: obsahuje(v, jeOdkaz), zoznam: jeZoznam(v) });
    }
    m = { typ, schema, polia, pod_zaznamy: js["x-assetin"].pod_zaznamy };
    modely.set(typ, m);
  }
  return m;
}

/** `druh_pod_zaznamu`: YAML blok s `id` podľa tvaru. */
export function druhPodZaznamu(d: Record<string, unknown>): string {
  if ("aspekty" in d) return "profil";
  if ("rozsah" in d || "plati" in d || "requirements" in d || "applicability" in d) return "pravidlo";
  return "slovnik";
}

/** `rozdel_inline`: `[[A]], [[B]], #tag` na tokeny podľa `,` mimo `[[...]]`. */
export function rozdelInline(raw: string): string[] {
  const tokens: string[] = [];
  let buf = "";
  let depth = 0;
  let i = 0;
  while (i < raw.length) {
    if (raw.startsWith("[[", i)) {
      depth += 1;
      buf += "[[";
      i += 2;
      continue;
    }
    if (raw.startsWith("]]", i)) {
      depth = Math.max(0, depth - 1);
      buf += "]]";
      i += 2;
      continue;
    }
    if (depth === 0 && raw[i] === ",") {
      tokens.push(pyStrip(buf));
      buf = "";
      i += 1;
      continue;
    }
    buf += raw[i];
    i += 1;
  }
  if (pyStrip(buf)) tokens.push(pyStrip(buf));
  return tokens.filter(Boolean);
}

const PY_WS = /^[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;
const pyStrip = (s: string) => s.replace(PY_WS, "");

// ------------------------------------------------------------------------------------------------ riadky YAML

/** `riadok_pre_pointer`: riadok (0-based, voči textu YAML) hodnoty na ceste `loc`, ako ruamel `lc`. */
export function riadokPrePointer(yamlText: string, loc: ReadonlyArray<PropertyKey>): number | null {
  const lc = new LineCounter();
  const doc = parseDocument(yamlText, { lineCounter: lc, uniqueKeys: false });
  let node: unknown = doc.contents;
  let line: number | null = null;
  for (const k of loc) {
    if (isMap(node)) {
      const pair = node.items.find((p) => (isScalar(p.key) ? String(p.key.value) : String(p.key)) === String(k));
      if (!pair) break;
      const r = (pair.key as YamlNode | null)?.range;
      if (r) line = lc.linePos(r[0]).line - 1;
      node = pair.value;
    } else if (isSeq(node) && typeof k === "number" && k < node.items.length) {
      const item = node.items[k] as YamlNode | null;
      if (item?.range) line = lc.linePos(item.range[0]).line - 1;
      node = item;
    } else break;
  }
  return line;
}

// ------------------------------------------------------------------------------------------------ chyby zod -> diagnostiky

interface Chyba {
  loc: PropertyKey[];
  kod: string;
  sprava: string;
}

/** Issue zod -> chyby v tvare pydantic `errors()`: neznámy kľúč = jedna chyba na kľúč (A5), literál/enum = A7. */
function chyby(issues: ReadonlyArray<z.core.$ZodIssue>): Chyba[] {
  const out: Chyba[] = [];
  for (const i of issues) {
    const loc = [...i.path];
    if (i.code === "unrecognized_keys") {
      for (const k of i.keys) out.push({ loc: [...loc, k], kod: "A5", sprava: "Extra inputs are not permitted" });
      continue;
    }
    out.push({ loc, kod: i.code === "invalid_value" ? "A7" : "LOAD", sprava: i.message });
  }
  return out;
}

const pointer = (loc: ReadonlyArray<PropertyKey>) => (loc.length ? `/${loc.map(String).join("/")}` : "");

// ------------------------------------------------------------------------------------------------ jedna poznámka

function idPoznamky(n: Poznamka): string | null {
  const id = n.model?.id ?? n.data.id;
  if (id) return String(id);
  return n.umiestnenie?.id ?? null;
}

function diag(n: Poznamka, uroven: Uroven, kod: string, sprava: string, ptr = "", riadok: number | null = null) {
  n.diagnostiky.push({ note_id: idPoznamky(n), json_pointer: ptr, uroven, kod, sprava, subor: n.rel, riadok });
}

const repr = (v: unknown) => (typeof v === "string" ? `'${v}'` : v === undefined || v === null ? "None" : String(v));

export function nacitajSubor(rel: string, text: string): Poznamka {
  const doc = parsuj(text);
  let umiestnenie: Umiestnenie | null = null;
  let chybaCesty: string | null = null;
  try {
    umiestnenie = rozober(rel);
  } catch (e) {
    if (!(e instanceof ChybaCesty)) throw e;
    chybaCesty = e.message;
  }
  const n: Poznamka = {
    rel,
    dokument: doc,
    umiestnenie,
    data: {},
    model: null,
    pod_zaznamy: [],
    diagnostiky: [],
    zdroje: {},
    verzia: createHash("sha256").update(text, "utf8").digest("hex"),
    riadky: {},
  };
  if (chybaCesty) diag(n, "E", "A3", `cesta nezodpovedá PathScheme: ${chybaCesty}`);

  // 1. frontmatter
  const fm = doc.frontmatter;
  if (!fm) {
    diag(n, "E", "A1", "chýba frontmatter");
    return n;
  }
  const fmYamlRiadok = fm.riadok + 1;
  if (fm.chyba || !fm.data) {
    diag(n, "E", "A1", `neplatný YAML vo frontmatter: ${(fm.sprava ?? "").split("\n")[0]}`, "", fmYamlRiadok + 1);
    return n;
  }
  const data: Record<string, unknown> = { ...fm.data };
  for (const k of Object.keys(data)) n.zdroje[k] = "frontmatter";
  n.data = data;

  const typ = (data.typ as string | undefined) || umiestnenie?.typ || null;
  const model = typ ? modelPreTyp(typ) : null;
  if (umiestnenie && data.typ && data.typ !== umiestnenie.typ) diag(n, "E", "A3", `typ ${repr(data.typ)} nesedí s priečinkom (${umiestnenie.typ})`, "/typ");
  if (!model) {
    diag(n, "E", "A5", `neznámy typ ${repr(typ)}`, "/typ");
    return n;
  }

  // 2. telo: inline polia a YAML bloky
  nacitajTelo(n, model);

  // 3. typovaný model
  const r = model.schema.safeParse(n.data);
  if (r.success) n.model = JSON.parse(JSON.stringify(r.data)) as Record<string, unknown>;
  else {
    for (const c of chyby(r.error.issues)) {
      const top = c.loc.length ? String(c.loc[0]) : "";
      let riadok: number | null = null;
      if (n.zdroje[top] === "frontmatter") {
        const rr = riadokPrePointer(fm.yaml_text, c.loc);
        riadok = rr !== null ? fmYamlRiadok + rr + 1 : null;
      } else if (top in n.riadky) riadok = n.riadky[top] + 1;
      diag(n, "E", c.kod, c.sprava, pointer(c.loc), riadok);
    }
  }

  // 4. cesta <-> id / ACT (A3, A9)
  if (umiestnenie) {
    if (data.id !== umiestnenie.id) diag(n, "E", "A3", `id ${repr(data.id)} != ID z cesty ${repr(umiestnenie.id)}`, "/id");
    if (umiestnenie.typ === "ACT") {
      if (data.uroven !== umiestnenie.act_uroven) diag(n, "E", "A9", `uroven ${repr(data.uroven)} nesedí s cestou (${umiestnenie.act_uroven})`, "/uroven");
      if (data.strana !== umiestnenie.act_strana) diag(n, "E", "A9", `strana ${repr(data.strana)} nesedí s cestou (${umiestnenie.act_strana})`, "/strana");
      if (
        umiestnenie.act_uroven === "funkcia" &&
        (umiestnenie.act_strana === "poverena" || umiestnenie.act_strana === "veduca-poverena") &&
        umiestnenie.id.split("/").length - 1 < 2
      ) {
        diag(n, "E", "A9", "funkcia poverenej strany musí mať v ceste tím (§16.17)", "/id");
      }
    }
    const aliases = Array.isArray(data.aliases) ? data.aliases : [];
    if (!aliases.includes(umiestnenie.id)) diag(n, "W", "A3", "aliases neobsahuje id (V18; writer doplní)", "/aliases");
  }
  return n;
}

function nacitajTelo(n: Poznamka, model: Model) {
  const inline = new Map<string, string[]>();
  let nadpis: Nadpis | null = null;
  let pod: PodZaznam | null = null;

  for (const b of n.dokument.telo) {
    if (b.druh === "Nadpis") {
      nadpis = b;
      pod = null;
      continue;
    }
    if (b.druh === "InlinePole") {
      const k = b.kluc;
      const f = model.polia.get(k);
      if (!f) {
        diag(n, "E", "A5", `neznáme inline pole \`${k}::\``, `/${k}`, b.riadok + 1);
        continue;
      }
      if (f.zdroj !== "inline") {
        diag(n, "E", "A6", `pole \`${k}\` patrí do ${f.zdroj}, nie do tela`, `/${k}`, b.riadok + 1);
        continue;
      }
      if (k in n.zdroje && n.zdroje[k] !== "inline") {
        diag(n, "E", "A6", `pole \`${k}\` je vo frontmatter aj v tele`, `/${k}`, b.riadok + 1);
        continue;
      }
      n.zdroje[k] = "inline";
      if (!(k in n.riadky)) n.riadky[k] = b.riadok;
      const tokens = f.odkaz ? rozdelInline(b.raw_hodnota) : pyStrip(b.raw_hodnota) ? [b.raw_hodnota] : [];
      inline.set(k, [...(inline.get(k) ?? []), ...tokens]);
      continue;
    }
    if (b.druh === "YamlBlok") {
      const yamlRiadok = b.riadok + 1;
      if (b.chyba || !b.data) {
        diag(n, "E", "A1", `neplatný YAML blok: ${(b.sprava ?? "").split("\n")[0]}`, "", yamlRiadok + 1);
        continue;
      }
      const d = b.data;
      if (nadpis && "id" in d) {
        nacitajPodZaznam(n, model, nadpis, b, d);
        const last = n.pod_zaznamy[n.pod_zaznamy.length - 1];
        pod = last && last.blok === b ? last : null;
        continue;
      }
      const keys = Object.keys(d);
      if (keys.length === 1) {
        const k = keys[0];
        const f = model.polia.get(k);
        if (f && f.zdroj === "blok") {
          if (k in n.zdroje) {
            diag(n, "E", "A6", `blokové pole \`${k}\` je uvedené viackrát alebo aj vo frontmatter`, `/${k}`, yamlRiadok + 1);
            continue;
          }
          n.zdroje[k] = "blok";
          n.riadky[k] = yamlRiadok;
          n.data[k] = d[k];
          continue;
        }
      }
      diag(n, "W", "BLOK", `neznámy YAML blok (kľúče: ${[...keys.join(", ")].slice(0, 60).join("")})`, "", yamlRiadok + 1);
      continue;
    }
    if (b.druh === "SurovyBlok" && b.jazyk === "ids" && pod) {
      pod.ids_blok = b;
      continue;
    }
  }

  for (const [k, vals] of inline) {
    const f = model.polia.get(k)!;
    if (f.zoznam) n.data[k] = vals;
    else if (vals.length > 1) diag(n, "E", "A6", `pole \`${k}\` má viac hodnôt, očakávaná jedna`, `/${k}`, (n.riadky[k] ?? 0) + 1);
    else if (vals.length) n.data[k] = vals[0];
  }
}

function nacitajPodZaznam(n: Poznamka, model: Model, nadpis: Nadpis, blok: YamlBlok, d: Record<string, unknown>) {
  const druh = druhPodZaznamu(d);
  const pz: PodZaznam = { druh, id: String(d.id), nadpis, blok, data: d, model: null, ids_blok: null };
  n.pod_zaznamy.push(pz);
  const yamlRiadok = blok.riadok + 1;
  if (!model.pod_zaznamy.includes(druh)) diag(n, "W", "BLOK", `pod-záznam \`${pz.id}\` (${druh}) v poznámke typu ${model.typ}`, `#${pz.id}`, yamlRiadok + 1);
  const idToken = nadpis.text.split(" ")[0];
  if (idToken !== pz.id) diag(n, "E", "A11", `id pod-záznamu ${repr(pz.id)} != prvý token nadpisu ${repr(idToken)}`, `#${pz.id}`, nadpis.riadok + 1);
  const r = POD[druh].safeParse({ ...d, poznamka: n.data.id ?? null });
  if (r.success) pz.model = r.data;
  else {
    for (const c of chyby(r.error.issues)) {
      const rr = riadokPrePointer(blok.yaml_text, c.loc);
      diag(n, "E", c.kod, c.sprava, `#${pz.id}/${c.loc.map(String).join("/")}`, rr !== null ? yamlRiadok + rr + 1 : yamlRiadok + 1);
    }
  }
}

// ------------------------------------------------------------------------------------------------ knižnica a tvar korpusu

/** Súbory knižnice okrem `KNIZNICA.md` (ako `Sklad.texty()`), zoradené podľa cesty. */
export function nacitajKniznicu(texty: Record<string, string>): Poznamka[] {
  return Object.keys(texty)
    .filter((rel) => rel !== "KNIZNICA.md")
    .sort()
    .map((rel) => nacitajSubor(rel, texty[rel]));
}

const poradieDiag = (d: Diagnostika[]) => [...d].sort((a, b) => kluc(a).localeCompare(kluc(b)));
/** `json.dumps(d, sort_keys=True)` ako kľúč poradia (rovnaké poradie ako korpus). */
const kluc = (d: Diagnostika) =>
  JSON.stringify(Object.fromEntries(Object.keys(d).sort().map((k) => [k, d[k as keyof Diagnostika]])));

/** Záznam `poznamky.json` korpusu. */
export function poznamkaJson(n: Poznamka) {
  return {
    id: idPoznamky(n),
    typ: (n.data.typ as string | undefined) || n.umiestnenie?.typ || null,
    data: n.data,
    zdroje: Object.fromEntries(Object.entries(n.zdroje).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    model: n.model,
    pod_zaznamy: n.pod_zaznamy.map((p) => ({ id: p.id, druh: p.druh, data: p.data })),
    diagnostiky: poradieDiag(n.diagnostiky),
    verzia: n.verzia,
  };
}
