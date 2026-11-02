# VALIDATION-RULES — pravidlá validátora

<!-- Vygenerované z plánovacieho kola 2026-09-10 (plan mode, Claude Code). Záväzný zdroj polí: docs/SCHEMA-v1.md. -->

**Stav implementácie (F2a + V19, doplnené V26/V27 14. 9.):** 61 pravidiel je implementovaných v `assetin/engine/validator/`, 21 je pokrytých inde (schéma, loader, graf), 8 čaká na F2b (IFC 4.3 cez IfcOpenShell, bSDD). Register vypíše `assetin pravidla`; test `test_register_pokryva_dokumentaciu` stráži, že tabuľky nižšie a kód sedia. Každé implementované pravidlo má negatívny fixture v `tests/fixtures/md/chybne/`.

Úrovne: **E** chyba, **W** varovanie, **I** info. Overiteľnosť: **G** graf/súbor, **IFC** schéma IFC 4.3 (IfcOpenShell), **bSDD** online cez API s cache (`--offline` vypne). Zdroj: `§16.n` SCHEMA v1.2, `§0.n`, `§14b`, `vzor`, `nové`. Pydantic vrstva (typy, enumy §14, XOR) beží pri načítaní; grafová po rozlíšení odkazov. Visiace odkazy = **W** (CLAUDE.md), ale generátor ich pre svoj cieľ povýši na E (H2).

#### A. Súbor, identita, vrstva
| # | Pravidlo | Úr. | Over. | Zdroj |
|---|---|---|---|---|
| A1 | Frontmatter platný YAML; YAML bloky platné; oddeľovač `·` v štruktúrovanom zápise | E | G | §16.18 |
| A2 | Spoločná hlavička §0.5: `id, guid, typ, nazov, nazov_en, stav, verzia, jazyk` (+ `autor, licencia`); `nazov_en` neprázdny | E | G | §0.5, §16.12 |
| A3 | `id` == ID z cesty (`PathScheme`); `typ` == priečinok; `aliases` obsahuje `id` (W ak chýba, writer doplní) | E / W | G | §0.4, V18 |
| A4 | ID unikátne naprieč poznámkami a bare-linkovateľnými pod-záznamami | E | G | §0.4 |
| A5 | Neznáme pole mimo schémy (`extra=forbid`) | E | G | nové |
| A6 | Pole nájdené v nesprávnom nositeli (frontmatter vs. inline vs. blok) alebo v oboch | E | G | §0.3 |
| A7 | Enumy §14 (`stav`, `typ_ulohy`, `zrelost`, `uroven`, `zdroj_ir`, `faza_iso22263`, `typ_udalosti`, `rola`, `povaha`, `povinnost`, `pritomnost_v_modeli`, `strana`, `rozsah`, `plati`, `overenie`, `zavaznost`, `druh`, `datovy_typ`, geometria, `facet`, `relation`) | E | G | §0.8, §14 |
| A8 | **[V19]** Dosadenie v knižnici: v `zadanie/` sú zakázané `GOAL.termin`, `GOAL.aktivum`, `ACT.osoby`, `ACT.zmluvne_oznacenie`, `EV.datum` a typ `PROJ`. `GOAL.uroven` vrstvu neurčuje — je to druh cieľa, nie príznak vrstvy | E | G | §16.6 V19 |
| A9 | ACT: `uroven`/`strana` sedia s cestou; `funkcia` so `strana: poverena|veduca-poverena` má v ceste tím; `poverujuca` tím voliteľný | E | G | §16.17 |
| A10 | `schema_verzia` v `KNIZNICA.md` == verzia enginu | E | G | R6 |
| A11 | Pod-záznam: `id` == prvý token nadpisu | E | G | §6 |
| A12 | `pouzitie[]` = sloveso + podstatné meno (heuristika: CamelCase ≥ 2 slová) | W | G | §16.12 |
| A13 | `guid` prázdny pri `stav ∈ {PUB, WDRL}` | W | G | nové |
| A14 | Názov súboru (`ID <nazov>.md`) sa líši od `nazov`; ACT a index `STD.md` sa nekontrolujú. Editor premenúva iba pri zmene `nazov` (F3) | I | G | §0.4, DATA-MODEL §4 |

#### B. Odkazy
| # | Pravidlo | Úr. | Over. | Zdroj |
|---|---|---|---|---|
| B1 | Wikilink sa rozlíši na existujúce ID | W | G | CLAUDE.md |
| B2 | Kotva sa rozlíši (pod-záznam / úloha / nadpis) | W | G | nové |
| B3 | Typ cieľa ∈ povolené typy poľa (`poskytovatel`/`overuje`/`prijemca`/`aktor`/`zodpovedny_za_meranie` → ACT; `spustacia_udalost`/`vyvolava` → EV; `obsahuje` → IU-O/IU-C; `dok`/`dolozene_v`/`zdroj_hodnot`/`referencne_info`/`predchodca`/`nadvaznost` → IU-C; `definicia_ref`/`odvodene_z` → DEF; `profil` → GEO; `pravidlo`/`zapnute`/`clenenie` → STD pravidlo (v UC `pravidlo` → DEF); `hodnoty_ref` → slovník STD-klasifikacia; `uc` → UC; `prispieva_k` → GOAL; `podporuje_ciel` → GOAL) | E | G | §1–§12 |
| B4 | Tag literál `#aktivum`/`#proces` len vo `viaze_sa_na` (s HTML komentárom/poznámkou) a `EV.objekt` | E / W | G | §16.4 |
| B5 | Cykly: `nadradene_pri_rozpore`, `odvodene_z`, `predchodca`/`nadvaznost`, `nadradeny_uc`, `prispieva_k`, `precondition` | E | G | nové |
| B6 | Inverzné páry: IU-C `dokladuje:: X` ⇔ položka v X má `dolozene_v: [[IU-C]]`; `dokumentacia[].dok` ⇔ IU-C `viaze_sa_na` obsahuje IU-O | W | G | V4 |
| B7 | Bare odkaz na pod-záznam, ktorého ID nie je globálne unikátne (slovník) | E | G | nové |

#### C. UC, ER, EV
| # | Pravidlo | Úr. | Over. | Zdroj |
|---|---|---|---|---|
| C1 | `EV.faza_iso22263 ⊆ UC.faza_iso22263` pre každý ER (cez `ER.uc`, `ER.spustacia_udalost`) | E | G | §16.1 |
| C2 | `ER.spustacia_udalost` len `typ_udalosti: delivery` (≥ 1); `UC/PROJ.spustacia_udalost` len `impact` | E | G | §16.5 |
| C3 | `ER` má práve jeden `uc`; IU-O bez `poskytovatel` ⇒ existuje `ER.poskytovatel_predvoleny` | E | G | §16.10 |
| C4 | ER `prepisy[]` prepisujú len `povinnost | hodnoty | rozsah | profil | zavaznost`; `iu` ∈ `obsahuje`; `polozka` existuje v IU-O a je jednoznačná | E | G | §16.9 |
| C5 | `typ_ulohy` == sumár `ulohy[].typ` úloh poskytovateľov (poverená strana) | W | G | §2 V6, V17 |
| C6 | `ulohy[].aktor` ∈ `aktor::`; `pre_task` kotva existuje; `ulohy[].id` unikátne v UC | E | G | V17 |
| C7 | `zapnute::` cieľ má `plati: na_vyziadanie`; zapnutie `vzdy` pravidla redundantné | E / W | G | §3 |
| C8 | EV: `impact` má `objekt` (IU-O alebo `#aktivum`) a `vyvolava::` len na delivery EV; `delivery` má `planovana` alebo `relativny_termin` | E / W | G | §9 |
| C9 | UC „Fázy → ER“ sekcia je generovaná; obsah ≠ `ER.spustacia_udalost.faza` | W | G | §2 |
| C10 | IU-O/IU-C bez ER; ER bez UC; UC bez ER; EV bez použitia. **[V27]** objekt sa do výmeny dostane aj cez kontajner, ktorý ho priraďuje | W | G | nové |
| C11 | `region` ISO 3166-1 alpha-3; `faza_lokalna` má mapovanie v STD-fazy (ak existuje) | W | G | §2 |
| C12 | ER nesie aspoň jednu informačnú jednotku (`obsahuje::` ≥ 1) | E | G | 29481-1 3.3.10 |
| C13 | **[V27]** IU-O v `ER.obsahuje`, ktorú nenesie žiadny kontajner tejto výmeny („objekt bez kontajnera") | W | G | V27, PAS 6.3.2.1 a |

#### D. IU-O
| # | Pravidlo | Úr. | Over. | Zdroj |
|---|---|---|---|---|
| D1 | `overenie` len podľa §14b pre zložku: alfanumerika/klasifikácia/členenie/materiál → IDS (predvoľba), manual; geometria → manual (predvoľba), clash-detection; dokumentácia → manual | E | G | §16.2 |
| D2 | Požiadavka bez `overenie` (žiadne prípustné) ⇒ `zavaznost ∈ {zmluvne, informativne}` | E | G | §16.3 |
| D3 | `objekt.ifc_entita` existuje v IFC 4.3 ADD2; abstraktná = W; `predefined_type` ∈ enum entity | E / W | IFC | §4 |
| D4 | IFC vlastnosť: `ifc.atribut` je atribút entity (dedičnosť); `ifc.pset` má entitu v `ApplicableEntity` (dedičnosť) a `nazov` v šablóne, inak `vynimka: true`; `template_type` (typ/výskyt) vs. `uroven` = W | E / W | IFC | §16.7 |
| D5 | `uri` tvar bSDD `…/ifc/4.3/class|prop/…` (G); existencia a zhoda s `ifc_entita`/`pset.nazov` cez bSDD API (cache; bez siete = I „neoverené“) | W / W | G / bSDD | §4, §7 |
| D6 | `hodnoty` XOR `hodnoty_ref` (položka aj facet); cieľ `hodnoty_ref` existuje a je slovník v STD-klasifikacia | E | G | §16.15 |
| D7 | `filter[]` bez `cardinality`; filter len zužuje | E | G | §4 V9 |
| D8 | Filter používa atribút/vlastnosť ⇒ existuje nefiltrované STD pravidlo `plati: vzdy` pre entitu a atribút | W | G | §4 V9 |
| D9 | `dokumentacia[].dok` je IU-C | E | G | §16.8 |
| D10 | `dokumentacia[].dokladuje` ⊆ kľúče položiek IU-O; `postup` pri `automatizovatelne: false` | E / W | G | V3, V4 |
| D11 | `tolerancia` ⇒ `dolozene_v` | W | G | §0.6 |
| D12 | `Qto_*` položka má `definicia_ref` (DEF); PROP s `odvodene_z` na DEF | W | G | V2 |
| D13 | Kľúč položky unikátny v IU-O; práve jedna `rola: identifikacia` | E / W | G | nové |
| D14 | `klasifikacia[].pravidlo` → slovník; hodnoty inline zakázané | E | G | §0.10 |
| D15 | `geometria.profil` je GEO; aspekty ∈ §14; explicitný aspekt == profil = I (redundantný); > ⅓ IU-O prepisuje = I | E / I | G | §6a |
| D16 | `pritomnost_v_modeli: prohibited` ⇒ prázdna alfanumerika/geometria | E | G | nové |
| D17 | Položka `overenie: IDS` musí byť IDS-vyjadriteľná; „práve jeden“, počet, zhoda s externým zdrojom ⇒ `postup` | E / W | IFC + G | §6 V5, §0.6 |
| D18 | `prop:` položka len na PROP poznámku; PROP `aplikovatelne_na` obsahuje `objekt.ifc_entita` (dedičnosť) | E | IFC | §7 |
| D19 | Heuristika nositeľa (V15): text `pokyn`/`LongName` obsahuje „nájomca, zmluva, osoba“ | I | G | §0.9 |
| D20 | `datovy_typ` je IFC jednoduchý typ VEĽKÝMI a len na položke s `ifc.pset` / `prop`; vlastnosť s `rozsah` bez `datovy_typ` = W | E / W | G | V24, IDS 1.0 |
| D21 | `klasifikacia[]` bez `povinnost` pri `pritomnost_v_modeli: required` (ostáva v applicability, objekt bez kódu unikne) | W | G | V25 (Q36) |

#### E. IU-C
| # | Pravidlo | Úr. | Over. | Zdroj |
|---|---|---|---|---|
| E1 | `viaze_sa_na` ≥ 1 | E | G | §16.4 |
| E2 | `druh: dataset` ⇒ žiadny `dataset.struktura[].stlpec` nemá nositeľa v IU-O z `obsahuje[].iu` (kľúč položky) | E | G | §16.16 |
| E3 | `druh: model` ⇒ `obsahuje` ≥ 1, `forma.format`/`verzia_schemy`; **[V27]** `druh: dokument` ⇒ `dokument.*` a priradenia len s `rozsah: [dokumentacia]` | E / W | G | §5, V27 |
| E4 | `overenie` ∈ {manual} (§14b); `overenie: manual` ⇒ `postup`; `automatizovatelne: true` ⇒ `postup` popisuje nástroj | E / W | G | §16.2 |
| E5 | `identifikacia.vzor`, `metadata_cde.revizia_vzor` platné regexy; `status` z STD-cde (ak existuje) | E / W | G | §5 |
| E6 | `georeferencovanie_prepis` len ak sa líši od STD-FED-01 | I | G | §5 |
| E7 | `poskytovatel` tím/funkcia; `overuje` poverujúca strana; TIDP = IU-C s `poskytovatel` tím | W | G | §5 |
| E8 | **[V27]** `obsahuje[].rozsah` žiada aspekt, ktorý daná IU-O nedefinuje; priradenie bez jediného aspektu | W | G | V27, 7817-1 |
| E9 | **[V26]** `mvd` na kontajneri, ktorý nie je `druh: model` | W | G | V26, 29481-3 |
| E10 | **[V27]** `IU-O.dokumentacia[].dok` mieri na kontajner, ktorý objekt nepriraďuje s aspektom `dokumentacia` (dve strany tej istej väzby, ako B6) | W | G | V27, V4 |

#### F. STD, GEO, DEF, PROP, PROT, PROJ, GOAL
| # | Pravidlo | Úr. | Over. | Zdroj |
|---|---|---|---|---|
| F1 | `rozsah: federacia` iba relačné (cross-file) pravidlo; pravidlo s fixnou `hodnoty` ⇒ `kontajner` | E | G | §16.11 |
| F2 | `hodnoty` XOR `zdroj_hodnot`; `zdroj_hodnot` je IU-C `druh: model` | E | G | §16.14 |
| F3 | Abstraktná `applicability.entity` ⇒ rozvinutie; > 50 podtypov = W | W | IFC | §16.13 |
| F4 | `overenie` STD podľa §14b: objekt/kontajner → IDS, manual; federacia → manual, clash-detection | E | G | §16.2 |
| F5 | `pritomnost_v_modeli: prohibited` ⇒ `requirements` prázdne | E | G | §6 |
| F6 | `overenie: IDS` ⇒ facety IDS-vyjadriteľné (`relation` ∈ §14; entity facet len v applicability); `manual` ⇒ `postup` | E | G | §6 |
| F7 | ```ids núdzový blok len s `vynimka: true` | E | G | §6 |
| F8 | GEO: `aspekty` úplné, enumy §14, `id` tvar `GEO-G[0-3]` | E | G | §6a V8 |
| F9 | DEF: `jednotka`, `zaokruhlenie`, `tolerancia`, `hranica_merania`, `metoda_merania`, `zodpovedny_za_meranie`; `odvodene_z` acyklické | W | G | §8 |
| F10 | PROP: `datovy_typ` ∈ §14; `ifc.pset` nekoliduje s IFC Pset šablónou (vlastný pset) | E / W | IFC | §7 |
| F11 | PROT: `zavaznost: zmluvne`, bez `overenie`; `prednost_dokumentov` ⊆ {PROT, EIR, STD, BEP} | E | G | §11 |
| F12 | PROJ: `spustacia_udalost` impact povinná; `er[]` ER; `udalosti[].ev` ∈ EV odkazované z vybraných ER; `strany` kľúče ACT; `vystupy[]` hash sedí (I) | E / I | G | §12 |
| F13 | GOAL: `aktivum` len pri `uroven: aktivum|projekt`; `termin` len projekt; `prispieva_k` nižšia → vyššia úroveň | E | G | §1 |
| F14 | **[V19]** Cieľ, na ktorý neukazuje žiadny `podporuje_ciel` ani `prispieva_k` — knižnica je katalóg, nie zoznam úloh | W | G | §1 V19 |

#### G. Nositeľ informácie
| # | Pravidlo | Úr. | Over. | Zdroj |
|---|---|---|---|---|
| G1 | Pravidlo `ucel_federacie: true` s `hodnoty`, pričom existuje IU-O tej entity v niektorom ER ⇒ má byť `zdroj_hodnot` | W | G | V11 |
| G2 | `aktiva/` obsahuje len GOAL(aktivum), STD-aktivum, ukazovatele `cde`/`aim` | E | G | §15 V12 |
| G3 | Inline `hodnoty` s ≥ 5 položkami mimo STD-klasifikacia | I | G | §0.10 |

#### H. Generovateľnosť (preflight generátora)
| # | Pravidlo | Úr. | Over. | Zdroj |
|---|---|---|---|---|
| H1 | (ER × poskytovateľ) bez IDS-položky ani zapnutého pravidla ⇒ prázdne IDS | I | G | nové |
| H2 | Visiaci odkaz potrebný pre cieľ (`hodnoty_ref`, `profil`, `zapnute`, `obsahuje`) | E | G | nové |
| H3 | Efektívna položka po prepisoch má rozhodnuteľnú `povinnost`/`zavaznost`; `dataType` odvoditeľný zo šablóny | E | IFC | nové |

#### Zobrazenie v editore
Diagnostika → mapa schéma → (list, riadok, stĺpec): pointer na skalár = bunka; na položku = riadok detailného listu + bunka `id` master listu; bez pointera = bunka `id`. Farba podľa úrovne, správa v tooltipe; list „Diagnostika“ = tá istá tabuľka, klik = skok. CLI: `assetin validate <dir> [--format text|json] [--level warning] [--ifc] [--offline]`, návratový kód 1 pri E.
