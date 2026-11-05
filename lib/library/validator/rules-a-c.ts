/**
 * Sekcie A (súbor, identita, vrstva), B (odkazy) a C (UC, ER, EV) validátora (port `a_identita.py`,
 * `b_odkazy.py`, `c_uc_er_ev.py`). A3-A7, A9-A11 a B1-B3 hlási loader a graf pri čítaní.
 */

import { nazovDoSuboru, premenovatelna } from "../paths";
import { idPoznamky, typPoznamky } from "../graph";
import { klucPolozky } from "../graph-json";
import type { Poznamka } from "../loader";
import { jednotkyVymeny } from "../chain";
import {
  attr,
  ciele,
  cykly,
  hodnotySOddelovacom,
  je,
  jeSlovesoPodstatne,
  link,
  obj,
  odkazyPola,
  pravda,
  pravidlo,
  pyRepr,
  pyStr,
  zorad,
  zoznam,
  zoznamM,
  type Kontext,
  type M,
} from "./context";

// ------------------------------------------------------------------------------------------------ A

const HLAVICKA = ["id", "guid", "typ", "nazov", "nazov_en", "stav", "verzia", "jazyk"];
const ODPORUCANE = ["autor", "licencia"];

pravidlo("A1", "E", { popis: "Oddeľovač `·` v štruktúrovanom zápise", zdroj: "§16.18" }, function* (ctx) {
  for (const n of ctx.k.vsetky) {
    for (const [cesta, h] of hodnotySOddelovacom(n.data)) yield ctx.diag(n, `\`·\` v štruktúrovanej hodnote ${pyRepr(h)} — rozpíš na YAML zoznam`, cesta);
    for (const pz of n.pod_zaznamy) for (const [cesta, h] of hodnotySOddelovacom(pz.data)) yield ctx.diagPod(n, pz, `\`·\` v štruktúrovanej hodnote ${pyRepr(h)} — rozpíš na YAML zoznam`, cesta);
  }
});

pravidlo("A2", "E", { popis: "Spoločná hlavička je úplná", zdroj: "§0.5, §16.12" }, function* (ctx) {
  for (const n of ctx.k.vsetky) {
    if (!n.dokument.frontmatter || !n.model) continue;
    for (const k of HLAVICKA) if (!(k in n.data)) yield ctx.diag(n, `chýba pole hlavičky \`${k}\` (§0.5)`, ["id"]);
    for (const k of ODPORUCANE) if (!(k in n.data)) yield ctx.diag(n, `chýba odporúčané pole \`${k}\` (29481-3 authoring)`, ["id"], "W");
  }
});

const DOSADENIE: Record<string, Array<[string, string]>> = {
  GOAL: [
    ["termin", "`termin` je dosadenie — cieľ v knižnici je bez termínu (V19)"],
    ["aktivum", "`aktivum` je dosadenie — cieľ v knižnici neukazuje na konkrétne aktívum (V19)"],
  ],
  EV: [["datum", "`datum` je dosadenie — udalosť v knižnici je bez dátumu (V19)"]],
  ACT: [
    ["osoby", "`osoby` sú dosadenie — v knižnici žije funkcia, nie meno (V19)"],
    ["zmluvne_oznacenie", "`zmluvne_oznacenie` je dosadenie — mapuje ho PROJ.strany v projekte (V19)"],
  ],
};

pravidlo("A8", "E", { popis: "Definícia vs. dosadenie: knižnica nenesie termíny, osoby ani dátumy", zdroj: "§16.6 V19" }, function* (ctx) {
  for (const [n, m] of ctx.typu("EV", "ACT", "PROJ", "GOAL")) {
    const vrstva = ctx.vrstva(n);
    const typ = typPoznamky(n) ?? "";
    if (typ === "PROJ" && vrstva !== "projekty") {
      yield ctx.diag(n, `typ PROJ je dosadenie — patrí len do projekty/, nie do ${vrstva}/`, ["typ"]);
      continue;
    }
    if (vrstva !== "zadanie") continue;
    for (const [k, sprava] of DOSADENIE[typ] ?? []) if (pravda(m[k])) yield ctx.diag(n, sprava, [k]);
  }
});

pravidlo("A12", "W", { popis: "`pouzitie` = sloveso + podstatné meno", zdroj: "§16.12" }, function* (ctx) {
  for (const [n, m] of ctx.typu("UC")) {
    for (const [i, p] of zoznam(m.pouzitie).entries()) {
      if (!jeSlovesoPodstatne(String(p))) yield ctx.diag(n, `\`${p}\` nevyzerá ako sloveso + podstatné meno (napr. ZamerajPriestory)`, ["pouzitie", i]);
    }
  }
});

pravidlo("A14", "I", { popis: "Názov súboru sedí s `nazov`", zdroj: "§0.4, DATA-MODEL §4" }, function* (ctx) {
  for (const n of ctx.k.vsetky) {
    const um = n.umiestnenie;
    if (!n.model || !um || !premenovatelna(um.typ, um.id)) continue;
    const vSubore = um.nazov_zo_suboru || "";
    if (vSubore !== nazovDoSuboru(n.model.nazov as string | null)) {
      yield ctx.diag(n, `názov súboru „${vSubore || "—"}“ sa líši od \`nazov\` — editor premenuje pri zmene názvu`, ["nazov"]);
    }
  }
});

pravidlo("A13", "W", { popis: "Publikovaná poznámka má guid", zdroj: "nové" }, function* (ctx) {
  for (const n of ctx.k.vsetky) {
    if (!n.model) continue;
    const stav = n.model.stav;
    if ((stav === "PUB" || stav === "WDRL") && !pravda(n.model.guid)) yield ctx.diag(n, `stav ${stav} bez \`guid\` — doplní ho nástroj pred publikovaním`, ["guid"]);
  }
});

// ------------------------------------------------------------------------------------------------ B

const TAGY = ["#aktivum", "#proces"];
const CYKLICKE: Array<[string, string[], string[]]> = [
  ["nadradene_pri_rozpore", ["IU-O", "IU-C"], ["nadradene_pri_rozpore"]],
  ["odvodene_z", ["IU-O", "IU-C", "DEF", "PROP"], ["odvodene_z"]],
  ["poradie kontajnerov", ["IU-C"], ["nadvaznost"]],
  ["nadradeny_uc", ["UC"], ["nadradeny_uc"]],
  ["prispieva_k", ["GOAL"], ["prispieva_k"]],
  ["precondition", ["ER"], ["precondition"]],
];

/** HTML komentár vedľa inline poľa (vysvetľuje ukotvenie literálom). */
function maPoznamku(n: Poznamka, kluc: string): boolean {
  const telo = n.dokument.telo;
  return telo.some((b, i) => b.druh === "InlinePole" && b.kluc === kluc && telo.slice(Math.max(0, i - 1), i + 2).some((x) => x.druh === "HtmlKomentar"));
}

pravidlo("B4", "E", { popis: "Literály #aktivum / #proces len vo `viaze_sa_na` a `EV.objekt`", zdroj: "§16.4" }, function* (ctx) {
  for (const n of ctx.k.vsetky) {
    if (!n.model) continue;
    for (const [nazov, hodnota] of Object.entries(n.model)) {
      const vs = Array.isArray(hodnota) ? hodnota : [hodnota];
      for (const [i, v] of vs.entries()) {
        if (!(typeof v === "string" && TAGY.includes(v))) continue;
        const cesta = Array.isArray(hodnota) ? [nazov, i] : [nazov];
        if (nazov === "objekt" && typPoznamky(n) === "EV") continue;
        if (nazov !== "viaze_sa_na") yield ctx.diag(n, `literál ${v} je prípustný len vo \`viaze_sa_na\` a \`EV.objekt\``, cesta);
        else if (!maPoznamku(n, nazov)) yield ctx.diag(n, `ukotvenie literálom ${v} bez vysvetlenia — doplň HTML komentár, prečo nie je IU-O`, cesta, "W");
      }
    }
  }
});

pravidlo("B5", "E", { popis: "Typované väzby sú acyklické", zdroj: "nové" }, function* (ctx) {
  for (const [vztah, typy, polia] of CYKLICKE) {
    const hrany = new Map<string, Set<string>>();
    const pridaj = (a: string, b: string) => {
      if (!hrany.has(a)) hrany.set(a, new Set());
      if (b) hrany.get(a)!.add(b);
    };
    for (const [n, m] of ctx.typu(...typy)) {
      const nid = idPoznamky(n);
      if (nid === null) continue;
      for (const pole of polia) {
        pridaj(nid, "");
        for (const c of ciele(m, pole)) if (c) pridaj(nid, c);
      }
    }
    if (vztah === "poradie kontajnerov") for (const [n, m] of ctx.typu("IU-C")) for (const c of ciele(m, "predchodca")) if (c) pridaj(c, idPoznamky(n) ?? "None");
    for (const cyklus of cykly(hrany)) {
      const n = ctx.poznamka(cyklus[0]);
      if (n) yield ctx.diag(n, `cyklus vo väzbe \`${vztah}\`: ${cyklus.join(" → ")}`, ["id"]);
    }
  }
});

pravidlo("B6", "W", { popis: "Inverzné páry dokladovania", zdroj: "V4" }, function* (ctx) {
  for (const [n, m] of ctx.typu("IU-C")) {
    const nid = idPoznamky(n);
    for (const [i, w] of odkazyPola(m, "dokladuje").entries()) {
      const cielova = ctx.model(w.ciel);
      if (!cielova) continue;
      if (!zoznamM(cielova.alfanumerika).some((p) => link(p.dolozene_v)?.ciel === nid)) {
        yield ctx.diag(n, `\`dokladuje:: ${w.raw}\`, ale žiadna položka v ${w.ciel} nemá \`dolozene_v: "[[${nid}]]"\``, ["dokladuje", i]);
      }
    }
  }
  for (const [n, m] of ctx.typu("IU-O")) {
    const nid = idPoznamky(n);
    for (const [i, d] of zoznamM(m.dokumentacia).entries()) {
      const dok = link(d.dok);
      const kontajner = ctx.model(dok?.ciel);
      if (!kontajner || !dok) continue;
      if (!ciele(kontajner, "viaze_sa_na").includes(nid ?? "")) {
        yield ctx.diag(n, `\`dokumentacia[].dok = ${dok.raw}\`, ale ${dok.ciel} sa neviaže späť na ${nid} (\`viaze_sa_na\`)`, ["dokumentacia", i, "dok"]);
      }
    }
  }
});

pravidlo("B7", "E", { popis: "Bare odkaz na pod-záznam bez globálne unikátneho ID", zdroj: "nové" }, function* (ctx) {
  const lokalne = new Map<string, string[]>();
  for (const [rodic, pid] of ctx.k.pod_zaznamy_poradie) if (!ctx.k.globalne_pod.has(pid)) lokalne.set(pid, [...(lokalne.get(pid) ?? []), rodic]);
  for (const o of ctx.k.odkazy) {
    if (o.ciel !== null || o.link.kotva || !lokalne.has(o.link.ciel)) continue;
    const n = ctx.poznamka(o.zdroj);
    if (!n) continue;
    const rodicia = lokalne.get(o.link.ciel)!.map((r) => `[[${r}#${o.link.ciel}]]`).join(", ");
    yield { note_id: o.zdroj, json_pointer: o.pointer, uroven: "E", kod: "B7", sprava: `${o.link.raw} je pod-záznam bez globálne unikátneho ID — odkazuj s kotvou: ${rodicia}`, subor: n.rel, riadok: o.riadok };
  }
});

// ------------------------------------------------------------------------------------------------ C

const PREPISOVATELNE = ["povinnost", "hodnoty", "hodnoty_ref", "rozsah", "zavaznost", "geometria_profil"];
const POVERENE_STRANY = ["poverena", "veduca-poverena"];
const klucePolozek = (model: M | null) => zoznamM(model?.alfanumerika).map(klucPolozky);

pravidlo("C1", "E", { popis: "Fáza udalosti spadá do fáz use case", zdroj: "§16.1" }, function* (ctx) {
  for (const [n, er] of ctx.typu("ER")) {
    const uc = ctx.model(ciele(er, "uc")[0] ?? null);
    if (!uc) continue;
    const fazyUc = new Set(zoznam(uc.faza_iso22263).map(String));
    for (const [i, w] of odkazyPola(er, "spustacia_udalost").entries()) {
      const ev = ctx.model(w.ciel);
      if (!ev) continue;
      const navyse = new Set(zoznam(ev.faza_iso22263).map(String).filter((f) => !fazyUc.has(f)));
      if (navyse.size) yield ctx.diag(n, `${w.raw} má fázu ${pyRepr(zorad(navyse))} mimo fáz ${ciele(er, "uc")[0]} (${pyRepr(zorad(fazyUc))})`, ["spustacia_udalost", i]);
    }
  }
});

pravidlo("C2", "E", { popis: "Impact spúšťa UC/PROJ, delivery spúšťa ER", zdroj: "§16.5" }, function* (ctx) {
  for (const [n, er] of ctx.typu("ER")) {
    const odkazy = odkazyPola(er, "spustacia_udalost");
    if (!odkazy.length) yield ctx.diag(n, "ER potrebuje aspoň jednu spúšťaciu udalosť typu delivery", ["spustacia_udalost"]);
    for (const [i, w] of odkazy.entries()) {
      const ev = ctx.model(w.ciel);
      if (ev && attr(ev, "typ_udalosti") !== "delivery") yield ctx.diag(n, `${w.raw} je impact; ER si vyberá len delivery udalosť`, ["spustacia_udalost", i]);
    }
  }
  for (const [n, m] of ctx.typu("UC", "PROJ")) {
    for (const [i, w] of odkazyPola(m, "spustacia_udalost").entries()) {
      const ev = ctx.model(w.ciel);
      if (ev && attr(ev, "typ_udalosti") !== "impact") yield ctx.diag(n, `${w.raw} je delivery; ${typPoznamky(n)} spúšťa len impact udalosť`, ["spustacia_udalost", i]);
    }
  }
});

pravidlo("C3", "E", { popis: "ER má práve jeden UC; poskytovateľ IU je určiteľný", zdroj: "§16.10" }, function* (ctx) {
  for (const [n, er] of ctx.typu("ER")) {
    const pocet = odkazyPola(er, "uc").length;
    if (pocet !== 1) yield ctx.diag(n, `ER má práve jeden \`uc::\`, nájdených ${pocet}`, ["uc"]);
    if (je(er.poskytovatel_predvoleny)) continue;
    for (const nid of jednotkyVymeny(ctx.k, idPoznamky(n) ?? "").vsetky) {
      const iu = ctx.model(nid);
      if (!iu) continue;
      if (!ciele(iu, "poskytovatel").length) yield ctx.diag(n, `[[${nid}]] nemá \`poskytovatel::\` a ER nemá \`poskytovatel_predvoleny\` — IDS sa nedá rozdeliť`, ["obsahuje"]);
    }
  }
});

pravidlo("C12", "E", { popis: "ER nesie aspoň jednu informačnú jednotku", zdroj: "29481-1 3.3.10" }, function* (ctx) {
  for (const [n, er] of ctx.typu("ER")) if (!odkazyPola(er, "obsahuje").length) yield ctx.diag(n, "ER bez `obsahuje::` — výmena bez informačných jednotiek nič neprenáša", ["obsahuje"]);
});

pravidlo("C4", "E", { popis: "Prepisy ER menia len hodnoty existujúcich položiek", zdroj: "§16.9" }, function* (ctx) {
  for (const [n, er] of ctx.typu("ER")) {
    const obsahuje = new Set(jednotkyVymeny(ctx.k, idPoznamky(n) ?? "").vsetky);
    for (const [i, pr] of zoznamM(er.prepisy).entries()) {
      const iuL = link(pr.iu);
      if (!iuL || !obsahuje.has(iuL.ciel)) {
        yield ctx.diag(n, `prepis mieri na ${iuL?.raw ?? pyStr(pr.iu)}, ktoré táto výmena nenesie — nie je ani v \`obsahuje::\`, ani ho nepriraďuje žiadny jej kontajner`, ["prepisy", i, "iu"]);
        continue;
      }
      if (!PREPISOVATELNE.some((k) => je(pr[k]))) yield ctx.diag(n, "prepis nemení nič z `povinnost | hodnoty | rozsah | profil | zavaznost`", ["prepisy", i]);
      if (!je(pr.polozka)) continue;
      const iu = ctx.model(iuL.ciel);
      if (!iu) continue;
      const kluce = klucePolozek(iu);
      const zhody = kluce.filter((k) => k === pr.polozka);
      if (!zhody.length) yield ctx.diag(n, `položka ${pyRepr(pr.polozka)} v ${iuL.ciel} neexistuje (kľúče: ${kluce.join(", ") || "—"})`, ["prepisy", i, "polozka"]);
      else if (zhody.length > 1) yield ctx.diag(n, `položka ${pyRepr(pr.polozka)} je v ${iuL.ciel} nejednoznačná — použi \`Pset.nazov\``, ["prepisy", i, "polozka"]);
    }
  }
});

pravidlo("C5", "W", { popis: "`typ_ulohy` je sumár úloh poskytovateľov", zdroj: "§2 V6, V17" }, function* (ctx) {
  for (const [n, uc] of ctx.typu("UC")) {
    const ulohy = zoznamM(uc.ulohy);
    if (!ulohy.length) continue;
    const typy = new Set<string>();
    for (const u of ulohy) {
      const akter = ctx.model(link(u.aktor)?.ciel);
      if (akter && POVERENE_STRANY.includes(String(attr(akter, "strana")))) typy.add(String(u.typ));
    }
    if (!typy.size) continue;
    const ocakavane = typy.size > 1 ? "oboje" : [...typy][0];
    if (uc.typ_ulohy !== ocakavane) yield ctx.diag(n, `\`typ_ulohy: ${pyStr(uc.typ_ulohy)}\`, ale úlohy poskytovateľov dávajú ${ocakavane} (preberacie úlohy príjemcu sa nepočítajú)`, ["typ_ulohy"]);
  }
});

pravidlo("C6", "E", { popis: "Úlohy UC sú konzistentné s aktérmi a kotvami", zdroj: "V17" }, function* (ctx) {
  for (const [n, uc] of ctx.typu("UC")) {
    const aktori = new Set(ciele(uc, "aktor"));
    const videne = new Set<string>();
    for (const [i, u] of zoznamM(uc.ulohy).entries()) {
      const id = String(u.id);
      if (videne.has(id)) yield ctx.diag(n, `\`ulohy[].id\` ${id} je v UC duplicitné`, ["ulohy", i, "id"]);
      videne.add(id);
      const a = link(u.aktor);
      if (!aktori.has(a?.ciel ?? "")) yield ctx.diag(n, `aktér úlohy ${id} (${a?.raw ?? pyStr(u.aktor)}) nie je v \`aktor::\``, ["ulohy", i, "aktor"]);
    }
  }
  for (const [n, iu] of ctx.typu("IU-O")) {
    for (const [i, w] of odkazyPola(iu, "pre_task").entries()) {
      const druh = w.kotva ? ctx.k.kotvy.get(w.ciel)?.[w.kotva] : undefined;
      if (w.kotva && druh !== undefined && druh !== "uloha") yield ctx.diag(n, `${w.raw} nemieri na úlohu, ale na ${druh}`, ["pre_task", i]);
    }
  }
});

pravidlo("C7", "E", { popis: "`zapnute::` zapína len podmienené pravidlá", zdroj: "§3" }, function* (ctx) {
  for (const [n, er] of ctx.typu("ER")) {
    for (const [i, w] of odkazyPola(er, "zapnute").entries()) {
      const pz = ctx.podZaznamCiela(w);
      if (!pz || pz.model === null) continue;
      const plati = attr(pz.model, "plati");
      if (plati === "vzdy") yield ctx.diag(n, `${w.raw} má \`plati: vzdy\` — zapínanie je zbytočné, platí automaticky`, ["zapnute", i], "W");
      else if (plati !== "na_vyziadanie") yield ctx.diag(n, `${w.raw} nie je podmienené pravidlo (\`plati: na_vyziadanie\`)`, ["zapnute", i]);
    }
  }
});

pravidlo("C8", "E", { popis: "Udalosť nesie, čo jej druh vyžaduje", zdroj: "§9" }, function* (ctx) {
  for (const [n, ev] of ctx.typu("EV")) {
    if (ev.typ_udalosti === "impact") {
      if (!je(ev.objekt)) yield ctx.diag(n, "impact udalosť potrebuje `objekt` (IU-O alebo #aktivum)", ["objekt"]);
      for (const [i, w] of odkazyPola(ev, "vyvolava").entries()) {
        const c = ctx.model(w.ciel);
        if (c && attr(c, "typ_udalosti") !== "delivery") yield ctx.diag(n, `\`vyvolava:: ${w.raw}\` musí mieriť na delivery udalosť`, ["vyvolava", i]);
      }
    } else {
      if (pravda(ev.vyvolava)) yield ctx.diag(n, "`vyvolava::` patrí len na impact udalosť (PAS tab. 2)", ["vyvolava"]);
      if (!pravda(ev.planovana) && !pravda(ev.relativny_termin)) yield ctx.diag(n, "neplánovaná delivery udalosť potrebuje `relativny_termin`", ["relativny_termin"], "W");
    }
  }
});

/** `Dokument.sekcia`: bloky pod nadpisom s daným textom. */
function sekcia(n: Poznamka, text: string) {
  const telo = n.dokument.telo;
  const i = telo.findIndex((b) => b.druh === "Nadpis" && b.text === text);
  if (i < 0) return null;
  const j = telo.findIndex((b, x) => x > i && b.druh === "Nadpis");
  return telo.slice(i + 1, j < 0 ? telo.length : j);
}

pravidlo("C9", "W", { popis: "Sekcia „Fázy → ER“ sedí s udalosťami ER", zdroj: "§2" }, function* (ctx) {
  for (const [n] of ctx.typu("UC")) {
    const sek = sekcia(n, "Fázy → ER");
    if (!sek) continue;
    const nid = idPoznamky(n) ?? "";
    const text = sek.map((b) => b.raw).join("");
    const ocakavane = new Set(ctx.typu("ER").filter(([, er]) => ciele(er, "uc").includes(nid)).map(([e]) => idPoznamky(e) ?? ""));
    const uvedene = [...text.matchAll(/\[\[([A-Z]+-[\p{L}\p{N}_-]+)\]\]/gu)].map((x) => x[1]).filter((x) => ctx.k.poznamky.has(x));
    const uvedeneEr = new Set(uvedene.filter((x) => typPoznamky(ctx.k.poznamky.get(x)!) === "ER"));
    for (const ch of zorad([...ocakavane].filter((x) => !uvedeneEr.has(x)))) yield ctx.diag(n, `generovaná sekcia „Fázy → ER“ neuvádza ${ch}`, ["id"]);
    for (const nav of zorad([...uvedeneEr].filter((x) => !ocakavane.has(x)))) yield ctx.diag(n, `„Fázy → ER“ uvádza ${nav}, ktoré na tento UC neodkazuje`, ["id"]);
  }
});

/** `vymeny_jednotky`: výmeny, ktorých jednotky obsahujú poznámku (priamo alebo cez kontajner). */
const vymenyJednotky = (ctx: Kontext, iu: string) =>
  ctx.k.podlaTypu("ER").filter((er) => idPoznamky(er) !== null && jednotkyVymeny(ctx.k, idPoznamky(er)!).vsetky.includes(iu));

pravidlo("C10", "W", { popis: "Osirené poznámky (bez použitia v grafe)", zdroj: "nové" }, function* (ctx) {
  const pouzite = new Set(ctx.k.odkazy.filter((o) => o.ciel).map((o) => o.ciel!));
  for (const [n] of ctx.typu("IU-O", "IU-C")) if (!vymenyJednotky(ctx, idPoznamky(n) ?? "").length) yield ctx.diag(n, "jednotku neobsahuje žiadny ER — nedostane sa do výmeny", ["id"]);
  for (const [n, er] of ctx.typu("ER")) if (!ciele(er, "uc").length) yield ctx.diag(n, "ER bez `uc::`", ["uc"]);
  const ery = ctx.typu("ER");
  for (const [n] of ctx.typu("UC")) if (!ery.some(([, er]) => ciele(er, "uc").includes(idPoznamky(n) ?? ""))) yield ctx.diag(n, "UC nemá žiadny ER — scenár nič nevymieňa", ["id"]);
  for (const [n] of ctx.typu("EV")) if (!pouzite.has(idPoznamky(n) ?? "")) yield ctx.diag(n, "udalosť nikto nepoužíva (žiadny UC, ER ani PROJ)", ["id"]);
});

function lokalneFazy(ctx: Kontext): Set<string> | null {
  const n = ctx.poznamka("STD-fazy");
  if (!n) return null;
  const fazy = new Set<string>();
  for (const pz of n.pod_zaznamy) {
    const h = pz.data.hodnoty;
    if (Array.isArray(h)) for (const x of h) fazy.add(pyStr(x));
    else if (obj(h)) for (const x of Object.values(h as M)) fazy.add(pyStr(x));
  }
  return fazy;
}

pravidlo("C11", "W", { popis: "Región a lokálna fáza", zdroj: "§2" }, function* (ctx) {
  const fazyStd = lokalneFazy(ctx);
  for (const [n, uc] of ctx.typu("UC")) {
    for (const [i, r] of zoznam(uc.region).entries()) if (!/^[A-Z]{3}$/.test(String(r))) yield ctx.diag(n, `\`region\` ${pyRepr(r)} nemá tvar ISO 3166-1 alpha-3 (SVK, CZE)`, ["region", i]);
    if (!fazyStd) continue;
    for (const [i, f] of zoznam(uc.faza_lokalna).entries()) if (!fazyStd.has(String(f))) yield ctx.diag(n, `lokálna fáza ${pyRepr(f)} nemá mapovanie v STD-fazy`, ["faza_lokalna", i]);
  }
});

pravidlo("C13", "W", { popis: "Objekt bez kontajnera", zdroj: "V27, PAS 6.3.2.1 a" }, function* (ctx) {
  for (const [n, er] of ctx.typu("ER")) {
    const j = jednotkyVymeny(ctx.k, idPoznamky(n) ?? "");
    for (const [i, w] of odkazyPola(er, "obsahuje").entries()) {
      if (j.volne.includes(w.ciel)) yield ctx.diag(n, `${w.raw} nenesie žiadny kontajner tejto výmeny — doplň priradenie do IU-C (\`obsahuje: [{iu: …}]\`) alebo kontajner do \`obsahuje::\``, ["obsahuje", i]);
    }
  }
});
