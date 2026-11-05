/**
 * Stránka editora knižnice (port `assetin/engine/nahlad.vykresli_html`, D-186 krok UI): šablóna `app.html` + design
 * kit + aliasy + ikony + dokument editora -> jeden HTML súbor bez build kroku. Šablóna a kit sú vendorovaná kópia
 * z assetin-library (`library/editor/PÔVOD.md`), needitujú sa ručne. Jediný rozdiel voči Pythonu: relatívne volania
 * `api/...` stránky smerujú na API AIM knižnice (`/api/library/editor/<kód>/...`).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const KOREN = join(process.cwd(), "library", "editor");
const ZNACKY = ["/*__DATA__*/", "/*__DESIGN_KIT__*/", "/*__ALIASY__*/", "/*__IKONY__*/", "__ZNACKA_PNG__", "__ZNACKA_INV_PNG__"];
const TMAVY_BLOK = /^\.dark,\s*\n\[data-theme="dark"\]\s*\{([\s\S]*?)^\}/m;

const citaj = (rel: string) => readFileSync(join(KOREN, rel), "utf8");
const obrazok = (rel: string) => `data:image/png;base64,${readFileSync(join(KOREN, rel)).toString("base64")}`;

/** `_systemovy_tmavy_rezim`: blok `.dark` z tokenov zopakovaný pod `prefers-color-scheme: dark`. */
function systemovyTmavyRezim(tokens: string): string {
  const m = TMAVY_BLOK.exec(tokens);
  if (!m) throw new Error('tokens.css nemá blok .dark / [data-theme="dark"] — over vendorovanú kópiu');
  return '\n/* doplnok appky: systémová tmavá téma bez explicitnej voľby (hodnoty sú z tokens.css) */\n@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {' + m[1] + "  }\n}\n";
}

export function designKitCss(): string {
  const tokens = citaj("design_kit/tokens.css");
  return tokens + systemovyTmavyRezim(tokens) + "\n" + citaj("design_kit/archive.css");
}

/** `json.dumps(v, ensure_ascii=False)`: oddeľovače `, ` a `: ` ako Python. */
export function pyJson(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(pyJson).join(", ")}]`;
  if (typeof v === "object") return `{${Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).map(([k, x]) => `${JSON.stringify(k)}: ${pyJson(x)}`).join(", ")}}`;
  if (typeof v === "number" && Number.isInteger(v) === false && Number.isFinite(v)) return String(v);
  return JSON.stringify(v);
}

/** Volania API v šablóne (`fetch("api/...`); počet stráži, že sa šablóna nezmenila potichu. */
const VOLANIA_API = 'fetch("api/';
export const POCET_VOLANI_API = 6;

/**
 * `vykresli_html`. `api` = absolútna predpona API (napr. `/api/library/editor/assetin/`); bez nej ostane šablóna
 * ako v Pythone (relatívne `api/...`).
 */
export function vykresliHtml(dokument: unknown, api: string | null = null): string {
  let sablona = citaj("app.html");
  for (const z of ZNACKY) if (!sablona.includes(z)) throw new Error(`šablóna app.html nemá značku ${z}`);
  if (api !== null) {
    const pocet = sablona.split(VOLANIA_API).length - 1;
    if (pocet !== POCET_VOLANI_API) throw new Error(`šablóna má ${pocet} volaní ${VOLANIA_API}, očakávaných ${POCET_VOLANI_API}`);
    sablona = sablona.split(VOLANIA_API).join(`fetch(${JSON.stringify(api)} + "`);
  }
  // `</` by predčasne zavrel okolitý <script>, nech JSON obsahuje čokoľvek
  const data = pyJson(dokument).replace(/<\//g, "<\\/");
  const nahrad = (s: string, z: string, h: string) => s.split(z).join(h);
  let out = nahrad(sablona, "/*__DESIGN_KIT__*/", designKitCss());
  out = nahrad(out, "/*__ALIASY__*/", citaj("aliasy.css"));
  out = nahrad(out, "/*__IKONY__*/", citaj("ikony.svg"));
  out = nahrad(out, "__ZNACKA_INV_PNG__", obrazok("design_kit/assetin-mark-inverse.png"));
  out = nahrad(out, "__ZNACKA_PNG__", obrazok("design_kit/assetin-mark.png"));
  return nahrad(out, "/*__DATA__*/", data);
}
