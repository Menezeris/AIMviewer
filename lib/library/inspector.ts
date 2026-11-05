/**
 * [V22] Inšpektor (port `assetin/engine/inspektor.py`, D-186 krok 4c): pôvod hodnoty položky (vlastné, prepis ER,
 * predvoľba §14b, pravidlo STD, definícia, slovník, profil GEO), pravidlá, ktoré na poznámku dopadajú, s dôvodom,
 * a dosah zmeny (tranzitívne). Číta len graf, nič nezapisuje.
 */

import { noteType, type Library } from "./graph";
import { klucPolozky } from "./graph-json";
import { jednotkyVymeny } from "./chain";

type M = Record<string, unknown>;

const SIRENIE = new Set(["zapnute", "pravidlo", "hodnoty_ref", "definicia_ref", "obsahuje", "spustacia_udalost", "uc", "pre_task", "profil"]);
const PREPISOVATELNE = ["povinnost", "hodnoty", "hodnoty_ref", "rozsah", "zavaznost"];
const PORADIE_POVODU = ["prepis", "slovnik", "definicia", "pravidlo", "profil", "predvolba", "vlastne"];
/** `predvolby` (§14b): zložka -> predvolené `overenie`; predvolená záväznosť. */
const OVERENIE: Record<string, string> = { alfanumerika: "IDS", klasifikacia: "IDS", clenenie: "IDS", geometria: "manual", dokumentacia: "manual", kontajner: "manual", federacia: "manual" };
const ZAVAZNOST = "musi";

const obj = (v: unknown): M | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as M) : null);
const zoznam = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const pravda = (v: unknown) => !(v === null || v === undefined || v === false || v === 0 || v === "" || (Array.isArray(v) && v.length === 0));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Povod {
  druh: string;
  popis: string;
  zdroj: string | null;
  kotva: string | null;
  povodna_hodnota: unknown;
}
const povod = (druh: string, popis: string, zdroj: string | null = null, kotva: string | null = null, povodna: unknown = null): Povod => ({ druh, popis, zdroj, kotva, povodna_hodnota: povodna });

/** `_odkaz`: (cieľ, kotva) wikilinku v texte. */
function odkaz(v: unknown): [string | null, string | null] {
  if (v === null || v === undefined) return [null, null];
  const t = String(v);
  if (t.startsWith("[[")) {
    const vnutro = t.slice(2, -2).split("|")[0];
    const i = vnutro.indexOf("#");
    return i >= 0 ? [vnutro.slice(0, i), vnutro.slice(i + 1)] : [vnutro, null];
  }
  return [null, null];
}

/** `model_dump(exclude_none=True)`. */
function bezNull(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(bezNull);
  const o = obj(v);
  if (!o) return v;
  return Object.fromEntries(Object.entries(o).filter(([, x]) => x !== null && x !== undefined).map(([k, x]) => [k, bezNull(x)]));
}

function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(text).join(", ");
  const o = obj(v);
  if (o) return Object.entries(o).map(([a, b]) => `${a}: ${pyStr(b)}`).join(", ");
  return pyStr(v);
}
/** `str()` v Pythone pre skaláry a zoznamy vnútri `_text` slovníka. */
function pyStr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (Array.isArray(v)) return `[${v.map((x) => (typeof x === "string" ? `'${x}'` : pyStr(x))).join(", ")}]`;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return String(v);
}

function suhrnPovodu(p: Record<string, Povod>): Povod {
  for (const d of PORADIE_POVODU) for (const x of Object.values(p)) if (x.druh === d) return x;
  return povod("vlastne", "vlastné — napísané na tejto položke");
}

function polozkaPodla(model: M, kluc: string): M | null {
  return (zoznam(model.alfanumerika).find((p) => klucPolozky(p as M) === kluc) as M | undefined) ?? null;
}

/** `povod_hodnoty`: pôvod každej hodnoty položky IU-O v kontexte výmeny (alebo bez nej). */
export function povodHodnoty(k: Library, iuId: string, polozka: string, erId: string | null = null) {
  const iu = k.poznamky.get(iuId);
  if (!iu || !iu.model) return null;
  const zaklad = polozkaPodla(iu.model, polozka);
  if (!zaklad) return null;
  const surove = bezNull(zaklad) as M;
  const hodnota: M = { ...surove };
  const p: Record<string, Povod> = {};
  for (const [kl, h] of Object.entries(surove)) if (h !== null) p[kl] = povod("vlastne", `vlastné — \`${kl}\` je napísané na položke`);
  let [c, kt] = odkaz(zaklad.hodnoty_ref);
  if (c) p.hodnoty = povod("slovnik", `slovník ${c}${kt ? `#${kt}` : ""} — hodnoty sa neopisujú (V14)`, c, kt);
  [c, kt] = odkaz(zaklad.definicia_ref);
  if (c) p.definicia_ref = povod("definicia", `definícia ${c} — meracie pravidlo hodnoty (V2)`, c, kt);
  [c, kt] = odkaz(zaklad.pravidlo);
  if (c) p.vzor = povod("pravidlo", `pravidlo ${c}${kt ? `#${kt}` : ""} — konvencia, nie kópia`, c, kt);
  if (zaklad.overenie === null || zaklad.overenie === undefined) {
    hodnota.overenie = OVERENIE.alfanumerika;
    p.overenie = povod("predvolba", `predvoľba §14b — alfanumerika ⇒ ${OVERENIE.alfanumerika}`);
  }
  if (zaklad.zavaznost === null || zaklad.zavaznost === undefined) {
    const z = iu.model.zavaznost_predvolena;
    if (z !== null && z !== undefined) {
      hodnota.zavaznost = z;
      p.zavaznost = povod("predvolba", `predvolená záväznosť ${iuId} — \`zavaznost_predvolena: ${z}\``, iuId);
    } else {
      hodnota.zavaznost = ZAVAZNOST;
      p.zavaznost = povod("predvolba", `predvoľba §14 — ${ZAVAZNOST}`);
    }
  }
  const er = erId ? k.poznamky.get(erId) : undefined;
  if (er && er.model) {
    for (const x of zoznam(er.model.prepisy)) {
      const pr = x as M;
      if (odkaz(pr.iu)[0] !== iuId || pr.polozka !== polozka) continue;
      for (const kl of PREPISOVATELNE) {
        const nova = pr[kl];
        if (nova === null || nova === undefined) continue;
        const predtym = hodnota[kl] ?? null;
        const nj = bezNull(nova);
        hodnota[kl] = nj;
        p[kl] = povod("prepis", `prepis ${erId} — v knižnici ${text(predtym) || "nenastavené"}, pre túto výmenu ${text(nj)}`, erId, null, predtym);
      }
    }
  }
  return { iu: iuId, polozka, er: erId, hodnota, povod: p, suhrn: suhrnPovodu(p) };
}

export function povodFiltra(k: Library, iuId: string) {
  const iu = k.poznamky.get(iuId);
  if (!iu || !iu.model) return [];
  return zoznam(iu.model.filter).map((x, i) => {
    const f = x as M;
    const [c, kt] = odkaz(f.hodnoty_ref);
    const p = c ? povod("slovnik", `slovník ${c}${kt ? `#${kt}` : ""} — hodnoty sa neopisujú (V14)`, c, kt) : povod("vlastne", "vlastné — hodnoty sú napísané vo filtri");
    return { index: i, facet: f.facet ?? null, povod: p };
  });
}

export function povodGeometrie(k: Library, iuId: string, erId: string | null = null): Povod | null {
  const iu = k.poznamky.get(iuId);
  if (!iu || !iu.model) return null;
  const geo = obj(iu.model.geometria);
  if (!geo) return null;
  const er = erId ? k.poznamky.get(erId) : undefined;
  if (er && er.model) {
    for (const x of zoznam(er.model.prepisy)) {
      const pr = x as M;
      if (odkaz(pr.iu)[0] === iuId && pr.geometria_profil !== null && pr.geometria_profil !== undefined) {
        const [c] = odkaz(pr.geometria_profil);
        const [povodny] = odkaz(geo.profil);
        return povod("prepis", `prepis ${erId} — profil ${povodny || "nenastavený"} → ${c}`, erId, null, povodny);
      }
    }
  }
  const [c] = odkaz(geo.profil);
  if (c) return povod("profil", `zdedené z ${c} — explicitný aspekt profil poráža`, c);
  return povod("vlastne", "vlastné — aspekty sú napísané na poznámke");
}

function entityPravidla(p: M): string[] {
  const app = obj(p.applicability);
  if (!app || app.entity === null || app.entity === undefined) return [];
  return (Array.isArray(app.entity) ? app.entity : [app.entity]).map((e) => String(e).toUpperCase());
}

/** `dopadajuce_pravidla`: pravidlá STD, ktoré na poznámku dopadajú, s dôvodom (V22.2). */
export function affectingRules(k: Library, noteId: string, erId: string | null = null) {
  const n = k.poznamky.get(noteId);
  if (!n || !n.model) return [];
  const ifc = obj(n.model.objekt)?.ifc_entita;
  const entita = ifc !== null && ifc !== undefined ? String(ifc).toUpperCase() : null;
  const rozsahTypu = ({ "IU-O": "objekt", "IU-C": "kontajner" } as Record<string, string>)[noteType(n) ?? ""] ?? null;
  const zPolozky = new Map<string, string>();
  for (const o of k.odkazyZ(noteId)) {
    if (o.ciel === null || !["STD", "GEO"].includes(o.ciel_typ ?? "")) continue;
    const casti = o.pointer.split("/").filter(Boolean);
    if (!zPolozky.has(o.ciel)) zPolozky.set(o.ciel, casti[0] ?? "");
  }
  const zapnute = new Map<string, string>();
  for (const er of k.podlaTypu("ER")) {
    const eid = er.model?.id as string | undefined;
    if (!eid || !er.model) continue;
    if (erId !== null && eid !== erId) continue;
    const nesie = jednotkyVymeny(k, eid).vsetky.includes(noteId);
    if (erId === null && !nesie) continue;
    for (const l of zoznam(er.model.zapnute)) {
      const c = odkaz(l)[0];
      if (c && !zapnute.has(c)) zapnute.set(c, eid);
    }
  }
  const out: Array<Record<string, unknown>> = [];
  for (const [rodic, , pz] of k.pod_zaznamy_poradie) {
    if (pz.druh !== "pravidlo" || !pz.model) continue;
    const p = pz.model as M;
    const entity = entityPravidla(p);
    const sediRozsah = rozsahTypu !== null && p.rozsah === rozsahTypu;
    const sediEntita = !entity.length || (entita !== null && entity.includes(entita));
    let dovod: string;
    let erZdroj: string | null = null;
    if (zPolozky.has(pz.id)) dovod = `z položky ${zPolozky.get(pz.id)}`;
    else if (!(sediRozsah && sediEntita)) continue;
    else if (zapnute.has(pz.id)) {
      dovod = `zapnuté v ${zapnute.get(pz.id)}`;
      erZdroj = zapnute.get(pz.id)!;
    } else if (p.plati === "vzdy") dovod = "vždy";
    else continue;
    out.push({ pravidlo: pz.id, poznamka: rodic, nazov: p.nazov, rozsah: p.rozsah, plati: p.plati, overenie: p.overenie ?? null, dovod, er: erZdroj });
  }
  out.sort((a, b) => Number(a.dovod !== "vždy") - Number(b.dovod !== "vždy") || cmp(String(a.pravidlo), String(b.pravidlo)));
  return out;
}

const identita = (k: Library, noteId: string) => new Set([noteId, ...(k.poznamky.get(noteId)?.pod_zaznamy.map((p) => p.id) ?? [])]);
const siriSa = (pointer: string) => pointer.split("/").some((s) => SIRENIE.has(s));

/** `spatne_odkazy`: kto sem odkazuje. */
export function spatneOdkazy(k: Library, noteId: string) {
  const out: Array<{ id: string; typ: string | null; pole: string; cez: string | null }> = [];
  const videne = new Set<string>();
  for (const c of [...identita(k, noteId)].sort()) {
    for (const o of k.odkazyNa(c)) {
      const pole = o.pointer.replace(/^\/+/, "").split("/")[0];
      const kl = `${o.zdroj}\u0000${pole}`;
      if (videne.has(kl)) continue;
      videne.add(kl);
      const z = k.poznamky.get(o.zdroj);
      out.push({ id: o.zdroj, typ: z ? noteType(z) : null, pole, cez: c !== noteId ? c : null });
    }
  }
  out.sort((a, b) => cmp(a.id, b.id) || cmp(a.pole, b.pole));
  return out;
}

/** Slovenské počty: 1 -> `jedna`, 2-4 -> `malo`, 0 a 5+ -> `vela` (ak nie je, `malo`). */
function mnozne(pocet: number, jedna: string, malo: string, vela?: string): string {
  if (pocet === 1) return `${pocet} ${jedna}`;
  if (vela === undefined || (pocet >= 2 && pocet <= 4)) return `${pocet} ${malo}`;
  return `${pocet} ${vela}`;
}

/** `dopad_zmeny`: poznámky a výmeny, ktoré zmena zasiahne (V22.3). */
export function dopadZmeny(k: Library, noteId: string) {
  const zasiahnute = new Set<string>();
  const fronta = [noteId];
  const videne = new Set([noteId]);
  while (fronta.length) {
    const a = fronta.pop()!;
    for (const c of identita(k, a)) {
      for (const o of k.odkazyNa(c)) {
        if (!siriSa(o.pointer) || videne.has(o.zdroj)) continue;
        videne.add(o.zdroj);
        zasiahnute.add(o.zdroj);
        fronta.push(o.zdroj);
      }
    }
  }
  const poznamky = [...zasiahnute].sort();
  const vymeny = poznamky.filter((i) => k.poznamky.has(i) && noteType(k.poznamky.get(i)!) === "ER");
  const ostatne = poznamky.filter((i) => !vymeny.includes(i));
  let veta: string;
  if (vymeny.length) {
    veta = `dotkne sa ${mnozne(vymeny.length, "výmeny", "výmen")}`;
    if (ostatne.length) veta += ` cez ${mnozne(ostatne.length, "poznámku", "poznámky", "poznámok")}`;
  } else if (ostatne.length) veta = `dotkne sa ${mnozne(ostatne.length, "poznámky", "poznámok")}`;
  else veta = "obsah tejto poznámky sa ďalej nededí";
  return { poznamky, vymeny, veta };
}

const ucVymeny = (k: Library, ucId: string) => k.podlaTypu("ER").filter((er) => er.model?.id && zoznam(er.model.uc).some((x) => odkaz(x)[0] === ucId));

/** `pravidla_uc`: pravidlá účelu užitia cez jeho výmeny (kolo 3 §5). */
export function pravidlaUc(k: Library, ucId: string) {
  const zlucene = new Map<string, Record<string, unknown>>();
  for (const er of ucVymeny(k, ucId)) {
    const eid = String(er.model!.id);
    for (const nid of jednotkyVymeny(k, eid).vsetky) {
      for (const r of affectingRules(k, nid, eid)) {
        const kl = String(r.pravidlo);
        if (!zlucene.has(kl)) zlucene.set(kl, { ...r, jednotky: [], zaklad: r.dovod });
        const z = zlucene.get(kl)!;
        if (!(z.jednotky as string[]).includes(nid)) (z.jednotky as string[]).push(nid);
      }
    }
  }
  const out: M[] = [...zlucene.values()].map((z) => {
    const { zaklad, ...rest } = z;
    return { ...rest, dovod: `${zaklad} · ${(z.jednotky as string[]).join(", ")}` };
  });
  out.sort((a, b) => Number(!String(a.dovod).startsWith("vždy")) - Number(!String(b.dovod).startsWith("vždy")) || cmp(String(a.pravidlo), String(b.pravidlo)));
  return out;
}

function dovodJednotky(k: Library, er: M, nid: string): string {
  const c = k.poznamky.get(nid);
  const polozky = c && c.model ? zoznam(c.model.alfanumerika).length : 0;
  const prepisy = zoznam(er.prepisy).filter((pr) => odkaz((pr as M).iu)[0] === nid);
  const casti = polozky ? [mnozne(polozky, "položka", "položky", "položiek")] : [];
  if (prepisy.length) casti.push(mnozne(prepisy.length, "prepis", "prepisy", "prepisov"));
  return casti.join(" · ");
}

const SPUSTA: Record<string, string> = { UC: "spúšťa účel užitia", ER: "spúšťa výmenu" };

/** `prazdny_stav`: prvý blok inšpektora pre poznámku bez položiek, podľa typu (kolo 3 §5). */
export function emptyState(k: Library, noteId: string) {
  const n = k.poznamky.get(noteId);
  if (!n || !n.model) return null;
  if (pravda(n.model.alfanumerika) || (n.model.geometria !== null && n.model.geometria !== undefined)) return null;
  const typ = noteType(n) ?? "";
  const riadky: Array<Record<string, unknown>> = [];
  const spat = spatneOdkazy(k, noteId);
  const typZdroja = (i: string) => (k.poznamky.has(i) ? noteType(k.poznamky.get(i)!) ?? "" : "");
  if (typ === "UC") {
    for (const er of ucVymeny(k, noteId)) {
      const eid = String(er.model!.id);
      const jednotky = jednotkyVymeny(k, eid).vsetky;
      const dodanie = zoznam(er.model!.spustacia_udalost).map((x) => odkaz(x)[0]).find((x) => x) ?? null;
      let dovod = mnozne(jednotky.length, "jednotka", "jednotky", "jednotiek");
      if (dodanie) dovod += ` · pri ${dodanie}`;
      riadky.push({ id: eid, typ: "ER", dovod });
    }
    return { nadpis: "VÝMENY TOHTO ÚČELU", prazdno: "Zatiaľ žiadna — na účel užitia neukazuje `uc::` ani jednej výmeny.", riadky };
  }
  if (typ === "EV") {
    for (const o of spat) if (o.pole === "spustacia_udalost") riadky.push({ id: o.id, typ: o.typ, dovod: SPUSTA[o.typ ?? ""] ?? "spúšťa" });
    for (const o of k.odkazyZ(noteId)) if (o.pointer.replace(/^\/+/, "").split("/")[0] === "vyvolava" && o.ciel) riadky.push({ id: o.ciel, typ: typZdroja(o.ciel), dovod: "vyvoláva udalosť" });
    return { nadpis: "ČO TÁTO UDALOSŤ SPÚŠŤA", prazdno: "Zatiaľ nič — udalosť nie je spúšťačom žiadneho účelu užitia ani výmeny.", riadky };
  }
  if (typ === "ACT") {
    for (const o of spat) riadky.push({ id: o.id, typ: o.typ, dovod: o.pole });
    riadky.sort((a, b) => cmp(String(a.dovod), String(b.dovod)) || cmp(String(a.id), String(b.id)));
    return { nadpis: "V AKEJ ROLE VYSTUPUJE", prazdno: "Zatiaľ v žiadnej — na aktéra neukazuje ani jedno pole.", riadky };
  }
  if (typ === "GOAL") {
    for (const o of spat) if (o.pole === "podporuje_ciel") riadky.push({ id: o.id, typ: o.typ, dovod: "podporuje cieľ" });
    return { nadpis: "KTORÉ ÚČELY HO PODPORUJÚ", prazdno: "Zatiaľ žiadny — na cieľ neukazuje `podporuje_ciel::` ani jedného účelu užitia.", riadky };
  }
  if (typ === "ER") {
    const j = jednotkyVymeny(k, noteId);
    for (const c of j.kontajnery) {
      riadky.push({ id: c, typ: "IU-C", dovod: dovodJednotky(k, n.model, c) });
      for (const p of j.priradenia.get(c) ?? []) {
        const d = dovodJednotky(k, n.model, p.iu);
        const rozsah = p.ucinny_rozsah.join("+") || "bez aspektu";
        riadky.push({ id: p.iu, typ: "IU-O", cez: c, dovod: [rozsah, d].filter(Boolean).join(" · ") });
      }
    }
    for (const nid of j.volne) riadky.push({ id: nid, typ: "IU-O", dovod: ["bez kontajnera", dovodJednotky(k, n.model, nid)].filter(Boolean).join(" · ") });
    return { nadpis: "ČO VÝMENA NESIE", prazdno: "Zatiaľ nič — `obsahuje::` je prázdne.", riadky };
  }
  if (n.pod_zaznamy.length) {
    for (const pz of n.pod_zaznamy) {
      const plati = pz.data.plati;
      riadky.push({ id: pz.id, typ: `pod-${pz.druh}`, dovod: pz.druh + (plati ? ` · platí ${plati}` : "") });
    }
    return { nadpis: "ČO TÁTO POZNÁMKA NESIE", prazdno: "", riadky };
  }
  return null;
}

/** `inspektor`: všetko, čo ukazuje pravý panel pre jednu poznámku. */
export function inspect(k: Library, noteId: string, erId: string | null = null) {
  const n = k.poznamky.get(noteId);
  const polozky: unknown[] = [];
  if (n && n.model) {
    for (const p of zoznam(n.model.alfanumerika)) {
      const pv = povodHodnoty(k, noteId, klucPolozky(p as M), erId);
      if (pv) polozky.push(pv);
    }
  }
  const geo = povodGeometrie(k, noteId, erId);
  const pravidla = n && noteType(n) === "UC" ? pravidlaUc(k, noteId) : affectingRules(k, noteId, erId);
  return {
    id: noteId,
    er: erId,
    polozky,
    geometria: geo,
    filter: povodFiltra(k, noteId),
    pravidla,
    prazdny_stav: emptyState(k, noteId),
    odkazuje_sem: spatneOdkazy(k, noteId),
    dopad: dopadZmeny(k, noteId),
  };
}

/** `app_json._inspektor_er`: pôvod v kontexte každej výmeny, kľúč `<ER>|<jednotka>`. */
export function inspectEr(k: Library) {
  const out: Record<string, unknown> = {};
  for (const er of k.podlaTypu("ER")) {
    const eid = er.model?.id as string | undefined;
    if (!eid || !er.model) continue;
    for (const nid of jednotkyVymeny(k, eid).vsetky) out[`${eid}|${nid}`] = inspect(k, nid, eid);
  }
  return out;
}
