---
name: SCHEMA-v1.2 zmeny
description: Revízia SCHEMA-v1 z v1.1 na v1.2 po vzore UC-0101 — štrnásť zmien V1–V14 s presným znením na zapracovanie do SCHEMA-v1.md
status: návrh (2026-09-09) — zapracovať do SCHEMA-v1.md, potom tento súbor zmazať
nadvazuje_na: "[[SCHEMA-v1]]"
origin: ai
verified:
---

# SCHEMA v1.1 → v1.2 — zmeny zo vzoru UC-0101

Hlavička SCHEMA-v1: `status: v1.2 (2026-09-09) — po vzore UC-0101 (V1–V14)`.

## V1 · Fáza (§0 hlavička, §9) — oprava príkladu
`faza_iso22263: [operation, demolition]` → `[maintenance, demolition]`; v §9 `[operation]` → `[maintenance]`. Enum §14 je pravda; „prevádzka" = `maintenance`, mapovanie v STD-fazy.

## V2 · Plochy (§4, §8) — oprava príkladu
V §4 `NetFloorArea … definicia_ref: "[[DEF-plocha-prenajimatelna]]"` → `"[[DEF-plocha-cista]]"`. Do §8 doplniť vetu: *DEF definuje meranú hodnotu (hrubá, čistá). Zmluvné/odvodené hodnoty (prenajímateľná plocha) sú vlastná vlastnosť (PROP) na zóne v utilization UC, s `odvodene_z` na DEF.*

## V3 · Overenie hodnoty voči externému zdroju (§0 pravidlo 6, §4)
Doplniť do §0 bod 6: *`IDS` overuje prítomnosť, typ, vzor, výčet a rozsah hodnoty. Zhoda hodnoty s externým zdrojom (zameranie, zmluva) sa nepíše na položku, ale na dokumentačnú položku, ktorá ju dokladuje: `dokumentacia[].postup`. Položka nesie iba `tolerancia` ako metadáta.*

## V4 · Smer typovaných väzieb (§0 pravidlo 3, §14)
Doplniť do §0 bod 3: *Smer: poznámka/položka, v ktorej pole stojí, je subjekt; cieľ odkazu je objekt. `X nadradene_pri_rozpore:: Y` = Y má prednosť pred X. `X dokladuje:: Y` = X je dokladom pre Y. `X dolozene_v:: Y` = Y dokladuje X (inverzia, používa sa na položkách IU-O). `X odvodene_z:: Y`, `X doplnuje:: Y` – zrejmé.*
§14 väzby: `odvodene_z, nadradene_pri_rozpore, doplnuje, dokladuje` → doplniť `dolozene_v`. V §4 na položkách alfanumeriky `dokladuje:` → `dolozene_v:`; na `dokumentacia[]` ostáva `dokladuje`.

## V5 · IDS a dedičnosť / kardinalita (§6, §16)
§6 doplniť: *`applicability.entity` môže byť abstraktná IFC entita (IFCELEMENT); generátor ju rozvinie na konkrétne podtypy podľa schémy IFC 4.3 (IDS 1.0 dedičnosť nepozná). „Práve jeden" / počet inštancií nie je v IDS vyjadriteľný → vždy `postup`.*
§16 nové pravidlo 13: *abstraktná entita v applicability ⇒ generátor rozvíja; varovanie ak rozvinutie > 50 entít.*

## V6 · `typ_ulohy` (§2)
Nahradiť „`typ_ulohy` = sumár" vetou: *`typ_ulohy` = sumár taskov poskytovateľov (poverenej strany). Preberacie tasky príjemcu (kontrola, autorizácia) sú v každom delivery UC a do sumáru sa nepočítajú. `utilization` = UC, ktorého poskytovateľské tasky informácie používajú, nie vyrábajú (UC-0201); `oboje` len ak poskytovatelia robia jedno aj druhé.*

## V7 · ACT súbory (§0 pravidlo 4, §10)
§0 bod 4 doplniť: *Výnimka ACT: názov súboru = posledný segment cesty; strana a tím ako folder-note (`poverujuca/poverujuca.md`, `poverena/ARCH/ARCH.md`).*
§10: *Tím je povinná úroveň pre `strana: poverena | veduca-poverena` (TIDP). Poverujúca strana má funkcie priamo pod stranou (`ACT-poverujuca/koordinator-BIM`).*

## V8 · GEO-G0 (§6a)
„~4 globálne profily" → *profily: G0 bez geometrie (IfcBuildingStorey, IfcZone, IfcSystem), G1 schematická, G2 koordinačná, G3 detailná; definované v STD-geo-profily.*

## V9 · Filter a nefiltrované pravidlo (§4 `filter`)
Doplniť: *`filter` zužuje applicability, nič nevynucuje. Ak filter používa atribút/vlastnosť, ktorá musí existovať na všetkých inštanciách entity, existuje k nej nefiltrované STD pravidlo `plati: vzdy` (vzor: STD-CL-06 pre IfcZone.ObjectType).*

## V10 · DiMS je databáza; tabuľky o objektoch modelu nie sú kontajnery (§5, §13)
§5 doplniť k `druh`: *Informácie o objektoch, ktoré majú nositeľa v DiMS (miestnosti, plochy, zariadenia), sa nevedú v samostatnom dataset kontajneri — ich tabuľková podoba je **generovaný pohľad** (export z modelu danej revízie), ktorý môže byť súčasťou dokumentu (protokol, výkaz) alebo výstupu §13. `druh: dataset` je vyhradený pre dáta bez nositeľa v modeli (merania v čase, senzorika, harmonogramy).* §13 doplniť riadok: *Tabuľka objektov (room schedule, výkaz) | IU-O daného ER × model danej revízie | per kontajner × revízia*. Potvrdenie tretej strany (geodet) je dokument nad exportom, nie druhá kópia dát — doklad = podpis pod exportom + kapitola odchýlok.

---

# Druhé kolo — obdobné chyby (dáta s nositeľom inde) nájdené v SCHEMA a LOIN-05/08/09

## V11 · Zdieľané slovníky federácie majú master DiMS (SCHEMA §6 STD-FED, A4; LOIN-08 16.3)
Zoznam podlaží s výškami, názvy zón a systémov sú v STD/STD-aktivum ako **ručne udržiavaný zoznam**, hoci majú nositeľa v modeli (IfcBuildingStorey.Elevation, IfcZone.Name) — rovnaká chyba ako tabuľka miestností, len na úrovni federácie. Zmena: pravidlo `rozsah: kontajner` s `ucel_federacie: true` nesie buď `hodnoty` (novostavba, kým master neexistuje) **alebo** `zdroj_hodnot:: [[IU-C-arch-model]]` — master DiMS, z ktorého generátor pri akceptácii vyrobí IDS pre ostatné DiMS. Pri pasportizácii je master vždy ARCH („priestory len v ARCH"). STD drží vzor pomenovania, nie zoznam. Validátor: `hodnoty` a `zdroj_hodnot` sa vylučujú.

## V12 · Vrstva aktívum nie je tieňová databáza CDE/CAFM (SCHEMA §15; LOIN-09 B2/B3)
„register skutočných kontajnerov, história EV" v `aktiva/<budova>/` duplikuje CDE (kontajnery) a AIM/CAFM (udalosti). LOIN-05 13.1 pritom hovorí, že zoznam je *pohľad*. Zmena: vrstva aktívum drží len rozhodnutia (GOAL-aktívum, STD-aktivum prepisy, `zdroj_hodnot` masterov) a **ukazovatele** (`cde: {system, projekt_id}`, `aim: {system, id}`); register kontajnerov a história EV sú generované pohľady §13 s odkazom do CDE/AIM, nie udržiavané zoznamy.

## V13 · Zameranie ako kontajner len ak je DiMS (SCHEMA §5 príklad `predchodca:: [[IU-C-geodeticke-zameranie]]`)
Príklad naznačuje zameranie ako samostatný kontajner. Prípustné iba ak ide o **survey DiMS** (mračno bodov, geodetický model) s vlastnou federačnou rolou; tabuľka zameraných hodnôt nie. Zmena: príklad premenovať na `[[IU-C-mracno-bodov]]` a v §5 doplniť: *dataset/model tretej strany je kontajner iba vtedy, keď nesie objekty, ktoré v cieľovom DiMS nemajú nositeľa (mračno = merané body, nie miestnosti).* Porovnanie survey DiMS vs. ARCH = pravidlo `rozsah: federacia`, `overenie: clash-detection`.

## V14 · Slovníky sa neopisujú do pravidiel ani IU-O (SCHEMA §4 `klasifikacia`, §6 `hodnoty`, §9 príklad)
Rovnaká chyba vnútri knižnice: STD-CL-06 mal výčet typov zón inline, IU-O-space vzor kódu CCI inline, §9 odkazuje `[[IU-O-najomna-jednotka]]` popri `IU-O-zone`. Zmena: na položkách aj v pravidlách pribúda `hodnoty_ref: "[[STD-klasifikacia#…]]"` (vylučuje sa s `hodnoty`), `klasifikacia[].pravidlo` odkazuje na tabuľku v STD-klasifikacia; generátor rozvíja odkazy do IDS enumerácií. Jeden slovník = jedno miesto. §9 príklad → `[[IU-O-zone]]`.

## V15 · Opačný smer: dáta s nositeľom mimo modelu sa neopisujú do modelu (§4 `pokyn`, vzor IU-O-zone)
Vzor mal `LongName` zóny = obchodný názov nájomcu — nájomca má nositeľa v registri nájmov/CAFM, do DiMS patrí len stabilný kľúč (Name) a popisný názov. Doplniť do §0 ako pravidlo 9: *Každá informácia má práve jedného nositeľa. Model nesie to, čo je o stavbe; zmluvy, osoby, prevádzkové stavy nesie CDE/AIM/CAFM; knižnica nesie požiadavky a odkazy. Duplikát je vždy chyba, aj keď je pohodlný.*
