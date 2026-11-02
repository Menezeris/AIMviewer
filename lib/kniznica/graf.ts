/**
 * Graf knižnice (port `assetin/engine/graf.py`, D-186 krok 4a): indexy nad načítanými poznámkami, odkazy s
 * rozlíšeným cieľom, kotvy, verzia schémy a diagnostiky grafu (A4 duplicitné ID, A10 verzia, B1 visiaci odkaz,
 * B2 kotva, B3 typ cieľa).
 */

import { load as yamlLoad } from "js-yaml";

import { nacitajSubor, type Diagnostika, type PodZaznam, type Poznamka } from "./loader";
import { odkazyModelu, odkazySchemy, type OdkazMeta } from "./projekcia";
import { jsonSchema } from "./schema/jsonSchema";
import { SCHEMY } from "./schema/modely";

export const KNIZNICA_SUBOR = "KNIZNICA.md";
export const SCHEMA_VERZIA = "1.5";
const GLOBALNE_POD_ZAZNAMY = ["STD-", "GEO-"];
const POD_SCHEMY: Record<string, Record<string, unknown>> = {};
const podSchema = (druh: string) => (POD_SCHEMY[druh] ??= jsonSchema(SCHEMY[`pod-${druh}` as keyof typeof SCHEMY]));

/** `slug` z Pythonu: `re.sub(r"[^\w]+", "-", text.lower()).strip("-")` s Unicode `\w`. */
export const slug = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, "-").replace(/^-+|-+$/g, "");

export interface OdkazGrafu {
  zdroj: string;
  pointer: string;
  link: { ciel: string; kotva: string | null; alias: string | null; raw: string };
  cielove_typy: string[];
  kotva_politika: string;
  ciel: string | null;
  ciel_typ: string | null;
  kotva_ok: boolean | null;
  riadok: number | null;
}

export const idPoznamky = (n: Poznamka): string | null => {
  const id = n.model?.id ?? n.data.id;
  if (id) return String(id);
  return n.umiestnenie?.id ?? null;
};
export const typPoznamky = (n: Poznamka): string | null => (n.data.typ as string | undefined) || n.umiestnenie?.typ || null;

export class Kniznica {
  poznamky = new Map<string, Poznamka>();
  vsetky: Poznamka[] = [];
  pod_zaznamy = new Map<string, PodZaznam>(); // `${rodic}\u0000${id}`
  pod_zaznamy_poradie: Array<[string, string, PodZaznam]> = [];
  globalne_pod = new Map<string, PodZaznam>();
  kotvy = new Map<string, Record<string, string>>();
  odkazy: OdkazGrafu[] = [];
  diagnostiky: Diagnostika[] = [];
  schema_verzia: string | null = null;
  private memo = new Map<string, Map<string, unknown[]>>();

  /** `over_verziu`: `KNIZNICA.md` nesie `schema_verzia` enginu (A10). */
  overVerziu(text: string | undefined) {
    if (text === undefined) {
      this.diagnostiky.push({ note_id: null, json_pointer: "", uroven: "E", kod: "A10", sprava: `chýba ${KNIZNICA_SUBOR} (schema_verzia)`, subor: KNIZNICA_SUBOR, riadok: null });
      return;
    }
    const parts = text.split("---\n");
    let data: unknown = null;
    if (parts.length >= 3) {
      try {
        data = yamlLoad(parts[1]);
      } catch {
        data = null;
      }
    }
    const raw = data && typeof data === "object" ? (data as Record<string, unknown>).schema_verzia : undefined;
    const v = raw === undefined || raw === null ? "" : String(raw);
    this.schema_verzia = v;
    if (v !== SCHEMA_VERZIA) {
      this.diagnostiky.push({ note_id: null, json_pointer: "/schema_verzia", uroven: "E", kod: "A10", sprava: `schema_verzia '${v}' != verzia enginu '${SCHEMA_VERZIA}'`, subor: KNIZNICA_SUBOR, riadok: null });
    }
  }

  pridaj(n: Poznamka) {
    this.memo.clear();
    this.vsetky.push(n);
    this.diagnostiky.push(...n.diagnostiky);
    const nid = idPoznamky(n);
    if (nid === null) return;
    if (this.poznamky.has(nid)) {
      this.diagnostiky.push({ note_id: nid, json_pointer: "/id", uroven: "E", kod: "A4", sprava: `duplicitné ID (aj v ${this.poznamky.get(nid)!.rel})`, subor: n.rel, riadok: null });
      return;
    }
    this.poznamky.set(nid, n);
    const kotvy: Record<string, string> = {};
    for (const pz of n.pod_zaznamy) {
      this.pod_zaznamy.set(`${nid}\u0000${pz.id}`, pz);
      this.pod_zaznamy_poradie.push([nid, pz.id, pz]);
      kotvy[pz.id] = "pod";
      if (GLOBALNE_POD_ZAZNAMY.some((p) => pz.id.startsWith(p))) {
        if (this.globalne_pod.has(pz.id) || this.poznamky.has(pz.id)) {
          this.diagnostiky.push({ note_id: nid, json_pointer: `#${pz.id}`, uroven: "E", kod: "A4", sprava: `duplicitné globálne ID pod-záznamu ${pz.id}`, subor: n.rel, riadok: pz.nadpis.riadok + 1 });
        }
        this.globalne_pod.set(pz.id, pz);
      }
    }
    const ulohy = Array.isArray(n.data.ulohy) ? (n.data.ulohy as unknown[]) : [];
    for (const u of ulohy) {
      if (u && typeof u === "object" && !Array.isArray(u) && (u as Record<string, unknown>).id) kotvy[String((u as Record<string, unknown>).id)] = "uloha";
    }
    for (const b of n.dokument.telo) {
      if (b.druh !== "Nadpis") continue;
      if (!(b.text in kotvy)) kotvy[b.text] = "nadpis";
      const s = slug(b.text);
      if (!(s in kotvy)) kotvy[s] = "nadpis";
    }
    this.kotvy.set(nid, kotvy);
  }

  /** `rozlis`: odkazy z typovaných modelov a pod-záznamov s rozlíšeným cieľom a diagnostikami B1-B3. */
  rozlis() {
    this.memo.clear();
    this.odkazy = [];
    for (const n of this.vsetky) {
      const nid = idPoznamky(n);
      if (!n.model || nid === null) continue;
      for (const l of odkazyModelu(String(n.model.typ), n.model)) {
        const top = l.pointer.startsWith("/") ? l.pointer.split("/")[1] : "";
        const o = this.odkaz(nid, l.pointer, l, top in n.riadky ? n.riadky[top] + 1 : null);
        this.rozlisJeden(o, n);
        this.odkazy.push(o);
      }
      for (const pz of n.pod_zaznamy) {
        if (!pz.model) continue;
        for (const l of odkazySchemy(podSchema(pz.druh), pz.model as Record<string, unknown>)) {
          const o = this.odkaz(nid, `#${pz.id}${l.pointer}`, l, pz.blok.riadok + 2);
          this.rozlisJeden(o, n);
          this.odkazy.push(o);
        }
      }
    }
  }

  private odkaz(zdroj: string, pointer: string, l: OdkazMeta, riadok: number | null): OdkazGrafu {
    return {
      zdroj,
      pointer,
      link: { ciel: l.ciel, kotva: l.kotva, alias: l.alias, raw: l.raw },
      cielove_typy: Array.isArray(l.meta.cielove_typy) ? (l.meta.cielove_typy as string[]) : [],
      kotva_politika: typeof l.meta.kotva === "string" ? l.meta.kotva : "ziadna",
      ciel: null,
      ciel_typ: null,
      kotva_ok: null,
      riadok,
    };
  }

  private rozlisJeden(o: OdkazGrafu, n: Poznamka) {
    const c = o.link.ciel;
    const d = (uroven: "E" | "W", kod: string, sprava: string) =>
      this.diagnostiky.push({ note_id: o.zdroj, json_pointer: o.pointer, uroven, kod, sprava, subor: n.rel, riadok: o.riadok });
    if (this.poznamky.has(c)) {
      o.ciel = c;
      o.ciel_typ = typPoznamky(this.poznamky.get(c)!);
    } else if (this.globalne_pod.has(c)) {
      o.ciel = c;
      o.ciel_typ = this.globalne_pod.get(c)!.druh === "profil" ? "GEO" : "STD";
    } else {
      d("W", "B1", `visiaci odkaz ${o.link.raw}`);
      return;
    }
    if (o.cielove_typy.length && !o.cielove_typy.includes(o.ciel_typ ?? "")) d("E", "B3", `${o.link.raw}: cieľ je ${o.ciel_typ}, povolené ${o.cielove_typy.join(", ")}`);
    if (o.link.kotva) {
      o.kotva_ok = o.link.kotva in (this.kotvy.get(c) ?? {});
      if (!o.kotva_ok) d("W", "B2", `${o.link.raw}: kotva #${o.link.kotva} v ${c} neexistuje`);
    } else if (o.kotva_politika === "povinna") d("E", "B2", `${o.link.raw}: pole vyžaduje kotvu`);
  }

  private index(meno: "typ" | "ciel" | "zdroj"): Map<string, unknown[]> {
    let idx = this.memo.get(meno);
    if (idx) return idx;
    idx = new Map();
    const pridaj = (k: string, v: unknown) => idx!.set(k, [...(idx!.get(k) ?? []), v]);
    if (meno === "typ") for (const n of this.vsetky) pridaj(typPoznamky(n) ?? "", n);
    else if (meno === "ciel") for (const o of this.odkazy) if (o.ciel !== null) pridaj(o.ciel, o);
    else for (const o of this.odkazy) pridaj(o.zdroj, o);
    this.memo.set(meno, idx);
    return idx;
  }

  podlaTypu = (typ: string) => [...((this.index("typ").get(typ) ?? []) as Poznamka[])];
  odkazyNa = (ciel: string) => [...((this.index("ciel").get(ciel) ?? []) as OdkazGrafu[])];
  odkazyZ = (zdroj: string) => [...((this.index("zdroj").get(zdroj) ?? []) as OdkazGrafu[])];
  kotvyPre = (nid: string) => this.kotvy.get(nid) ?? {};
}

/** `nacitaj_kniznicu`: všetky poznámky (bez `KNIZNICA.md`) zoradené podľa cesty, verzia schémy, odkazy. */
export function nacitajKniznicuGraf(texty: Record<string, string>): Kniznica {
  const k = new Kniznica();
  k.overVerziu(texty[KNIZNICA_SUBOR]);
  for (const rel of Object.keys(texty).filter((r) => r !== KNIZNICA_SUBOR).sort()) k.pridaj(nacitajSubor(rel, texty[rel]));
  k.rozlis();
  return k;
}
