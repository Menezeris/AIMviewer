---
name: LOIN-09 Rozhodnutia
description: Slovník editora (UC/ER/STD/EIR), 21 konsolidovaných rozhodnutí, terminológia cieľ/účel/use case, dopad DIS 19650:2026, revízia v1.1 — sekcie 17–20
status: v1.1 (2026-09-09)
cast_serie: "[[LOIN-00 Index]]"
origin: ai
verified:
---


# 17. Konsolidované rozhodnutia (stav 2026-09-09) a ďalší postup

## 17.1 Slovník editora — štyri slová, zvyšok sú výstupy
| Pojem | Čo je | Normová opora |
|---|---|---|
| **UC** | prečo: use case (+ ciele `GOAL`), aktéri-roly, spúšťacia udalosť (impact), fázy → ER | 29481-1/-3 `uc` |
| **ER** | čo: všetky informačné jednotky (IU-O objekty, IU-C kontajnery) s LOIN a obmedzeniami pre daný use case; zdieľané pravidlá **odkazom** na STD; delivery event; zapnuté podmienené pravidlá | 29481-1 3.3.10, 29481-3 `er` |
| **STD** | pravidlá napísané raz: slovníky (PROP, DEF, klasifikácie, GEO-profily, enumy statusov, funkcie), pravidlá s `rozsah: objekt \| kontajner \| federacia` a `plati: vzdy \| na_vyziadanie`, container breakdown | 19650-2 5.1.4; 7817-1 5.5; PAS obr. 15 |
| **EIR** | vybrané ER dosadené na poverenie (aktéri × udalosti × dátumy) → zmluvný dokument | 19650-2 5.2.1; 29481-1 (1 EIR ↔ n ER) |
| *výstupy/pohľady* | 7817-3 `Specification` (= ER × účel × udalosť × 2 aktéri), IDS (1 na Specification), PDF do zmluvy, MIDP/TIDP, RACI, checklist akceptácie | 7817-3, IDS 1.0, 19650-2 5.4 |

Historická nenadväznosť noriem je reálna (29481-3 → 29481-1:2016; 7817-1 vs. 7817-3 kardinalita účelu; štyri mená pre dve veci) — riešená tým, že MD je zdroj pravdy a schémy sú exportné profily.

## 17.2 Rozhodnutia — zoznam
1. **Knižnica → projekt:** štandard organizácie a ER sú generické; projekt = dosadenie/filter, nikdy kópia (výnimka: snapshot verzie).
2. **ER patrí jednému UC**; jeden UC môže mať viac ER (per fáza/udalosť); deduplikácia na úrovni IU.
3. **EIR obsahuje viac ER**; 1 ER × aktér × udalosť = 1 `Specification` = 1 IDS.
4. **ER je agnostický voči IMS/DiMS** — „v čom" rieši STD (container breakdown) a `obsahuje` na IU-C; výnimka: kontajner ako samotná potreba use case (koordinácia, odovzdanie).
5. **Jeden štandard**, pravidlá nesú `rozsah`; IMS je pohľad, `federacia` pravidlá sa overujú nad množinou DiMS.
6. **Štruktúra členenia** (podlažie > priestor, prvok ∈ podlažie/priestor, systémy, zóny, zákazy) = `STD-clenenie`, `plati: vzdy`; IU-O odkazuje len pri výnimke. IDS PartOf overuje z pohľadu dieťaťa; rodičovská kardinalita = manuál.
7. **Aktéri:** dve osi — organizačná cesta `strana/tím/funkcia` (register `ACT-`, tím povinná úroveň kvôli TIDP) a transakčná rola na IU/ER (`poskytovatel`, `prijemca`, `overuje`). Koordinátor BIM a CDE administrátor = samostatné funkcie. Osoby len v projekte.
8. **Spúšťacia udalosť:** jedno pole, register `EV-` s typmi `delivery | impact`; impact na UC, delivery na ER; IU dedí.
9. **Objekt:** `IU-O` = 7817-3 `SpecificationPerObjectType`; identifikácia = atribút `Name` (`VZT-01-003`, pattern), typ vs. výskyt rozlíšený.
10. **Kontajner:** `IU-C` = 29481-3 `informationUnit` + kontajnerový blok (formát, ID, metadáta, georeferencovanie, TIDP polia); priradenie `obsahuje` M:N na kontajneri; dokumentový kontajner = IU-C bez `obsahuje`.
11. **Ukotvenie:** povinné `viaze_sa_na` (≥1): typ objektu → systém → priestor → aktívum → proces (výnimka vedome).
12. **Kontajnery sa neodvodzujú z LOIN Documentation** — register = dokumentové (z LOIN cez GUID) ∪ modelové (z federačnej stratégie); hierarchia = explicitný strom v STD.
13. **Obmedzenia** v jednotnom tvare `{typ, hodnota, overenie}` pre všetky tri zložky; hodnotové v PROP (23387), štruktúrne v STD, požiadavkové na IU. **Výčet prípustných hodnôt v LOIN je v poriadku** (7817-3 `PossibleValues` = IDS enum); voliteľný tag `zdroj: informacny | technicky`.
14. **Geometria:** aspekty 7817-3 sú pravda, `GEO-Gx` profily = presety v STD (~4), IU-O prepisuje; `poznamka {zahrna, nezahrna, text}`; export label + rozbalená tabuľka.
15. **Naming = tri veci** (ID kontajnera / `Name` objektu / zdieľané slovníky naprieč DiMS) s tromi rozsahmi.
16. **`overenie` = jediné povinné pole; tri hodnoty:** `IDS` (preklik = ID pravidla, generované), `manual` (+ `postup`, voliteľne `automatizovatelne: true`), `clash-detection`. Skripty nateraz nie. Bez `overenie` len `zavaznost: zmluvne | informativne`.
17. **IDS sa generuje**, nepíše: zo STD (`plati: vzdy` + zapnuté), z IU-O daného ER a z ER (`ids:info`); `identifier` = ID pravidla; deterministicky, validované ids-checkerom; príloha zmluvy = vygenerovaný súbor + verzia/hash. Núdzový ` ```ids ``` ` blok len ako označená výnimka.
18. **Typológia požiadaviek A–I** a **`zavaznost`** (zmluvne/musí/má/informatívne) — naše rozšírenia.
19. **Metadáta** (tolerancia, presnosť, spoľahlivosť, status) mimo LOIN, na IU/IU-C.
20. **`X_` väzby v1:** `odvodene_z`, `nadradene_pri_rozpore`, `doplnuje`, `dokladuje` — smerované inline polia.
21. Nadradený UC (pasportizácia) + sub-UC; export 1 sub-UC = 1 `idm`.

## 17.3 Otvorené (malé)
- [ ] číselník funkcií aktérov (19650 + BIM protokol) — dopísať;
- [ ] kvalifikátor rozsahu v `obsahuje` (len geometria / len alfanumerika) — rozhodnúť pri vzore;
- [ ] tabuľka fáz ISO 22263 ↔ SK stupne PD ↔ CZ 131/2024;
- [ ] `zdroj` tag — ponechať/vypustiť pri vzore.

## 17.4 Odporúčaný ďalší postup
1. **Zamraziť polia v1** — jedna poznámka `SCHEMA-v1.md`: frontmatter každého typu (UC, ER, IU-O, IU-C, STD pravidlo, PROP, DEF, EV, ACT) s názvami polí podľa 29481-3/7817-3, kde existujú. Bez toho sa vzory nedajú porovnať.
2. **Prvý vzor na jednom reťazci, end-to-end:** `UC-0101` priestorová pasportizácia → `ER-0101` → 3× IU-O (IfcSpace, IfcBuildingStorey, IfcZone) → 1× IU-C (ARCH model) + 1× IU-C dokument (protokol zamerania) → 3× PROP (plocha podľa DEF, kód miestnosti, názov) → 2× DEF (hrubá vs. prenajímateľná plocha) → `STD-clenenie` (5 pravidiel) → `EV-` (2 udalosti) → `ACT-` (3 cesty). Cieľ: nájsť, kde model škrípe, nie dokonalosť.
3. **Ručne napísať IDS z toho vzoru** (nie generátor!) — ~6 špecifikácií — a prehnať ids-checkerom. Overí, či polia nesú všetko, čo IDS potrebuje.
4. **Až potom `UC-0201` nájmy** (utilization) — test, že tá istá IU funguje ako výstup jedného a vstup druhého, a že `nadradene_pri_rozpore` (zmluva vs. model) sa dá zapísať.
5. **Dataview pohľady** nad vzorom: EIR tabuľka, register kontajnerov, RACI. Ak sa dajú vygenerovať bez ručných zásahov, model je správne veľký.
6. Paralelne, bez blokovania: obstarať CEN/TR 17654, prečítať Liu 2023 + Akbas 2025 + LOINxml (2026) — porovnať názvy polí pred finalizáciou; pushnúť tento súbor do vaultu (`10_Notes/` alebo `30_Projects/assetin-library/`).
Generátor IDS, PDF export a ICDD až po kroku 5.

---

# 18. Terminológia: cieľ, účel, use case (uchované vysvetlenie)

- **Use case** = scenár: „sled činností rolí na dosiahnutie účelu" (29481-1 3.3.2). Slovo *use* = použitie procesu aktérmi, **nie** použitie informácie. Scenár informácie potrebuje (utilization tasky) aj vyrába (delivery tasky). Vzorový IDM normy „Design Authoring" je výrobný scenár → pasportizácia je plnohodnotný use case.
- **Purpose** v normách je *lokálne prečo* scenára: 29481-1 `aimAndScope`, 7817-1 „proč", PAS „purpose = use case + business kontext", 19650-1 5.1 „purposes" (PAS ich rovno nazýva use cases). V CZ/SK praxi = **„účel užitia"** (U_PK, U_PD…) → zobrazovaný názov UC.
- **GOAL** je *organizačné prečo* — 19650-1 kaskáda **OIR → AIR → PIR**: jeden typ, `uroven: organizacia | aktivum | projekt`. Projektový cieľ = príspevok projektu k aktívovému/organizačnému; nižšia úroveň je nutná, nie postačujúca (portfóliový charakter, prevádzkové procesy). Asset vrstva je pre pasportizáciu primárna (prevádzková fáza bez výstavbového projektu). Nie „BIM objective" — BIM je len prostriedok.
- **Business kontext** ≠ GOAL: GOAL = výsledok; business kontext = ako scenár prebieha (tasky s typom a rolou, rozhodnutia). Je jediné miesto, ktoré odôvodňuje konkrétnu IU (`IU ← task ← UC ← GOAL`) → minimum podľa 19650-1 11.2, argument voči dodávateľovi, cieľ delivery eventu.
- **Task** (PAS 6.2.1) je atomický, vždy delivery alebo utilization (verifikácia, schvaľovanie, správa CDE = utilization). UC ≠ task; UC obsahuje tasky. `typ_ulohy` na UC = sumár.
- Synonymá UC: účel užitia (ČAS), prípad použitia / případ užití (ČSN 29481), Anwendungsfall (VDI/UCM), BIM use (Penn State), scenár.

---

# 19. ISO/DIS 19650-1/-2:2026 — dopad na model (sekundárne zdroje, DIS nefinálny)

Zmeny: (1) zrušené delenie dodacia/prevádzková fáza, jeden 9-krokový proces; (2) **trigger event** ako pivot — každý projekt je odpoveď na trigger event, projekt = intervencia v kontinuálnom cykle; (3) OIR/AIR/PIR = **perspektívy stakeholderov**, nie dokumenty: identifikovať účely → zosúladiť s LOIN (7817) → zlúčiť do jednej organizačnej sady → filtrovať podľa projektu a poverenia; (4) EIR → Information Production Requirements, BEP → Information Production Plan, MIDP+TIDP → Information Production Schedule, PIM bez samostatného miesta, AIM trvalý; FM (ISO 41001) explicitne; (5) oddelenie information management vs. information production, IM tímy na org. aj projektovej úrovni; (6) 7.2.2 viaže LOIN na 7817-1.

Dopad: **„projekt" v GOAL/PROJ = odpoveď na impact event** (zjednotenie s PAS 6.1.3) → PROJ má povinné `spustacia_udalost` (impact); `zdroj_ir` na GOAL je perspektíva; náš model knižnica → projekt/poverenie je presne DIS postup (potvrdenie); interné názvy sa nemenia, export má aliasový prepínač 2018 ↔ 2026; PIM/AIM v modeli netreba. Odporúčanie: získať text DIS cez ÚNMS/ÚNMZ pripomienkovanie.

---

# 20. Revízia schémy v1 → v1.1 (2026-09-09) — rozhodnutia

**B1 fáza:** `UC.faza` = prípustnosť scenára; `EV.faza` = kde udalosť nastáva (oba typy, list; impact = stav aktíva, delivery = fáza projektu; impact.faza je prvý filter prípustných UC); ER fázu nemá, dedí z EV; UC „Fázy → ER" generované; validátor `EV.faza ∈ UC.faza`. EV je samostatná poznámka v registri; ER si udalosť *vyberá*, IU dedí, PROJ dáva dátum.
**B2/B3 vrstvy:** hlavičkové `zdroj` **vypustené** — vrstvu (organizácia / aktívum / projekt) určuje priečinok; validátor stráži obsah priečinkov; `GOAL.uroven` ostáva ako jediné dátové vyjadrenie úrovne; alfanumerika `zdroj` → `povaha`. Knižnica = organizačný štandard Assetinu (PAS organisational specification, DIS „jedna organizačná sada"); aktívum = trvalé (GOAL-aktívum, STD prepisy CRS/klasifikácia, register skutočných kontajnerov, história udalostí); projekt = epizóda (PROJ, dátumy, osoby, výstupy s hashom). Nižšia vrstva nekopíruje, vyberá a prepisuje.
**A1 per položka:** `overenie`, `zavaznost`, `typ_poziadavky`, `postup`, `automatizovatelne`, tolerancia/presnosť/spoľahlivosť žijú na položke (alfanumerika, dokumentácia) resp. na bloku geometria; IU má len predvoľby. **`overenie` je obmedzené zložkou**: alfanumerika + STD štruktúra/zákazy/naming → IDS (predvoľba) | manual; geometria → manual (predvoľba) | clash-detection; dokumentácia, kontajner → manual; federácia → manual | clash-detection. Autor `overenie` a `typ_poziadavky` prakticky nepíše (odvodené zo zložky), píše `zavaznost` len ak ≠ musí a `postup` pri manual. `metadata` blok na IU zaniká.
**A2 poskytovateľ:** autoritatívny na **IU** (kto jednotku vyrába; 19650-2 TIDP per tím, PAS delivery task); ER má len `poskytovatel_predvoleny`; PROJ nič neprepisuje, len mapuje roly na zmluvné strany; príjemca na ER (IU dedí); `overuje` per IU. Generátor delí Specification/IDS podľa (ER × udalosť × poskytovateľ) — **iba v exporte**, model to nerieši (7817-3 je CD, kardinalita sa môže zmeniť). TIDP = `IU-C where poskytovatel = tím`.
**Hranica ER vs. sub-UC:** ER = UC × delivery event × príjemca; poskytovateľov v ER môže byť viac. Profesie sa delia na **sub-UC** tam, kde sa líšia tasky/aktéri/jednotky (priestorová vs. TZB pasportizácia), nie kvôli poskytovateľovi. ER sa delí, keď sa líši udalosť alebo príjemca (koncept vs. čistopis).
**A3 povinnosť (IDS-natívne):** IU-O = *šablóna špecifikácie*, ER = *IDS súbor*; „prepisy" v ER = delta medzi zdieľanou šablónou a materializovanou špecifikáciou (IDS zdieľanie nepozná — každý súbor je úplný); prednosť ER > IU-O; ER prepisuje hodnoty (povinnost, hodnoty, profil), nie definície. Z IDS (github buildingSMART/IDS, ids.xsd 1.0) doplnených **5 polí**: `pritomnost_v_modeli` (kardinalita špecifikácie required|optional|prohibited — „aspoň jeden IfcSpace v modeli"), `filter` (applicability nad rámec entity+klasifikácia: attribute/property/partOf/material), `zdovodnenie` (→ description; generované z pre_task/GOAL), `pokyn` (→ instructions, pre autora modelu; na IU-O aj položke, všeobecné aj pre geometriu/dokumentáciu, exportované len pri IDS položkách), **material facet** ako položka alfanumeriky. Mapovanie: ids:info ← ER; specification ← IU-O v kontexte ER; requirements facety ← položky (cardinality=povinnost, uri, instructions=pokyn, restrictions=hodnoty/vzor/rozsah). IDS 1.x neplánuje geometrický ani dokumentový facet → deľba `overenie` je trvalá.
**A4 georeferencovanie:** cieľ federačný, overenie kontajnerové. Kanonické hodnoty (CRS EPSG:5514, výškový Bpv, základný bod E/N/H, rotácia) = pravidlo `STD-FED-01`, `rozsah: kontajner`, `overenie: IDS` (attribute facety IfcProjectedCRS/IfcMapConversion/IfcSite; nie sú IfcRoot — overiť podporu v cieľovom checkeri, fallback manual), flag `ucel_federacie: true` pre zaradenie do kapitoly federácia. Každý DiMS sa overuje zvlášť proti tej istej hodnote → konzistencia vyjde bez cross-file kroku; clash detection až nad takto overenými modelmi. IU-C nesie georeferencovanie len ako prepis (`model_cs`), 7817-3 `GeoReferencing` sa plní z STD. **Zovšeobecnenie:** všetko, čo sa dá vyjadriť fixnou hodnotou (podlažia, jednotky, klasifikačný systém, názvy zón/systémov) je `kontajner` + IDS; `federacia` ostáva len pre relačné cross-file pravidlá (unikátnosť GUID naprieč súbormi, cross-file containment, kolízie).
**Nasleduje:** A5 (inline dokument zrušiť), A6 (identifikácia = alfanumerika s `rola: identifikacia`), C1–C11.