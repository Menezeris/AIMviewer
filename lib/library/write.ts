/**
 * Uloženie z editora knižnice (port `assetin/engine/zapis.py`, D-186 krok 3): zmeny po poznámkach, nová poznámka
 * zo šablóny typu, premenovanie súboru pri zmene `nazov`. Každá poznámka sa najprv opraví, znova načíta a
 * natypuje v pamäti; do skladu ide len to, čo prešlo, naraz (V29). Poznámka, ktorú zmena rozbije, sa odmietne celá.
 *
 * Sklad je rozhranie: v testoch pamäť (korpus `upravy/*`), v AIM DB (`library.zapis_revizie`, konflikt AS409).
 */

import { createHash } from "node:crypto";

import { parsuj, serializuj } from "./blocks";
import { PathError, pathFor, renamable, typZPrefixuId } from "./paths";
import { modelForType, loadLibrary, loadFile, type Diagnostic, type Note } from "./loader";
import {
  WriteError,
  setBlockField,
  setFrontmatter,
  setInline,
  setSubRecord,
  setProse,
  newNote,
  odstranFrontmatter,
  odstranInline,
  zabezpecAliases,
} from "./writer";

export const POD_PREFIX = "__pod";
export const PROZA_PREFIX = "__proza";
/** Polia, ktoré editor nikdy nepíše: nesie ich cesta súboru (§0.4). */
export const NEMENITELNE = ["id", "typ"];
export const PREDVOLBY_NOVEJ = { stav: "WD", verzia: "0.1", jazyk: "sk" };

export interface Zmena {
  id: string;
  pointer: string;
  hodnota: unknown;
}

export const changePath = (z: Zmena): Array<string | number> =>
  z.pointer
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter((c) => c !== "")
    .map((c) => (/^\d+$/.test(c) ? Number(c) : c));

export interface FileWrite {
  /** Pôvodná cesta; null = nový súbor. */
  cesta: string | null;
  text: string;
  /** sha256 textu, ktorý editor videl; null pri novom súbore. */
  ocakavana: string | null;
  nova_cesta: string | null;
  note_id?: string | null;
  typ?: string | null;
}

export interface Podpis {
  autor: string;
  sprava?: string | null;
  zdroj?: string;
}

/** Konflikt: súbor medzitým zmenil niekto iný (AS409), nič sa nezapísalo. */
export class Konflikt extends Error {
  constructor(public readonly cesty: string[]) {
    super(`konflikt: ${cesty.join(", ")}`);
  }
}
export class StoreError extends Error {}

export interface Sklad {
  /** Všetky súbory knižnice vrátane `KNIZNICA.md`. */
  texty(): Promise<Record<string, string>>;
  existuje(rel: string): Promise<boolean>;
  /** Všetko alebo nič; hodí `Konflikt`. */
  zapis(zapisy: FileWrite[], podpis: Podpis): Promise<void>;
}

export const verziaTextu = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

/** Sklad v pamäti (testy, korpus): ako `SkladPamat` v Pythone. */
export function memoryStore(texty: Record<string, string>): Sklad & { subory: Record<string, string> } {
  const subory = { ...texty };
  return {
    subory,
    async texty() {
      return { ...subory };
    },
    async existuje(rel) {
      return rel in subory;
    },
    async zapis(zapisy) {
      const konflikt: string[] = [];
      for (const z of zapisy) {
        const ciel = z.nova_cesta ?? z.cesta!;
        if (z.cesta === null) {
          if (ciel in subory) konflikt.push(ciel);
          continue;
        }
        if (!(z.cesta in subory) || z.ocakavana !== verziaTextu(subory[z.cesta])) konflikt.push(z.cesta);
        if (ciel !== z.cesta && ciel in subory) konflikt.push(ciel);
      }
      if (konflikt.length) throw new Konflikt(konflikt);
      for (const z of zapisy) {
        if (z.cesta && z.nova_cesta && z.nova_cesta !== z.cesta) delete subory[z.cesta];
        subory[z.nova_cesta ?? z.cesta!] = z.text;
      }
    },
  };
}

export interface Vysledok {
  ok: boolean;
  zapisane: string[];
  odmietnute: string[];
  vytvorene: string[];
  premenovane: Array<[string, string]>;
  konflikt: boolean;
  diagnostiky: Diagnostic[];
}

const novyVysledok = (): Vysledok => ({ ok: true, zapisane: [], odmietnute: [], vytvorene: [], premenovane: [], konflikt: false, diagnostiky: [] });
const hotovo = (v: Vysledok): Vysledok => ({ ...v, ok: v.odmietnute.length === 0 });

export const diag = (nid: string, pointer: string, sprava: string, subor: string, kod = "W1"): Diagnostic => ({
  note_id: nid,
  json_pointer: pointer,
  uroven: "E",
  kod,
  sprava,
  subor,
  riadok: null,
});

/** Poznámky podľa ID (prvá vyhráva) a globálne pod-záznamy (`STD-*`, `GEO-*`), ako `Kniznica.pridaj`. */
function index(vsetky: Note[]) {
  const poznamky = new Map<string, Note>();
  const globalnePod = new Set<string>();
  for (const n of vsetky) {
    const nid = (n.model?.id ?? n.data.id ?? n.umiestnenie?.id) as string | undefined;
    if (!nid || poznamky.has(nid)) continue;
    poznamky.set(nid, n);
    for (const pz of n.pod_zaznamy) if ((pz.id.startsWith("STD-") || pz.id.startsWith("GEO-")) && !globalnePod.has(pz.id) && !poznamky.has(pz.id)) globalnePod.add(pz.id);
  }
  return { poznamky, globalnePod };
}

const idPoznamky = (n: Note) => String(n.model?.id ?? n.data.id ?? n.umiestnenie?.id ?? "");

function kopia<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

/** `_cela_hodnota`: celá hodnota poľa najvyššej úrovne po zmene (inline a blokové polia sa prepisujú celé). */
function celaHodnota(n: Note, z: Zmena, cesta: Array<string | number>): unknown {
  if (cesta.length === 1) return z.hodnota;
  const aktualna = kopia(n.data[String(cesta[0])]) as unknown;
  let cur = aktualna as Record<string, unknown> | unknown[];
  for (const k of cesta.slice(1, -1)) {
    if (Array.isArray(cur) && typeof k === "number") {
      while (cur.length <= k) cur.push({});
      cur = cur[k] as Record<string, unknown>;
    } else {
      if (!cur || typeof cur !== "object" || Array.isArray(cur)) throw new WriteError(`${z.pointer}: cesta nesedí s tvarom hodnoty`);
      const o = cur as Record<string, unknown>;
      if (!(String(k) in o)) o[String(k)] = {};
      cur = o[String(k)] as Record<string, unknown>;
    }
  }
  const posledny = cesta[cesta.length - 1];
  if (Array.isArray(cur) && typeof posledny === "number") {
    while (cur.length <= posledny) cur.push({});
    cur[posledny] = z.hodnota;
  } else if (cur && typeof cur === "object") {
    const o = cur as Record<string, unknown>;
    if (z.hodnota === null) delete o[String(posledny)];
    else o[String(posledny)] = z.hodnota;
  }
  return aktualna;
}

type JS = Record<string, unknown>;

/** Uzol schémy bez `$ref` a únie s `null`; pri únii záznamov ten, ktorého polia pokryjú hodnotu. */
function rozlis(js: JS, defs: Record<string, JS>, hodnota?: unknown): JS | null {
  let n: JS | undefined = js;
  for (let i = 0; i < 10 && n; i++) {
    if (typeof n.$ref === "string") n = defs[n.$ref.replace("#/$defs/", "")];
    else if (Array.isArray(n.anyOf) || Array.isArray(n.oneOf)) {
      const vetvy = ((n.anyOf ?? n.oneOf) as JS[]).map((x) => rozlis(x, defs, hodnota)).filter((x): x is JS => !!x && x.type !== "null");
      const kluce = hodnota && typeof hodnota === "object" && !Array.isArray(hodnota) ? Object.keys(hodnota) : [];
      const pokryje = vetvy.find((v) => v.properties && kluce.every((k) => k in (v.properties as JS)));
      n = pokryje ?? vetvy.find((v) => (Array.isArray(hodnota) ? v.type === "array" : v.properties)) ?? vetvy[0];
      break;
    } else break;
  }
  return n ?? null;
}

/**
 * Kľúče nového záznamu z editora v poradí polí schémy (rekurzívne), neznáme kľúče na konci. Editor posiela JSON bez
 * záruky poradia; Python zapisuje v poradí, v akom hodnotu dostal, a formulár ju skladá v poradí schémy.
 */
export function usporiadaj(js: JS | null, defs: Record<string, JS>, v: unknown): unknown {
  const n = js ? rozlis(js, defs, v) : null;
  if (Array.isArray(v)) return v.map((x) => usporiadaj(n && n.items ? (n.items as JS) : null, defs, x));
  if (!v || typeof v !== "object") return v;
  const props = (n?.properties ?? {}) as Record<string, JS>;
  const o = v as Record<string, unknown>;
  const kluce = [...Object.keys(props).filter((k) => k in o), ...Object.keys(o).filter((k) => !(k in props))];
  return Object.fromEntries(kluce.map((k) => [k, usporiadaj(props[k] ?? null, defs, o[k])]));
}

/** Uzol schémy na ceste (čísla = položky zoznamu). */
function schemaNaCeste(js: JS, cesta: Array<string | number>): JS | null {
  const defs = (js.$defs ?? {}) as Record<string, JS>;
  let n: JS | null = js;
  for (const k of cesta) {
    n = n ? rozlis(n, defs) : null;
    if (!n) return null;
    n = typeof k === "number" ? ((n.items as JS) ?? null) : (((n.properties ?? {}) as Record<string, JS>)[String(k)] ?? null);
  }
  return n;
}

/** `uloz_poznamku`: všetky zmeny jednej poznámky -> (text, diagnostiky). */
export function saveNote(n: Note, zmeny: Zmena[]): [string, Diagnostic[]] {
  const doc = parsuj(serializuj(n.dokument));
  const nid = n.model ? String(n.model.id) : idPoznamky(n);
  if (!n.model) return [serializuj(doc), [diag(nid || n.rel, "", "poznámka sa nedá načítať typovane — zápis by ju rozbil", n.rel)]];
  const model = modelForType(String(n.model.typ))!;
  const poradie = [...model.polia.keys()];
  const chyby: Diagnostic[] = [];

  // próza najprv: indexy blokov sú z textu, ktorý editor ukázal
  for (const z of zmeny) {
    const c = changePath(z);
    if (c[0] !== PROZA_PREFIX) continue;
    if (c.length !== 2 || typeof c[1] !== "number") {
      chyby.push(diag(nid, z.pointer, "próza sa adresuje /__proza/<blok>", n.rel));
      continue;
    }
    try {
      setProse(doc, c[1], z.hodnota === null || z.hodnota === undefined ? "" : String(z.hodnota));
    } catch (e) {
      if (!(e instanceof WriteError)) throw e;
      chyby.push(diag(nid, z.pointer, e.message, n.rel));
    }
  }

  const defs = (model.js.$defs ?? {}) as Record<string, JS>;
  for (const z0 of zmeny) {
    const c = changePath(z0);
    if (!c.length || c[0] === PROZA_PREFIX) continue;
    const z: Zmena = c[0] === POD_PREFIX ? z0 : { ...z0, hodnota: usporiadaj(schemaNaCeste(model.js, c), defs, z0.hodnota) };
    if (c[0] === POD_PREFIX) {
      if (c.length < 3) continue;
      setSubRecord(doc, String(c[1]), c.slice(2), z.hodnota);
      continue;
    }
    const kluc = String(c[0]);
    if (NEMENITELNE.includes(kluc)) {
      chyby.push(diag(nid, z.pointer, `\`${kluc}\` nesie cesta súboru (§0.4)`, n.rel));
      continue;
    }
    const zdroj = n.zdroje[kluc] ?? model.polia.get(kluc)?.zdroj ?? "frontmatter";
    if (zdroj === "frontmatter") {
      if (z.hodnota === null && c.length === 1) odstranFrontmatter(doc, kluc);
      else setFrontmatter(doc, c, z.hodnota, poradie);
      continue;
    }
    const cela = celaHodnota(n, z, c);
    const sekcia = model.polia.get(kluc)?.sekcia ?? "";
    if (zdroj === "inline") {
      if (cela === null || cela === undefined || cela === "" || (Array.isArray(cela) && cela.length === 0)) odstranInline(doc, kluc);
      else setInline(doc, kluc, cela, sekcia, model.sekcie);
    } else if (zdroj === "blok") setBlockField(doc, kluc, cela, sekcia, model.sekcie);
    else chyby.push(diag(nid, z.pointer, `neznámy nositeľ poľa: ${zdroj}`, n.rel));
  }
  if (nid) zabezpecAliases(doc, nid);
  return [serializuj(doc), chyby];
}

/** `_cesta_po_premenovani`: nová cesta súboru po zmene `nazov` v tomto uložení, inak null. */
function cestaPoPremenovani(n: Note, zmeny: Zmena[]): string | null {
  if (!zmeny.some((z) => z.pointer.replace(/\/+$/, "") === "/nazov")) return null;
  const um = n.umiestnenie;
  if (!um || !n.model || !renamable(um.typ, um.id)) return null;
  let rel: string;
  try {
    rel = pathFor(um.typ, um.id, String(n.model.nazov ?? ""), um.vrstva, um.balik, um.act_uroven);
  } catch (e) {
    if (e instanceof PathError) return null;
    throw e;
  }
  return rel === n.rel ? null : rel;
}

/**
 * `uloz`: zmeny poznámka po poznámke. `verzie` (ID -> sha256 textu, ktorý editor ukazoval) odmietne poznámku, ktorú
 * medzitým zmenil niekto iný; bez nich platí verzia, pri ktorej sa knižnica načítala.
 */
export async function uloz(sklad: Sklad, zmeny: Zmena[], podpis: Podpis, verzie: Record<string, string> = {}): Promise<Vysledok> {
  const texty = await sklad.texty();
  const vsetky = loadLibrary(texty);
  const { poznamky } = index(vsetky);
  const v = novyVysledok();
  const podla = new Map<string, Zmena[]>();
  for (const z of zmeny) podla.set(z.id, [...(podla.get(z.id) ?? []), z]);

  const zapisy: FileWrite[] = [];
  for (const [nid, zoznam] of podla) {
    const n = poznamky.get(nid);
    if (!n) {
      v.odmietnute.push(nid);
      v.diagnostiky.push(diag(nid, "", "poznámka s týmto ID v knižnici nie je", ""));
      continue;
    }
    let text: string;
    let chyby: Diagnostic[];
    try {
      [text, chyby] = saveNote(n, zoznam);
    } catch (e) {
      v.odmietnute.push(nid);
      v.diagnostiky.push(diag(nid, "", `zápis zlyhal: ${e instanceof Error ? e.message : String(e)}`, n.rel));
      continue;
    }
    if (chyby.length) {
      v.odmietnute.push(nid);
      v.diagnostiky.push(...chyby);
      continue;
    }
    const znovu = loadFile(n.rel, text);
    const tvrde = znovu.diagnostiky.filter((d) => d.uroven === "E");
    if (!znovu.model || tvrde.length) {
      v.odmietnute.push(nid);
      v.diagnostiky.push(...(tvrde.length ? tvrde : [diag(nid, "", "po zápise sa poznámka nedá natypovať", n.rel)]));
      continue;
    }
    const ocakavana = verzie[nid] ?? n.verzia;
    const nova = cestaPoPremenovani(znovu, zoznam);
    if (nova !== null) {
      if (await sklad.existuje(nova)) {
        v.odmietnute.push(nid);
        v.diagnostiky.push(diag(nid, "/nazov", `súbor ${nova} už existuje`, n.rel));
        continue;
      }
      const po = loadFile(nova, text);
      if (!po.model || po.diagnostiky.some((d) => d.uroven === "E")) {
        v.odmietnute.push(nid);
        v.diagnostiky.push(diag(nid, "/nazov", "po premenovaní sa poznámka nedá načítať", n.rel));
        continue;
      }
      zapisy.push({ cesta: n.rel, text, ocakavana, nova_cesta: nova, note_id: nid, typ: String(znovu.model.typ) });
      v.premenovane.push([n.rel, nova]);
      v.zapisane.push(nova);
      continue;
    }
    zapisy.push({ cesta: n.rel, text, ocakavana, nova_cesta: null, note_id: nid, typ: String(znovu.model.typ) });
    v.zapisane.push(n.rel);
  }

  if (zapisy.length) {
    try {
      await sklad.zapis(zapisy, podpis);
    } catch (e) {
      if (e instanceof Konflikt) {
        for (const rel of e.cesty) {
          const n = vsetky.find((x) => x.rel === rel);
          v.diagnostiky.push(diag(n ? idPoznamky(n) : rel, "", "poznámku medzitým zmenil niekto iný; načítaj ju znova", rel, "W2"));
        }
        v.konflikt = true;
        for (const z of podla.keys()) if (!v.odmietnute.includes(z)) v.odmietnute.push(z);
        v.zapisane = [];
        v.premenovane = [];
      } else {
        for (const z of podla.keys()) if (!v.odmietnute.includes(z)) v.odmietnute.push(z);
        v.diagnostiky.push(diag("", "", `sklad zápis odmietol: ${e instanceof Error ? e.message : String(e)}`, ""));
        v.zapisane = [];
        v.premenovane = [];
      }
    }
  }
  return hotovo(v);
}

export interface NewNote {
  typ: string;
  id: string;
  nazov: string;
  data?: Record<string, unknown>;
  vrstva?: string;
  balik?: string | null;
}

/** `_kandidat`: hodnoty, cesta a dokument poznámky zo šablóny typu. */
export function kandidat(p: NewNote) {
  const h: Record<string, unknown> = { ...PREDVOLBY_NOVEJ, ...(p.data ?? {}), id: p.id, typ: p.typ, nazov: p.nazov };
  if (p.typ === "ACT") {
    const segs = p.id.slice("ACT-".length).split("/");
    if (!("strana" in h)) h.strana = segs[0];
    const predvolena = segs.length === 1 ? "strana" : segs.length === 2 && (segs[0] === "poverena" || segs[0] === "veduca-poverena") ? "tim" : "funkcia";
    if (!("uroven" in h)) h.uroven = predvolena;
  }
  const rel = pathFor(p.typ, p.id, p.nazov, p.vrstva ?? "zadanie", p.balik ?? null, p.typ === "ACT" ? String(h.uroven) : null);
  const m = modelForType(p.typ)!;
  const polia = [...m.polia.entries()].map(([kluc, f]) => ({ kluc, ...f }));
  return { rel, doc: newNote(p.typ, m.sekcie, polia, h) };
}

/** `vytvor`: nová poznámka zo šablóny typu na ceste, ktorú určuje ID. */
export async function vytvor(sklad: Sklad, p: NewNote, podpis: Podpis): Promise<Vysledok> {
  const v = novyVysledok();
  const odmietni = (sprava: string, pointer = "") => {
    v.odmietnute.push(p.id);
    v.diagnostiky.push(diag(p.id, pointer, sprava, ""));
    return hotovo(v);
  };
  if (!modelForType(p.typ)) return odmietni(`neznámy typ '${p.typ}'`, "/typ");
  if (!p.id || p.id.includes(" ") || typZPrefixuId(p.id) !== p.typ) return odmietni(`ID '${p.id}' nezodpovedá typu ${p.typ} (prefix, bez medzier)`, "/id");
  const { poznamky, globalnePod } = index(loadLibrary(await sklad.texty()));
  if (poznamky.has(p.id) || globalnePod.has(p.id)) return odmietni(`ID '${p.id}' už v knižnici je`, "/id");
  let k: ReturnType<typeof kandidat>;
  try {
    k = kandidat(p);
  } catch (e) {
    if (e instanceof PathError) return odmietni(`pre ${p.typ} sa nedá určiť cesta: ${e.message}`, "/id");
    return odmietni(`šablóna sa nedá zostaviť: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (await sklad.existuje(k.rel)) return odmietni(`súbor ${k.rel} už existuje`, "/id");
  const text = serializuj(k.doc);
  const n = loadFile(k.rel, text);
  const tvrde = n.diagnostiky.filter((d) => d.uroven === "E");
  if (!n.model || tvrde.length) {
    v.odmietnute.push(p.id);
    v.diagnostiky.push(...(tvrde.length ? tvrde : [diag(p.id, "", "nová poznámka sa nedá natypovať", k.rel)]));
    return hotovo(v);
  }
  try {
    await sklad.zapis([{ cesta: null, text, ocakavana: null, nova_cesta: k.rel, note_id: p.id, typ: p.typ }], { zdroj: "nova", ...podpis });
  } catch (e) {
    if (e instanceof Konflikt) return odmietni(`súbor ${k.rel} už existuje`, "/id");
    return odmietni(`sklad zápis odmietol: ${e instanceof Error ? e.message : String(e)}`);
  }
  v.vytvorene.push(n.rel);
  return hotovo(v);
}
