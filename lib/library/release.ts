/**
 * Vydanie knižnice a publikácia jej IDS do katalógu AIM (port `assetin/db/vydanie.py`, D-186 krok 6).
 *
 * Vydanie je nemenná snímka hlavy každého súboru s odtlačkom (`manifest_sha256`). Vzniká len z knižnice s 0 chybami
 * validátora (Q64 g) a len vtedy, keď sa medzi validáciou a snímkou nič nezmenilo (SQL overí verziu každého súboru,
 * inak AS409). IDS z generátora idú do `public.ids_documents` v tej istej transakcii ako snímka, takže AIM nikdy
 * neuvidí IDS bez vydania. IDS, ktoré neprejde kontrolou XSD (ak je zapojená), vydanie zastaví.
 */

import { strToU8, zipSync } from "fflate";

import { loadLibraryGraph, SCHEMA_VERZIA, type Library } from "./graph";
import { ciele, generujCiel } from "./ids/generator";
import type { Diagnostic } from "./loader";
import { validuj } from "./validator";
import { Konflikt, verziaTextu } from "./write";

export const GENERATOR = "aimviewer lib/kniznica/ids (D-186)";
export const MANIFEST_FILE = ".assetin-export.json";

export interface IDSVystup {
  code: string;
  title: string;
  xml: string;
  library_path: string;
  ids_version: string;
  poznamky: string[];
  audit: Record<string, unknown>;
}

/** Kontrola XSD jedného IDS: `[]` platné, zoznam chýb, `null` = nedá sa overiť (rozhodnutie (d) ešte padne). */
export type XsdCheck = (xml: string) => Promise<string[] | null>;

export class IdsError extends Error {}

/** `kod_ids`: kód v katalógu (`ER-0101.ARCH`); posledný segment ID aktéra, lebo `code` v AIM nepripúšťa `/`. */
export function kodIds(erId: string, poskytovatelId: string): string {
  let posledny = poskytovatelId.split("/").pop()!;
  if (posledny.startsWith("ACT-")) posledny = posledny.slice(4);
  return `${erId}.${posledny}`;
}

/** `manifest`: zoradené súbory s sha256 a odtlačok celku. */
export function manifest(texty: Record<string, string>) {
  const subory = Object.keys(texty)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((cesta) => ({ cesta, sha256: verziaTextu(texty[cesta]) }));
  return { subory, manifest_sha256: verziaTextu(subory.map((s) => `${s.cesta}\t${s.sha256}\n`).join("")) };
}

/** `normalizuj_cestu`: relatívna cesta POSIX v NFC. */
function normalizujCestu(rel: string): string {
  const p = rel.replace(/\\/g, "/").normalize("NFC");
  if (!p || p.startsWith("/") || p.split("/").includes("..")) throw new Error(`neplatná relatívna cesta '${rel}'`);
  return p;
}

/** `zip_exportu`: export vydania ako zip (súbory knižnice + skrytý manifest pôvodu), dátum 1980-01-01. */
export function zipExportu(texty: Record<string, string>, hlavicka: Record<string, unknown> = {}): Uint8Array {
  const mtime = new Date(1980, 0, 1, 0, 0, 0);
  const subory: Record<string, [Uint8Array, { mtime: Date; level: 6 }]> = {};
  for (const rel of Object.keys(texty).sort()) subory[normalizujCestu(rel)] = [strToU8(texty[rel]), { mtime, level: 6 }];
  subory[MANIFEST_FILE] = [strToU8(`${JSON.stringify({ ...hlavicka, ...manifest(texty) }, null, 2)}\n`), { mtime, level: 6 }];
  return zipSync(subory);
}

/** `generate.ids.generuj`: IDS každého cieľa s aspoň jednou špecifikáciou; neplatné IDS (XSD) hodí `ChybaIDS`. */
export async function generujIds(k: Library, xsd: XsdCheck | null, datum: string | null = null): Promise<IDSVystup[]> {
  const out: IDSVystup[] = [];
  for (const c of ciele(k)) {
    const [xml, rep] = generujCiel(k, c, datum);
    if (!rep.specs.length) continue;
    const chyby = xsd ? await xsd(xml) : null;
    if (chyby && chyby.length) throw new IdsError(`${kodIds(c.er, c.poskytovatel)} neprešlo ids.xsd: ${chyby[0]}`);
    const er = k.poznamky.get(c.er)!;
    const prov = k.poznamky.get(c.poskytovatel);
    const meno = prov?.model ? String(prov.model.nazov) : c.poskytovatel;
    out.push({
      code: kodIds(c.er, c.poskytovatel),
      title: `${er.model!.nazov} - ${meno}`,
      xml,
      library_path: er.rel,
      ids_version: "1.0",
      poznamky: [c.er, ...rep.objekty, ...rep.specs.filter((s) => s.includes("(STD,")).map((s) => s.split(" ")[0])],
      audit: {
        generator: GENERATOR,
        poskytovatel: c.poskytovatel,
        xsd: chyby === null ? "neoverené" : "ok",
        specifikacie: rep.specs,
        mimo_ids: rep.skipped.length,
        nezmapovane: rep.missing.length,
      },
    });
  }
  return out;
}

export interface VysledokVydania {
  ok: boolean;
  kod: string;
  vydanie_id: string | null;
  manifest_sha256: string | null;
  chyby: Diagnostic[];
  ids: unknown[];
  export_cesta: string | null;
  sprava: string;
}

/** Čo vydanie potrebuje od DB: texty hlavy, jedna transakcia snímka + katalóg, zápis cesty exportu. */
export interface ReleaseStore {
  kniznica: string;
  texty(): Promise<Record<string, string>>;
  /** `library.vytvor_vydanie` + `library.publikuj_ids` v jednej transakcii; súbeh hodí `Konflikt`. */
  vydaj(p: { kod: string; autor: string; sprava: string | null; schema_verzia: string; diagnostiky: Record<string, number>; ocakavane: Record<string, string>; polozky: unknown[] }): Promise<{ vydanie_id: string; ids: unknown[] }>;
  exportCesta?(vydanieId: string, cesta: string): Promise<void>;
}

export interface Uloziste {
  nahraj(cesta: string, data: Uint8Array): Promise<void>;
}

const vysledok = (kod: string, o: Partial<VysledokVydania>): VysledokVydania => ({ ok: false, kod, vydanie_id: null, manifest_sha256: null, chyby: [], ids: [], export_cesta: null, sprava: "", ...o });

/** `vydaj`: validácia, snímka, publikácia IDS, export MD. Všetko alebo nič až po nahratie exportu. */
export async function vydaj(sklad: ReleaseStore, kod: string, autor: string, sprava = "", o: { xsd?: XsdCheck | null; generator?: boolean; uloziste?: Uloziste | null } = {}): Promise<VysledokVydania> {
  if (!autor.trim()) throw new Error("vydanie potrebuje autora");
  const vsetky = await sklad.texty();
  const k = loadLibraryGraph(vsetky);
  const diag = validuj(k);
  const chyby = diag.filter((d) => d.uroven === "E");
  const suhrn = { E: chyby.length, W: diag.filter((d) => d.uroven === "W").length, I: diag.filter((d) => d.uroven === "I").length };
  if (chyby.length) return vysledok(kod, { chyby, sprava: `knižnica má ${chyby.length} chýb; vydanie sa nerobí (Q64 g)` });

  const generator = o.generator !== false;
  let vystupy: IDSVystup[] = [];
  try {
    vystupy = generator ? await generujIds(k, o.xsd ?? null) : [];
  } catch (e) {
    return vysledok(kod, { sprava: `generátor IDS: ${e instanceof Error ? e.message : String(e)}; vydanie sa nerobí` });
  }
  const m = manifest(vsetky);
  const revizie = Object.fromEntries(Object.entries(vsetky).map(([rel, t]) => [rel, verziaTextu(t)]));
  const polozky = vystupy.map((v) => ({
    code: v.code,
    title: v.title,
    xml: v.xml,
    ids_version: v.ids_version,
    library_path: v.library_path,
    audit: {
      kniznica: sklad.kniznica,
      vydanie: kod,
      manifest_sha256: m.manifest_sha256,
      schema_verzia: SCHEMA_VERZIA,
      diagnostiky: suhrn,
      poznamky: v.poznamky.filter((nid) => k.poznamky.has(nid)).map((nid) => ({ id: nid, cesta: k.poznamky.get(nid)!.rel, sha256: revizie[k.poznamky.get(nid)!.rel] ?? null })),
      ...v.audit,
    },
  }));

  const { vydanie_id, ids } = await sklad.vydaj({ kod, autor: autor.trim(), sprava: sprava || null, schema_verzia: SCHEMA_VERZIA, diagnostiky: suhrn, ocakavane: revizie, polozky });
  const out = vysledok(kod, {
    ok: true,
    vydanie_id,
    manifest_sha256: m.manifest_sha256,
    ids,
    sprava:
      `vydanie ${kod}: ${Object.keys(vsetky).length} súborov, ${suhrn.W} varovaní; ` +
      (generator ? `${ids.length} IDS v katalógu AIM` : "bez IDS - generátor nie je k dispozícii") +
      (vystupy.some((v) => v.audit.xsd === "neoverené") ? "; POZOR: IDS neoverené proti ids.xsd" : ""),
  });

  if (o.uloziste && sklad.exportCesta) {
    const cesta = `${sklad.kniznica}/${kod}.zip`;
    await o.uloziste.nahraj(cesta, zipExportu(vsetky, { kniznica: sklad.kniznica, vydanie: kod }));
    await sklad.exportCesta(vydanie_id, cesta);
    out.export_cesta = cesta;
  }
  return out;
}

export { Konflikt };
