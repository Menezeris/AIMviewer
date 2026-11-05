/**
 * Kontrola pracovnej kópie (port `zapis.kontrola`, D-186 krok UI): čo validátor povie o zmenách z editora ešte pred
 * uložením, bez zápisu jediného bajtu. Rovnaké zmeny ako pri uložení sa aplikujú v pamäti, texty idú loaderu namiesto
 * uložených, graf sa rozlíši a beží validátor. `nova` (typ, id, nazov, data) pridá poznámku, ktorá ešte neexistuje,
 * zo šablóny typu, takže dialóg novej poznámky sa pýta registra pravidiel, nie druhej kópie v schéme (U16, Q43).
 */

import { serializuj } from "./blocks";
import { LIBRARY_FILE, Library, loadLibraryGraph } from "./graph";
import { loadFile, type Diagnostic } from "./loader";
import { validuj } from "./validator";
import { diag, kandidat, saveNote, type NewNote, type Sklad, type Zmena } from "./write";

export interface VysledokKontroly {
  ok: boolean;
  odmietnute: string[];
  diagnostiky: Diagnostic[];
}

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export async function kontrola(sklad: Sklad, zmeny: Zmena[], nova: Record<string, unknown> | null = null): Promise<VysledokKontroly> {
  const vsetky = await sklad.texty();
  const kniznica = loadLibraryGraph(vsetky);
  const texty: Record<string, string> = {};
  const odmietnute: string[] = [];
  const problemy: Diagnostic[] = [];
  const podla = new Map<string, Zmena[]>();
  for (const z of zmeny) podla.set(z.id, [...(podla.get(z.id) ?? []), z]);

  for (const [nid, zoznam] of podla) {
    const n = kniznica.poznamky.get(nid);
    if (!n) {
      odmietnute.push(nid);
      problemy.push(diag(nid, "", "poznámka s týmto ID v knižnici nie je", ""));
      continue;
    }
    try {
      const [t, chyby] = saveNote(n, zoznam);
      if (chyby.length) {
        odmietnute.push(nid);
        problemy.push(...chyby);
        continue;
      }
      texty[n.rel] = t;
    } catch (e) {
      odmietnute.push(nid);
      problemy.push(diag(nid, "", `zmena sa nedá zapísať: ${e instanceof Error ? e.message : String(e)}`, n.rel));
    }
  }

  const pracovna = new Library();
  pracovna.overVerziu(vsetky[LIBRARY_FILE]);
  for (const rel of Object.keys(vsetky).filter((r) => r !== LIBRARY_FILE).sort()) pracovna.pridaj(loadFile(rel, texty[rel] ?? vsetky[rel]));

  if (nova) {
    const nid = text(nova.id);
    const p: NewNote = { typ: text(nova.typ), id: nid, nazov: text(nova.nazov), data: (nova.data as Record<string, unknown>) ?? {}, vrstva: text(nova.vrstva) || "zadanie", balik: (nova.balik as string | null | undefined) ?? null };
    let k: ReturnType<typeof kandidat> | null = null;
    try {
      k = kandidat(p);
    } catch (e) {
      odmietnute.push(nid || "?");
      problemy.push(diag(nid, "/id", `kandidát sa nedá zostaviť: ${e instanceof Error ? e.message : String(e)}`, ""));
    }
    if (k) {
      if (kniznica.poznamky.has(nid) || kniznica.globalne_pod.has(nid)) {
        odmietnute.push(nid);
        problemy.push(diag(nid, "/id", `ID '${nid}' už v knižnici je`, ""));
      } else if (await sklad.existuje(k.rel)) {
        odmietnute.push(nid);
        problemy.push(diag(nid, "/id", `súbor ${k.rel} už existuje`, ""));
      } else pracovna.pridaj(loadFile(k.rel, serializuj(k.doc)));
    }
  }

  pracovna.rozlis();
  return { ok: !odmietnute.length, odmietnute, diagnostiky: [...validuj(pracovna), ...problemy] };
}
