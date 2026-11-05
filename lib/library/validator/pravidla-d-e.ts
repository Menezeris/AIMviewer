/**
 * Sekcie D (IU-O, šablóny typov objektov) a E (IU-C, kontajnery) validátora (port `d_iu_o.py`, `e_iu_c.py`).
 * Pravidlá, ktoré potrebujú schému IFC (D3, D4, D17, D18), sú F2b.
 */

import { idPoznamky, typPoznamky } from "../graf";
import { klucPolozky } from "../graf-json";
import { ASPEKTY, priradenia } from "../retazec";
import { attr, ciele, je, link, obj, platnyRegex, pravda, pravidlo, pyRepr, pyStr, zorad, zoznam, zoznamM, type Kontext, type Link, type M } from "./kontext";

// ------------------------------------------------------------------------------------------------ D

const URI_TRIEDA = /^https:\/\/identifier\.buildingsmart\.org\/uri\/[\p{L}\p{N}_.-]+\/ifc\/[\p{Nd}.]+\/class\/[\p{L}\p{N}_]+$/u;
const URI_VLASTNOST = /^https:\/\/identifier\.buildingsmart\.org\/uri\/[\p{L}\p{N}_.-]+\/ifc\/[\p{Nd}.]+\/prop\/[\p{L}\p{N}_]+$/u;
const CUDZI_NOSITEL = ["nájomc", "zmluv", "osob", "faktúr", "prenajímateľ"];
const OBMEDZENIA = ["povinnost", "vzor", "hodnoty", "hodnoty_ref", "rozsah"];
const GEO_ASPEKTY = ["ShapeAssembly", "ShapeRepresentation", "ShapeInfluence", "Dimensionality", "Appearance", "ParametricBehaviour", "Location"];

function slovnik(ctx: Kontext, l: Link | null): [boolean, string] {
  const pz = ctx.podZaznamCiela(l);
  if (!pz) return [false, "necieli na pod-záznam"];
  return [pz.druh === "slovnik", `cieľ je ${pz.druh}`];
}

pravidlo("D2", "W", { popis: "Požiadavka niečo vynucuje, inak je informatívna", zdroj: "§16.3 (výklad, QUESTIONS Q15)" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-O")) {
    for (const [i, p] of zoznamM(iu.alfanumerika).entries()) {
      const zavaznost = pravda(p.zavaznost) ? p.zavaznost : (iu.zavaznost_predvolena ?? null);
      if (zavaznost === "zmluvne" || zavaznost === "informativne" || zavaznost === null) continue;
      if (OBMEDZENIA.some((k) => je(p[k]))) continue;
      yield ctx.diag(n, `položka \`${klucPolozky(p)}\` so \`zavaznost: ${pyStr(zavaznost)}\` nemá žiadne obmedzenie (povinnost, vzor, hodnoty, rozsah) — doplň ho alebo daj \`zavaznost: informativne\``, ["alfanumerika", i]);
    }
  }
});

pravidlo("D5", "W", { popis: "Tvar bSDD URI", zdroj: "§4, §7" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-O")) {
    const uri = attr(iu.objekt, "uri");
    if (pravda(uri) && !URI_TRIEDA.test(pyStr(uri))) yield ctx.diag(n, `\`objekt.uri\` nemá tvar bSDD triedy (…/ifc/4.3/class/…): ${pyStr(uri)}`, ["objekt", "uri"]);
    for (const [i, p] of zoznamM(iu.alfanumerika).entries()) {
      const u = attr(p.ifc, "uri");
      if (pravda(u) && !URI_VLASTNOST.test(pyStr(u))) yield ctx.diag(n, `\`ifc.uri\` nemá tvar bSDD vlastnosti (…/ifc/4.3/prop/…): ${pyStr(u)}`, ["alfanumerika", i, "ifc", "uri"]);
    }
  }
});

pravidlo("D6", "E", { popis: "`hodnoty_ref` mieri na slovník v STD-klasifikacia", zdroj: "§16.15" }, function* (ctx) {
  for (const o of ctx.k.odkazy) {
    if (!o.pointer.endsWith("hodnoty_ref") || o.ciel === null) continue;
    const n = ctx.poznamka(o.zdroj);
    if (!n) continue;
    const [je_, preco] = slovnik(ctx, { ...o.link });
    if (!je_) yield { note_id: o.zdroj, json_pointer: o.pointer, uroven: "E", kod: "D6", sprava: `\`hodnoty_ref: ${o.link.raw}\` musí mieriť na slovník v STD-klasifikacia — ${preco}`, subor: n.rel, riadok: o.riadok };
  }
});

pravidlo("D7", "E", { popis: "Filter iba zužuje applicability", zdroj: "§4 V9" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-O")) {
    for (const [i, f] of zoznamM(iu.filter).entries()) {
      if (je(f.cardinality)) yield ctx.diag(n, "položka filtra nesmie mať `cardinality` — filter nič nevynucuje (V9)", ["filter", i, "cardinality"]);
      if (f.facet === "entity") yield ctx.diag(n, "entity facet patrí do `objekt`, nie do filtra", ["filter", i]);
    }
  }
});

const entityPravidla = (app: M) => (Array.isArray(app.entity) ? app.entity : [app.entity]);

function existujeNefiltrovane(ctx: Kontext, entita: string, nazov: unknown): boolean {
  for (const [, , p] of ctx.pod("pravidlo")) {
    const app = obj(p.applicability);
    if (!app || p.plati !== "vzdy" || pravda(app.filter)) continue;
    if (!entityPravidla(app).filter(pravda).map((e) => pyStr(e).toUpperCase()).includes(entita)) continue;
    if (zoznamM(p.requirements).some((r) => r.nazov === nazov)) return true;
  }
  return false;
}

pravidlo("D8", "W", { popis: "Atribút vo filtri má nefiltrované pravidlo `plati: vzdy`", zdroj: "§4 V9" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-O")) {
    const o = obj(iu.objekt);
    const entita = (o ? pyStr(o.ifc_entita ?? null) : "").toUpperCase();
    for (const [i, f] of zoznamM(iu.filter).entries()) {
      if (!pravda(f.nazov) || !(f.facet === "attribute" || f.facet === "property")) continue;
      if (!existujeNefiltrovane(ctx, entita, f.nazov)) {
        yield ctx.diag(n, `filter podľa \`${pyStr(f.nazov)}\` predpokladá, že atribút existuje na každej ${entita} — chýba nefiltrované STD pravidlo \`plati: vzdy\` (vzor: STD-CL-06)`, ["filter", i]);
      }
    }
  }
});

pravidlo("D10", "E", { popis: "Dokumentačná položka dokladuje existujúce položky", zdroj: "V3, V4" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-O")) {
    const kluce = new Set(zoznamM(iu.alfanumerika).map(klucPolozky));
    for (const [i, d] of zoznamM(iu.dokumentacia).entries()) {
      for (const [j, k] of zoznam(d.dokladuje).entries()) if (!kluce.has(String(k))) yield ctx.diag(n, `\`dokladuje\` menuje ${pyRepr(k)}, čo nie je položka tejto IU-O`, ["dokumentacia", i, "dokladuje", j]);
      if (d.automatizovatelne === false && !pravda(d.postup)) yield ctx.diag(n, "neautomatizovateľná kontrola potrebuje `postup`", ["dokumentacia", i, "postup"], "W");
    }
  }
});

pravidlo("D11", "W", { popis: "Tolerancia potrebuje doklad", zdroj: "§0.6" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-O")) {
    for (const [i, p] of zoznamM(iu.alfanumerika).entries()) {
      if (pravda(p.tolerancia) && !je(p.dolozene_v)) yield ctx.diag(n, `položka \`${klucPolozky(p)}\` má \`tolerancia\`, ale žiadne \`dolozene_v\` — zhodu s realitou overuje dokumentačná položka (§0.6)`, ["alfanumerika", i, "tolerancia"]);
    }
  }
});

pravidlo("D12", "W", { popis: "Meraná veličina má definíciu", zdroj: "V2" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-O")) {
    for (const [i, p] of zoznamM(iu.alfanumerika).entries()) {
      const ifc = obj(p.ifc);
      const pset = ifc ? ("pset" in ifc ? ifc.pset : "") : "";
      if (pyStr(pset).startsWith("Qto_") && !je(p.definicia_ref)) yield ctx.diag(n, `veličina \`${klucPolozky(p)}\` nemá \`definicia_ref\` na DEF — bez meracieho pravidla je hodnota nedokázateľná`, ["alfanumerika", i]);
    }
  }
});

pravidlo("D13", "E", { popis: "Kľúče položiek a rola identifikácie", zdroj: "nové" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-O")) {
    const videne = new Set<string>();
    let identifikacie = 0;
    const polozky = zoznamM(iu.alfanumerika);
    for (const [i, p] of polozky.entries()) {
      const k = klucPolozky(p);
      if (videne.has(k)) yield ctx.diag(n, `kľúč položky ${pyRepr(k)} je v IU-O duplicitný — prepisy ER by boli nejednoznačné`, ["alfanumerika", i]);
      videne.add(k);
      if (p.rola === "identifikacia") identifikacie++;
    }
    if (polozky.length && identifikacie !== 1) yield ctx.diag(n, `IU-O má mať práve jednu položku s \`rola: identifikacia\`, nájdených ${identifikacie}`, ["alfanumerika"], "W");
  }
});

pravidlo("D14", "E", { popis: "Klasifikácia odkazuje na slovník, neopisuje ho", zdroj: "§0.10, V14" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-O")) {
    for (const [i, kl] of zoznamM(iu.klasifikacia).entries()) {
      const pr = link(kl.pravidlo);
      if (!je(kl.pravidlo)) {
        yield ctx.diag(n, `klasifikácia ${pyStr(kl.system)} bez \`pravidlo\` — tabuľka kódov žije v STD-klasifikacia`, ["klasifikacia", i]);
        continue;
      }
      if (ctx.typCiela(pr) === null) continue;
      const [je_, preco] = slovnik(ctx, pr);
      if (!je_) yield ctx.diag(n, `\`pravidlo: ${pr!.raw}\` musí mieriť na slovník — ${preco}`, ["klasifikacia", i, "pravidlo"]);
    }
  }
});

const rovnake = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

pravidlo("D15", "I", { popis: "Geometria voči profilu", zdroj: "§6a" }, function* (ctx) {
  const iuO = ctx.typu("IU-O");
  let prepisujuce = 0;
  for (const [n, iu] of iuO) {
    const g = obj(iu.geometria);
    if (!g || !je(g.profil)) continue;
    const profil = link(g.profil);
    const pz = ctx.podZaznamCiela(profil);
    if (!pz || pz.model === null) continue;
    const aspekty = obj(attr(pz.model, "aspekty"));
    if (!aspekty) continue;
    const zhodne: string[] = [];
    let odlisne = 0;
    for (const nazov of GEO_ASPEKTY) {
      const moja = g[nazov] ?? null;
      if (moja === null) continue;
      if (rovnake(moja, aspekty[nazov] ?? null)) zhodne.push(nazov);
      else odlisne++;
    }
    if (odlisne) prepisujuce++;
    for (const nazov of zhodne) yield ctx.diag(n, `aspekt \`${nazov}\` je rovnaký ako v ${profil!.raw} — stačí profil`, ["geometria", nazov]);
  }
  if (iuO.length && prepisujuce * 3 > iuO.length) yield ctx.diag(iuO[0][0], `${prepisujuce} z ${iuO.length} IU-O prepisuje aspekty profilu — zváž prekrojenie profilov (§6a)`, ["geometria"]);
});

pravidlo("D16", "E", { popis: "Zakázaný objekt nenesie požiadavky", zdroj: "nové" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-O")) {
    if (iu.pritomnost_v_modeli !== "prohibited") continue;
    if (pravda(iu.alfanumerika)) yield ctx.diag(n, "`pritomnost_v_modeli: prohibited` a zároveň alfanumerické požiadavky", ["alfanumerika"]);
    if (je(iu.geometria)) yield ctx.diag(n, "`pritomnost_v_modeli: prohibited` a zároveň požiadavka na geometriu", ["geometria"]);
  }
});

pravidlo("D19", "I", { popis: "Heuristika nositeľa informácie", zdroj: "§0.9, V15" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-O")) {
    for (const nazov of ["pokyn", "zdovodnenie"]) {
      const text = (pravda(iu[nazov]) ? pyStr(iu[nazov]) : "").toLowerCase();
      const najdene = CUDZI_NOSITEL.filter((s) => text.includes(s));
      if (najdene.length) yield ctx.diag(n, `\`${nazov}\` spomína ${najdene.join(", ")} — over, či nositeľom nie je CDE/AIM/CAFM, nie model (§0.9)`, [nazov]);
    }
    for (const [i, p] of zoznamM(iu.alfanumerika).entries()) {
      const text = (pravda(p.pokyn) ? pyStr(p.pokyn) : "").toLowerCase();
      const najdene = CUDZI_NOSITEL.filter((s) => text.includes(s));
      if (najdene.length) yield ctx.diag(n, `pokyn položky \`${klucPolozky(p)}\` spomína ${najdene.join(", ")} — over nositeľa (§0.9)`, ["alfanumerika", i, "pokyn"]);
    }
  }
});

const DATOVY_TYP = /^IFC[A-Z0-9]+$/;
const CISELNE = ["rozsah"];

pravidlo("D20", "E", { popis: "`datovy_typ` je IFC typ a patrí k vlastnosti", zdroj: "V24, IDS 1.0 @dataType" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-O")) {
    for (const [i, p] of zoznamM(iu.alfanumerika).entries()) {
      const dt = p.datovy_typ ?? null;
      const ifc = obj(p.ifc);
      const jeVlastnost = je(p.prop) || (ifc !== null && "pset" in ifc);
      if (pravda(dt)) {
        if (!DATOVY_TYP.test(pyStr(dt))) yield ctx.diag(n, `\`datovy_typ: ${pyStr(dt)}\` nie je IFC jednoduchý typ VEĽKÝMI (IFCAREAMEASURE…) — IDS \`@dataType\` iný tvar neprijme`, ["alfanumerika", i, "datovy_typ"]);
        if (!jeVlastnost) yield ctx.diag(n, `položka \`${klucPolozky(p)}\` je atribút/materiál — IDS attribute a material facet \`dataType\` nemajú, pole patrí len k \`ifc.pset\` a \`prop\``, ["alfanumerika", i, "datovy_typ"]);
      } else if (jeVlastnost && (pravda(p.overenie) ? p.overenie : "IDS") === "IDS") {
        const obmedzenie = CISELNE.filter((k) => je(p[k]));
        if (obmedzenie.length) yield ctx.diag(n, `položka \`${klucPolozky(p)}\` má \`${obmedzenie[0]}\`, ale nemá \`datovy_typ\` — IDS bez \`@dataType\` číselné medze neoverí (V24)`, ["alfanumerika", i], "W");
      }
    }
  }
});

pravidlo("D21", "W", { popis: "Klasifikácia bez povinnosti zužuje applicability", zdroj: "V25 (Q36), IDS 1.0 §4" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-O")) {
    if (iu.pritomnost_v_modeli !== "required") continue;
    for (const [i, k] of zoznamM(iu.klasifikacia).entries()) {
      if (!je(k.povinnost)) yield ctx.diag(n, `klasifikácia \`${pyStr(k.system)}\` bez \`povinnost\` ostáva v IDS applicability, takže objekt bez kódu do kontroly nespadne; ak má kód byť povinný, daj \`povinnost: required\` (V25)`, ["klasifikacia", i]);
    }
  }
});

// ------------------------------------------------------------------------------------------------ E

const PODRIADENE_UROVNE = ["tim", "funkcia"];
const aspektyIuO = (m: M | null) => (m ? ASPEKTY.filter((a) => pravda(m[a])) : []);

pravidlo("E1", "E", { popis: "Kontajner je ukotvený", zdroj: "§16.4" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-C")) if (!pravda(iu.viaze_sa_na)) yield ctx.diag(n, "`viaze_sa_na::` je povinné (≥ 1) — bez ukotvenia kontajner nikam nepatrí", ["viaze_sa_na"]);
});

pravidlo("E2", "E", { popis: "Dataset neduplikuje nositeľa v modeli", zdroj: "§16.16, V10" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-C")) {
    const ds = obj(iu.dataset);
    if (iu.druh !== "dataset" || !ds) continue;
    const nositelia = new Map<string, string>();
    for (const p of priradenia(ctx.k, idPoznamky(n) ?? "")) {
      const iuO = ctx.model(p.iu);
      if (!iuO) continue;
      for (const x of zoznamM(iuO.alfanumerika)) nositelia.set(klucPolozky(x), p.iu);
    }
    for (const [i, s] of zoznamM(ds.struktura).entries()) {
      const st = s.stlpec;
      if (pravda(st) && nositelia.has(String(st))) yield ctx.diag(n, `stĺpec \`${st}\` má nositeľa v ${nositelia.get(String(st))} — tabuľka je generovaný pohľad, nie dataset (V10)`, ["dataset", "struktura", i, "stlpec"]);
    }
  }
});

pravidlo("E3", "E", { popis: "Druh kontajnera určuje, čo musí niesť", zdroj: "§5" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-C")) {
    const forma = obj(iu.forma);
    if (iu.druh === "model") {
      if (!pravda(iu.obsahuje)) yield ctx.diag(n, "model bez priradenia (`obsahuje:`) — kontajner bez objektov nič neprenáša", ["obsahuje"]);
      if (!forma || !pravda(forma.format)) yield ctx.diag(n, "model potrebuje `forma.format`", ["forma"]);
      else if (!pravda(forma.verzia_schemy)) yield ctx.diag(n, "model potrebuje `forma.verzia_schemy` (napr. IFC4X3_ADD2)", ["forma"]);
    } else if (iu.druh === "dokument") {
      for (const p of priradenia(ctx.k, idPoznamky(n) ?? "")) {
        const mimo = p.ucinny_rozsah.filter((a) => a !== "dokumentacia");
        if (mimo.length) yield ctx.diag(n, `dokument priraďuje ${p.iu} aspekty ${mimo.join(", ")} — dokument nesie \`dokumentacia\`, geometriu a alfanumeriku nesie model (V27); doplň \`rozsah\``, ["obsahuje", p.index, "rozsah"]);
      }
      if (!je(iu.dokument)) yield ctx.diag(n, "dokument potrebuje blok `dokument` (type, form, struktura)", ["dokument"], "W");
    } else if (iu.druh === "dataset" && !je(iu.dataset)) yield ctx.diag(n, "dataset potrebuje blok `dataset` (kluc, struktura)", ["dataset"], "W");
  }
});

pravidlo("E4", "E", { popis: "Manuálne overenie má postup", zdroj: "§16.2" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-C")) {
    if (iu.overenie === "manual" && !pravda(iu.postup)) yield ctx.diag(n, "`overenie: manual` bez `postup` — akceptačný checklist nemá čo vypísať", ["postup"]);
    if (pravda(iu.automatizovatelne) && !pravda(iu.postup)) yield ctx.diag(n, "`automatizovatelne: true` bez `postup` — doplň, ktorý nástroj kontrolu robí", ["postup"], "W");
  }
});

function statusyCde(ctx: Kontext): Set<string> | null {
  const n = ctx.poznamka("STD-cde");
  if (!n) return null;
  const s = new Set<string>();
  for (const pz of n.pod_zaznamy) if (Array.isArray(pz.data.hodnoty)) for (const h of pz.data.hodnoty) s.add(pyStr(h));
  return s.size ? s : null;
}

pravidlo("E5", "E", { popis: "Vzory identifikácie a revízie sú platné regexy", zdroj: "§5" }, function* (ctx) {
  const statusy = statusyCde(ctx);
  for (const [n, iu] of ctx.typu("IU-C")) {
    const ident = obj(iu.identifikacia);
    if (ident && pravda(ident.vzor)) {
      const ch = platnyRegex(String(ident.vzor));
      if (ch) yield ctx.diag(n, `\`identifikacia.vzor\` nie je platný regex: ${ch}`, ["identifikacia", "vzor"]);
    }
    const cde = obj(iu.metadata_cde);
    if (!cde) continue;
    if (pravda(cde.revizia_vzor)) {
      const ch = platnyRegex(String(cde.revizia_vzor));
      if (ch) yield ctx.diag(n, `\`metadata_cde.revizia_vzor\` nie je platný regex: ${ch}`, ["metadata_cde", "revizia_vzor"]);
    }
    if (statusy && pravda(cde.status) && !statusy.has(String(cde.status))) yield ctx.diag(n, `status ${pyRepr(cde.status)} nie je v slovníku STD-cde (${zorad(statusy).join(", ")})`, ["metadata_cde", "status"], "W");
  }
});

pravidlo("E7", "W", { popis: "Roly kontajnera podľa 19650", zdroj: "§5" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-C")) {
    for (const [i, c] of ciele(iu, "poskytovatel").entries()) {
      const a = ctx.model(c);
      if (a && !PODRIADENE_UROVNE.includes(String(attr(a, "uroven")))) yield ctx.diag(n, `\`poskytovatel:: [[${c}]]\` je celá strana — TIDP sa zostavuje per tím alebo funkciu`, ["poskytovatel", i]);
    }
    for (const [i, c] of ciele(iu, "overuje").entries()) {
      const a = ctx.model(c);
      if (a && attr(a, "strana") !== "poverujuca") yield ctx.diag(n, `\`overuje:: [[${c}]]\` nie je poverujúca strana (19650-4 preberá príjemca)`, ["overuje", i]);
    }
  }
});

pravidlo("E8", "W", { popis: "Priradenie žiada aspekt, ktorý objekt nedefinuje", zdroj: "V27, 7817-1" }, function* (ctx) {
  for (const [n] of ctx.typu("IU-C")) {
    for (const p of priradenia(ctx.k, idPoznamky(n) ?? "")) {
      const c = ctx.model(p.iu);
      if (!c) continue;
      const definuje = aspektyIuO(c);
      for (const a of p.rozsah) if (!definuje.includes(a)) yield ctx.diag(n, `${p.iu} nedefinuje aspekt \`${a}\` (má: ${definuje.join(", ") || "—"})`, ["obsahuje", p.index, "rozsah"]);
      if (!p.ucinny_rozsah.length) yield ctx.diag(n, `${p.iu} nedefinuje ani jeden z aspektov ${ASPEKTY.join(", ")} — priradenie nič nenesie`, ["obsahuje", p.index]);
    }
  }
});

pravidlo("E9", "W", { popis: "MVD patrí modelovému kontajneru", zdroj: "V26, 29481-3 correspondingMvd" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-C")) {
    if (!je(iu.mvd)) continue;
    if (iu.druh !== "model") yield ctx.diag(n, `\`mvd\` na kontajneri druhu ${pyStr(iu.druh)} — pohľad na schému má model, nie dokument ani dataset`, ["mvd"]);
  }
});

pravidlo("E10", "W", { popis: "Dokumentačná väzba a priradenie sa nerozchádzajú", zdroj: "V27, V4" }, function* (ctx) {
  for (const [n, iu] of ctx.typu("IU-O")) {
    const nid = idPoznamky(n);
    for (const [i, d] of zoznamM(iu.dokumentacia).entries()) {
      const dok = link(d.dok);
      if (!dok) continue;
      const kontajner = ctx.poznamka(dok.ciel);
      if (!kontajner || typPoznamky(kontajner) !== "IU-C") continue;
      const pokryte = priradenia(ctx.k, dok.ciel).some((p) => p.iu === nid && p.ucinny_rozsah.includes("dokumentacia"));
      if (!pokryte) yield ctx.diag(n, `${dok.raw} objekt nepriraďuje — doplň \`obsahuje: [{iu: "[[${nid}]]", rozsah: [dokumentacia]}]\` v ${dok.ciel} (V27)`, ["dokumentacia", i, "dok"]);
    }
  }
});
