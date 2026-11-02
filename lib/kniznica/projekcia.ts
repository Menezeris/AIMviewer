/**
 * Projekcia súboru knižnice (port `assetin.db.sklad_db.projekcia`, D-186 krok 3): čo engine odvodí z jedného textu,
 * pri každom zápise sa uloží do `library.projekcia` (odvodené, nositeľom ostáva text, princíp 4).
 */

import { VRSTVY } from "./cesty";
import { modelPreTyp, nacitajSubor, type Diagnostika } from "./loader";

const KNIZNICA_SUBOR = "KNIZNICA.md";
const WIKILINK_PATTERN = "^\\[\\[[^\\[\\]]+\\]\\]$";
const WIKILINK_RE = /^\[\[([^[\]|#]+?)(?:#([^[\]|]+?))?(?:\|([^[\]]*?))?\]\]$/;

export interface Odkaz {
  pointer: string;
  ciel: string;
  kotva: string | null;
  alias: string | null;
}

export interface Projekcia {
  frontmatter: Record<string, unknown> | null;
  data: Record<string, unknown> | null;
  odkazy: Odkaz[];
  diagnostiky: Diagnostika[];
}

/** `je_subor_kniznice`: `KNIZNICA.md` alebo `.md` pod vrstvou, mimo skrytých priečinkov. */
export function jeSuborKniznice(rel: string): boolean {
  if (rel === KNIZNICA_SUBOR) return true;
  const parts = rel.split("/");
  return parts.length >= 2 && (VRSTVY as readonly string[]).includes(parts[0]) && rel.endsWith(".md") && !parts.some((p) => p.startsWith("."));
}

export function parseWikilink(text: string): { ciel: string; kotva: string | null; alias: string | null } | null {
  const m = WIKILINK_RE.exec(text.trim());
  return m ? { ciel: m[1].trim(), kotva: m[2] ?? null, alias: m[3] ?? null } : null;
}

type JS = Record<string, unknown>;

function vetvy(n: JS, defs: Record<string, JS>): JS[] {
  if (typeof n.$ref === "string") return vetvy(defs[n.$ref.replace("#/$defs/", "")] ?? {}, defs);
  if (Array.isArray(n.anyOf) || Array.isArray(n.oneOf)) return ((n.anyOf ?? n.oneOf) as JS[]).flatMap((x) => vetvy(x, defs));
  return [n];
}

/** `_walk` / `_wikilinky`: odkazy z typovaného modelu v poradí polí, ukazovateľ s aliasom poľa. */
function walk(v: unknown, ptr: string, n: JS, defs: Record<string, JS>, meta: JS, out: Odkaz[]) {
  if (v === null || v === undefined) return;
  const b = vetvy(n, defs);
  if (typeof v === "string") {
    if (b.some((x) => x.pattern === WIKILINK_PATTERN)) {
      const w = parseWikilink(v);
      if (w) out.push({ pointer: ptr, ...w });
    }
    return;
  }
  if (Array.isArray(v)) {
    const items = b.find((x) => x.type === "array")?.items as JS | undefined;
    v.forEach((x, i) => walk(x, `${ptr}/${i}`, items ?? {}, defs, meta, out));
    return;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const model = b.find((x) => x.properties && Object.keys(o).every((k) => k in (x.properties as JS) || k.replace(/_/g, ".") in (x.properties as JS)));
    if (model) {
      pole(o, ptr, model, defs, out);
      return;
    }
    const slovnik = b.find((x) => x.type === "object" && x.additionalProperties !== undefined);
    const hodnota = slovnik && typeof slovnik.additionalProperties === "object" ? (slovnik.additionalProperties as JS) : {};
    for (const [k, x] of Object.entries(o)) {
      if (meta.widget === "wikilink-map" && k.startsWith("[[")) {
        const w = parseWikilink(k);
        if (w) out.push({ pointer: `${ptr}/${k}`, ...w });
      }
      walk(x, `${ptr}/${k}`, hodnota, defs, meta, out);
    }
  }
}

function pole(o: Record<string, unknown>, prefix: string, model: JS, defs: Record<string, JS>, out: Odkaz[]) {
  for (const [k, n] of Object.entries(model.properties as Record<string, JS>)) {
    const v = k in o ? o[k] : o[k.replace(/\./g, "_")];
    walk(v, `${prefix}/${k}`, n, defs, (n["x-assetin"] ?? {}) as JS, out);
  }
}

export function odkazyModelu(typ: string, model: Record<string, unknown>): Odkaz[] {
  const m = modelPreTyp(typ);
  if (!m) return [];
  const out: Odkaz[] = [];
  pole(model, "", m.js, (m.js.$defs ?? {}) as Record<string, JS>, out);
  return out;
}

/** `projekcia(rel, text)`. */
export function projekcia(rel: string, text: string): Projekcia {
  if (rel === KNIZNICA_SUBOR || !jeSuborKniznice(rel)) return { frontmatter: null, data: null, odkazy: [], diagnostiky: [] };
  const n = nacitajSubor(rel, text);
  const fm = n.dokument.frontmatter;
  return {
    frontmatter: fm && !fm.chyba && fm.data ? fm.data : null,
    data: n.model,
    odkazy: n.model ? odkazyModelu(String(n.model.typ), n.model) : [],
    diagnostiky: n.diagnostiky,
  };
}
