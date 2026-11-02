/**
 * Sekcie F (STD, GEO, DEF, PROP, PROT, PROJ, GOAL), G (nositeľ informácie) a H (preflight generátora)
 * validátora (port `f_typy.py`, `g_nositel.py`, `h_generovatelnost.py`). F3, F10 a H3 potrebujú schému IFC (F2b).
 */

import { idPoznamky } from "../graf";
import { klucPolozky } from "../graf-json";
import { jednotkyVymeny } from "../retazec";
import { attr, ciele, je, link, obj, pravda, pravidlo, pyRepr, pyStr, zorad, zoznam, zoznamM, type Kontext, type M } from "./kontext";

// ------------------------------------------------------------------------------------------------ F

const OVERENIE_PODLA_ROZSAHU: Record<string, string[]> = { objekt: ["IDS", "manual"], kontajner: ["IDS", "manual"], federacia: ["manual", "clash-detection"] };
const GEO_ID = /^GEO-G[0-3]$/;
const GEO_ASPEKTY = ["ShapeAssembly", "ShapeRepresentation", "ShapeInfluence", "Dimensionality", "Appearance", "ParametricBehaviour", "Location"];
const DEF_POVINNE = ["jednotka", "zaokruhlenie", "tolerancia", "hranica_merania", "metoda_merania", "zodpovedny_za_meranie"];
const UROVNE_GOAL: Record<string, number> = { organizacia: 0, aktivum: 1, projekt: 2 };
/** `getattr(m, k, "?")`: chýbajúce pole = "?", None = "None". */
const alebo = (m: M, k: string, d: string) => (k in m ? pyStr(m[k]) : d);

pravidlo("F1", "E", { popis: "`rozsah: federacia` je len pre relačné pravidlá", zdroj: "§16.11" }, function* (ctx) {
  for (const [n, pz, p] of ctx.pod("pravidlo")) if (p.rozsah === "federacia" && pravda(p.hodnoty)) yield ctx.diagPod(n, pz, "pravidlo s fixnými `hodnoty` sa overuje v jednom súbore — patrí mu `rozsah: kontajner`", ["rozsah"]);
});

pravidlo("F2", "E", { popis: "`zdroj_hodnot` je master DiMS", zdroj: "§16.14, V11" }, function* (ctx) {
  for (const [n, pz, p] of ctx.pod("pravidlo")) {
    const z = link(p.zdroj_hodnot);
    if (!z) continue;
    const master = ctx.model(z.ciel);
    if (!master) continue;
    if (attr(master, "druh") !== "model") yield ctx.diagPod(n, pz, `\`zdroj_hodnot: ${z.raw}\` musí byť IU-C \`druh: model\`, je ${alebo(master, "druh", "?")}`, ["zdroj_hodnot"]);
  }
});

pravidlo("F4", "E", { popis: "`overenie` pravidla podľa rozsahu", zdroj: "§14b, §16.2" }, function* (ctx) {
  for (const [n, pz, p] of ctx.pod("pravidlo")) {
    if (!je(p.overenie)) continue;
    const pripustne = OVERENIE_PODLA_ROZSAHU[String(p.rozsah)] ?? [];
    if (!pripustne.includes(String(p.overenie))) yield ctx.diagPod(n, pz, `\`overenie: ${pyStr(p.overenie)}\` nie je pri \`rozsah: ${pyStr(p.rozsah)}\` prípustné (§14b: ${pripustne.join(", ")})`, ["overenie"]);
  }
});

pravidlo("F5", "E", { popis: "Zakázaná entita nenesie requirements", zdroj: "§6" }, function* (ctx) {
  for (const [n, pz, p] of ctx.pod("pravidlo")) if (p.pritomnost_v_modeli === "prohibited" && pravda(p.requirements)) yield ctx.diagPod(n, pz, "zakázaná entita nemôže mať `requirements` — zákaz je celý obsah pravidla", ["requirements"]);
});

pravidlo("F6", "E", { popis: "IDS pravidlo je vyjadriteľné, manuálne má postup", zdroj: "§6" }, function* (ctx) {
  for (const [n, pz, p] of ctx.pod("pravidlo")) {
    if (p.overenie === "IDS") {
      for (const [i, r] of zoznamM(p.requirements).entries()) if (r.facet === "entity") yield ctx.diagPod(n, pz, "entity facet patrí do `applicability`, nie do `requirements`", ["requirements", i]);
    } else if ((p.overenie === "manual" || p.overenie === "clash-detection") && !pravda(p.postup)) yield ctx.diagPod(n, pz, `\`overenie: ${p.overenie}\` bez \`postup\` — akceptácia nemá čo vypísať`, ["postup"]);
  }
});

pravidlo("F7", "E", { popis: "Núdzový ```ids blok len s `vynimka: true`", zdroj: "§6" }, function* (ctx) {
  for (const n of ctx.k.vsetky) for (const pz of n.pod_zaznamy) if (pz.ids_blok !== null && !pravda(pz.data.vynimka)) yield ctx.diagPod(n, pz, "surový ```ids blok je prípustný len s `vynimka: true`", ["id"]);
});

pravidlo("F8", "E", { popis: "Geometrický profil je úplný", zdroj: "§6a V8" }, function* (ctx) {
  for (const [n, pz, profil] of ctx.pod("profil")) {
    if (!GEO_ID.test(pz.id)) yield ctx.diagPod(n, pz, `ID profilu ${pyRepr(pz.id)} nemá tvar GEO-G0…GEO-G3`, ["id"]);
    const aspekty = obj(profil.aspekty);
    if (!aspekty) continue;
    const chybajuce = GEO_ASPEKTY.filter((k) => !je(aspekty[k]));
    if (chybajuce.length) yield ctx.diagPod(n, pz, `profil neurčuje aspekty ${chybajuce.join(", ")} — IU-O by ich musela dopĺňať ručne`, ["aspekty"], "W");
  }
});

pravidlo("F9", "W", { popis: "Definícia hodnoty je úplná", zdroj: "§8" }, function* (ctx) {
  for (const [n, d] of ctx.typu("DEF")) {
    const chybajuce = DEF_POVINNE.filter((k) => !pravda(d[k]));
    if (chybajuce.length) yield ctx.diag(n, `DEF neuvádza ${chybajuce.join(", ")} — hodnota nie je reprodukovateľne meraná`, ["definicia"]);
  }
});

pravidlo("F12", "E", { popis: "PROJ dosadzuje knižnicu do zákazky", zdroj: "§12" }, function* (ctx) {
  for (const [n, proj] of ctx.typu("PROJ")) {
    const su = link(proj.spustacia_udalost);
    const ev = ctx.model(su?.ciel);
    if (ev && attr(ev, "typ_udalosti") !== "impact") yield ctx.diag(n, `\`spustacia_udalost: ${su!.raw}\` musí byť impact (PAS 6.1.3)`, ["spustacia_udalost"]);
    const dostupne = new Set<string>();
    for (const c of ciele(proj, "er")) {
      const er = ctx.model(c);
      if (er) for (const x of ciele(er, "spustacia_udalost")) dostupne.add(x);
    }
    for (const [i, u] of zoznamM(proj.udalosti).entries()) {
      const ev2 = link(u.ev);
      if (dostupne.size && !dostupne.has(ev2?.ciel ?? "")) yield ctx.diag(n, `dátum pre ${ev2?.raw ?? pyStr(u.ev)}, ktorú žiadny vybraný ER nespúšťa (dostupné: ${zorad(dostupne).join(", ") || "—"})`, ["udalosti", i, "ev"]);
    }
    for (const [i, v] of zoznamM(proj.vystupy).entries()) if (!pravda(v.hash)) yield ctx.diag(n, `výstup ${pyStr(v.subor)} bez hashu — doplní ho generátor`, ["vystupy", i], "I");
  }
});

pravidlo("F14", "W", { popis: "Cieľ, ku ktorému nevedie žiadny účel užitia", zdroj: "§1 V19" }, function* (ctx) {
  const pouzite = new Set<string>();
  for (const [, uc] of ctx.typu("UC")) for (const c of ciele(uc, "podporuje_ciel")) pouzite.add(c);
  for (const [, g] of ctx.typu("GOAL")) for (const c of ciele(g, "prispieva_k")) pouzite.add(c);
  for (const [n] of ctx.typu("GOAL")) {
    if (!pouzite.has(idPoznamky(n) ?? "")) yield ctx.diag(n, "na tento cieľ neukazuje žiadny účel užitia (`podporuje_ciel`) ani nižší cieľ (`prispieva_k`) — v knižnici je to prípustné, len naň zatiaľ nič nenadväzuje", ["id"]);
  }
});

pravidlo("F13", "E", { popis: "GOAL kaskáda OIR → AIR → PIR", zdroj: "§1" }, function* (ctx) {
  for (const [n, g] of ctx.typu("GOAL")) {
    if (pravda(g.aktivum) && g.uroven === "organizacia") yield ctx.diag(n, "`aktivum` patrí len k úrovni aktivum alebo projekt", ["aktivum"]);
    if (je(g.termin) && g.uroven !== "projekt") yield ctx.diag(n, "`termin` patrí len k projektovému cieľu", ["termin"]);
    const moja = UROVNE_GOAL[String(g.uroven)] ?? 0;
    for (const [i, c] of ciele(g, "prispieva_k").entries()) {
      const vyssi = ctx.model(c);
      if (!vyssi) continue;
      const ich = UROVNE_GOAL[String(vyssi.uroven ?? "")] ?? 0;
      if (ich >= moja) yield ctx.diag(n, `\`prispieva_k:: [[${c}]]\` mieri na úroveň ${alebo(vyssi, "uroven", "?")}; nižšia úroveň prispieva k vyššej, nie naopak`, ["prispieva_k", i]);
    }
  }
});

// ------------------------------------------------------------------------------------------------ G

const AKTIVA_POVOLENE = ["GOAL", "STD"];
const SLOVNIKOVA_POZNAMKA = "STD-klasifikacia";
const VELA_HODNOT = 5;

pravidlo("G1", "W", { popis: "Zdieľaný slovník federácie má master DiMS", zdroj: "V11" }, function* (ctx) {
  const entityVEr = new Map<string, string>();
  for (const [n] of ctx.typu("ER")) {
    for (const c of jednotkyVymeny(ctx.k, idPoznamky(n) ?? "").objekty) {
      const o = attr(ctx.model(c), "objekt");
      if (je(o)) entityVEr.set(pyStr(attr(o, "ifc_entita")).toUpperCase(), c);
    }
  }
  for (const [n, pz, p] of ctx.pod("pravidlo")) {
    if (!pravda(p.ucel_federacie) || !pravda(p.hodnoty) || je(p.zdroj_hodnot)) continue;
    const app = obj(p.applicability);
    if (!app || !je(app.entity)) continue;
    for (const e of Array.isArray(app.entity) ? app.entity : [app.entity]) {
      const c = entityVEr.get(pyStr(e).toUpperCase());
      if (c) {
        yield ctx.diagPod(n, pz, `pravidlo drží ručný zoznam hodnôt, hoci ${c} je nositeľom ${pyStr(e)} v modeli — použi \`zdroj_hodnot\` na master DiMS (V11)`, ["hodnoty"]);
        break;
      }
    }
  }
});

pravidlo("G2", "E", { popis: "Vrstva aktíva nie je tieňová databáza", zdroj: "§15 V12" }, function* (ctx) {
  for (const n of ctx.k.vsetky) {
    if (ctx.vrstva(n) !== "aktiva" || !n.model) continue;
    const typ = (n.data.typ as string | undefined) || n.umiestnenie?.typ || null;
    if (!AKTIVA_POVOLENE.includes(typ ?? "")) yield ctx.diag(n, `vo vrstve aktiva/ je typ ${pyStr(typ)}; patrí sem len GOAL (uroven: aktivum), prepisy STD a ukazovatele cde/aim — register kontajnerov aj história udalostí sú generované pohľady (V12)`, ["typ"]);
  }
});

pravidlo("G3", "I", { popis: "Dlhý výčet hodnôt mimo slovníka", zdroj: "§0.10" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-O")) {
    if (idPoznamky(n) === SLOVNIKOVA_POZNAMKA) continue;
    for (const [i, p] of zoznamM(iu.alfanumerika).entries()) {
      const h = zoznam(p.hodnoty);
      if (h.length >= VELA_HODNOT) yield ctx.diag(n, `položka \`${klucPolozky(p)}\` má ${h.length} hodnôt inline — zváž slovník v ${SLOVNIKOVA_POZNAMKA} a \`hodnoty_ref\` (§0.10)`, ["alfanumerika", i, "hodnoty"]);
    }
  }
  for (const [n, pz, p] of ctx.pod("pravidlo")) if (Array.isArray(p.hodnoty) && p.hodnoty.length >= VELA_HODNOT) yield ctx.diagPod(n, pz, `pravidlo drží ${p.hodnoty.length} hodnôt inline — zváž slovník (§0.10)`, ["hodnoty"]);
});

// ------------------------------------------------------------------------------------------------ H

const KRITICKE_POLIA = ["hodnoty_ref", "profil", "zapnute", "obsahuje", "pravidlo"];

function maIdsPolozku(ctx: Kontext, iuId: string): boolean {
  const iu = ctx.model(iuId);
  if (!iu) return false;
  if (zoznamM(iu.alfanumerika).some((p) => (pravda(p.overenie) ? p.overenie : "IDS") === "IDS")) return true;
  return pravda(iu.klasifikacia);
}

pravidlo("H1", "I", { popis: "Výmena, z ktorej vznikne prázdne IDS", zdroj: "nové" }, function* (ctx) {
  for (const [n, er] of ctx.typu("ER")) {
    const predvoleny = link(er.poskytovatel_predvoleny);
    const podla = new Map<string, string[]>();
    for (const c of jednotkyVymeny(ctx.k, idPoznamky(n) ?? "").objekty) {
      const iu = ctx.model(c);
      if (!iu) continue;
      const posk = ciele(iu, "poskytovatel");
      for (const p of posk.length ? posk : predvoleny ? [predvoleny.ciel] : []) podla.set(p, [...(podla.get(p) ?? []), c]);
    }
    const zapnuteIds = zoznam(er.zapnute)
      .map((w) => ctx.podZaznamCiela(link(w)))
      .some((pz) => pz !== null && pz.model !== null && attr(pz.model, "overenie") === "IDS");
    for (const p of zorad(podla.keys())) {
      if (!podla.get(p)!.some((iu) => maIdsPolozku(ctx, iu)) && !zapnuteIds) {
        yield ctx.diag(n, `pre poskytovateľa ${p} nemá žiadna položka \`overenie: IDS\` ani zapnuté IDS pravidlo — IDS súbor by bol prázdny`, ["obsahuje"]);
      }
    }
  }
});

pravidlo("H2", "E", { popis: "Visiaci odkaz, ktorý generátor potrebuje", zdroj: "nové", preflight: true }, function* (ctx) {
  for (const o of ctx.k.odkazy) {
    if (o.ciel !== null) continue;
    const pole = o.pointer.replace(/^\/+|\/+$/g, "").split("/")[0];
    const posledny = o.pointer.replace(/\/+$/, "").split("/").pop() ?? "";
    if (!KRITICKE_POLIA.includes(pole) && !KRITICKE_POLIA.includes(posledny)) continue;
    const n = ctx.poznamka(o.zdroj);
    if (!n) continue;
    yield { note_id: o.zdroj, json_pointer: o.pointer, uroven: "E", kod: "H2", sprava: `${o.link.raw} sa nerozlíši, a generátor ho pre cieľ potrebuje (pole \`${pole}\`)`, subor: n.rel, riadok: o.riadok };
  }
});
