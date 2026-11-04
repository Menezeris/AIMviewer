---
name: LOIN-06 Typológia
description: Deväť typov požiadaviek A–I zo šablón EIR/BIM protokolu, čo sa dá overiť strojovo, DSS IDS ako ukážka, automatizačná mapa — sekcia 14
status: v1.1 (2026-09-09)
cast_serie: "[[LOIN-00 Index]]"
origin: ai
verified:
---


# 14. Typológia požiadaviek a čo sa dá overiť strojovo

Vstupy: EIR + BIM protokol šablóny (ako vzorka, nie kotva), DSS `Configurations.ids` (ČAS, 2026-07-21, 326 špecifikácií), schémy 7817-3 / 29481-3 / IDS 1.0.

## 14.1 Rozhodnutia z odpovedí (Samuel, 2026-09-08)
- Cieľ: **kvalitne zadať a overiť to podstatné**; nie všetko v EIR bude overiteľné, časť je „právnická".
- Identifikátor požiadavky/objektu: **GUID + zatriedenie do IFC (+ klasifikácia) + projektový identifikátor (napr. `VZT-01-003`)**. DSS zatiaľ nemotať (všeobecne).
- Vyhláška o dokumentaci = jedna z možných hierarchií.
- Federácia všeobecná a nastaviteľná per objednateľ; negatívne pravidlá (v ARS nesmie byť TZB) cez IDS.
- Federovaný model = pohľad; čiastkové modely musia do seba zapadnúť.
- Poradie: **štandard organizácie → projektová odvodenina** (do zmluvy ako PDF + strojovo čitateľné MD).
- ICDD neriešiť.

## 14.2 Typológia požiadaviek (z EIR + BIM protokolu)

| Typ | Príklady zo šablón | Overenie | Automatizovateľnosť |
|---|---|---|---|
| **A. Zmluvno-právne** | licencie (BP 10), zodpovednosť za dáta (BP 4.3, 5.1.5), mlčanlivosť (BP 9), prednosť dokumentov (BP 1.3.3), výklad podľa noriem (BP 1.3.4) | právne; existencia podpísaného dokumentu; nevzťahuje sa na obsah dodávky | žiadna — `zavaznost: zmluvne`, `overenie: administrativne` |
| **B. Organizačno-procesné** | BEP do 30 dní (BP 3.1.4), obsadenie rolí Koordinátor BIM / Správca informácií (BP 6), účasť na koordinácii (BP 7.1.2), postup zmien BEP (BP 8.1.2), TIDP za každý úlohový tím (BP 5.5.2 g) | dôkaz v CDE (dokument existuje, dátum, podpis, menovanie) | nízka–stredná: kontrola existencie/termínu v CDE (API), zvyšok manuál |
| **C. Kontajnerové (informačný štandard)** | IFC 4.3 + natívny (EIR 3.2.1), max. 300 MB, konvencia pomenovania (3.3.5), statusové/revízne kódy (4.3.3), CRS + základný bod (3.4.2–3), podlažia (3.4.4), federácia po profesiách a SO (3.3.3–4), bezpečnosť (BP 9) | metadáta CDE + kontrola súboru (hlavička IFC `FILE_SCHEMA`, veľkosť, regex názvu, `IfcProject`/`IfcMapConversion`/`IfcSite`, zoznam podlaží) | **vysoká** (skript/CDE), *mimo IDS* okrem `IfcProject`/`IfcSite` atribútov |
| **D1. Objekt — alfanumerika + identifikácia + klasifikácia + členenie** | vlastnosti podľa účelu, klasifikácia, `Name`/`Tag` = `VZT-01-003`, prvok v priestore/systéme/zóne | **IDS**: property (prítomnosť/hodnota/enum/pattern/dataType), classification, attribute (pattern), partOf, prohibited entity | **vysoká** — jediná plne štandardizovaná trieda |
| **D2. Objekt — geometria** | 5 aspektov 7817-3 (ShapeAssembly, ShapeRepresentation, ShapeInfluence vrátane manipulačných zón, Dimensionality, Appearance, ParametricBehaviour, Location), kolízne tolerancie (EIR 3.4.6) | model checker / skript (typ reprezentácie, Body vs. placeholder, samostatné tvary pre zóny, clash) | stredná — pravidlá existujú, ale **nie IDS**; treba vlastný rule-set nad IFC |
| **D3. Objekt — dokumentácia** | datasheet, protokol, certifikát viazaný na typ objektu (7817-3 `Documentation`) | `IfcRelAssociatesDocument` prítomnosť + formát + register v CDE | stredná — skript; **nie IDS** (bez Document facetu) |
| **E. Dokumentové (podľa hierarchie)** | strom podľa vyhlášky 131/2024 / zmluvných príloh; prítomnosť, formát, metadáta, ukotvenie (`viaze_sa_na`), obsah | register v CDE (prítomnosť/formát/metadáta) skript; ukotvenie skript; **obsah manuál** | prítomnosť/formát vysoká, ukotvenie stredná, obsah nulová |
| **F. Federácia / konzistencia medzi kontajnermi** | žiadne TZB v ARS, priestory len v ARCH, identické podlažia a CRS vo všetkých modeloch, unikátne GUID naprieč, cross-file containment, koordinačné kolízie | per-súbor: **IDS prohibited entity**; cross-file: ETL/skript (porovnanie podlaží, GUID, containment), clash detection | negatívne pravidlá vysoká (IDS); cross-file stredná (vlastný ETL); clash vysoká (nástroj) |
| **G. Odvodenosť dokument ↔ model** (19650-4 *consistency*) | výkaz výmer z modelu, výkresy = pohľad modelu, plochy v zmluve = plochy v modeli | porovnanie hodnôt (model vs. tabuľka/PDF metadáta); deklarácia autora ako minimum | nízka–stredná: len tam, kde je druhá strana štruktúrovaná (xlsx/csv), inak manuál |
| **H. Referenčné vstupy** | podklady od objednateľa (EIR 6) | neoveruje sa u dodávateľa; sleduje sa použitie (→ G) | — |
| **I. Účely a ciele** | U_PK…U_CDE, ciele | neoveriteľné priamo; overujú sa cez odvodené požiadavky (trasovateľnosť UC → IU) | — (pohľad: pokrytie) |

**Sémantické rozhodnutie:** každá požiadavka nesie `typ` (A–I), `zavaznost` (zmluvne | musi | ma | informativne), `overenie` {metoda: IDS | skript-kontajner | skript-cross-file | model-checker | CDE-metadata | manual | administrativne; nastroj; pravidlo_id}, `dokaz` (čo sa predkladá), `overuje` (rola). Požiadavka bez `overenie` je prípustná len s `zavaznost: zmluvne` alebo `informativne`.

## 14.3 Čo hovorí DSS `Configurations.ids` (ako ukážka, nie záväzok)
- **Štruktúra = alfanumerická projekcia jednej 7817-3 `Specification`:** `ids:info` nesie *purpose* („Tvorba projektové dokumentace"), *milestone* („Povolení"), aktéra v `description` („Aktér(Zadavatel)") a typ stavby v `title` → presne prerekvizity; 312 špecifikácií = `SpecificationPerObjectType` (kľúč: IFC entita + CCI kód `^EQB004.*` v systéme „RDS - Komponent"). **Jedno IDS = jedna Specification** — použiteľné mapovanie.
- **14 štrukturálnych pravidiel (ID 01–14):** klasifikácia RDS po fazetách (Stavební komplex, entita, Komponent, Funkční/Technický systém, Zóna, Vybudovaný prostor), zákaz `IfcBuildingElementProxy` (prohibited), a tri **PartOf**: prvok ∈ zóna (`IFCRELASSIGNSTOGROUP`→`IFCZONE`), ∈ systém (`IFCRELASSIGNSTOGROUP`→`IFCSYSTEM`/`IFCDISTRIBUTIONSYSTEM`/…), ∈ priestor (`IFCRELCONTAINEDINSPATIALSTRUCTURE`→`IFCSPACE`/`IFCBUILDINGSTOREY`). → potvrdzuje náš `clenenie` → IDS PartOf.
- **Slabiny (čo nerobiť):** iba `cardinality="required"` = **prítomnosť**; `propertySet` = `.*` (ľubovoľný pset — názov psetu sa nevynucuje); **žiadny `dataType`, jednotka, hodnota, enum, rozsah**; 623 property riadkov = 167 unikátnych názvov (napr. „plocha" 152×) bez definície, čo je „plocha" — presne náš `DEF-`/`Property.Definition` problém; geometria, dokumenty, cross-file — nič. Vlastnosti majú URI do slovníka ČAS (dobrý vzor pre `PROP-` → `correspondingExternalElement`/`dt:about`).

## 14.4 Automatizačná mapa (čo vie ktorá schéma poháňať)
```
7817-3 AlphanumericalInformation + 29481-3 constraint  →  IDS (D1)
7817-3 GeometricalInformation enumy                     →  rule-set model checkeru (D2)
7817-3 Documentation + viaze_sa_na                       →  skript IfcRelAssociatesDocument + CDE register (D3, E)
7817-3 GeoReferencing + IU-C blok                        →  skript nad IfcProject/IfcMapConversion, hlavička, názov, veľkosť (C)
IU-C federačné pravidlá                                  →  IDS prohibited (per súbor) + cross-file ETL (F)
akceptácia (19650-4 7.1–7.7)                             →  checklist generovaný z typov A–I (pohľad)
```
Odhad (skúsenosť, nie meranie): z bežnej ručnej kontroly BIM koordinátora je automatizovateľné ~60–70 % *objemu* (C, D1, D3-prítomnosť, E-prítomnosť/formát, F-negatívne, clash), ale ~30–40 % *rizika* ostáva manuálne (D2 kvalita geometrie, E obsah, G odvodenosť, A/B).

## 14.5 Dôsledok pre „štandard organizácie → projekt"
Knižnica obsahuje požiadavky všetkých typov A–I so `zavaznost` a `overenie`. Projektová odvodenina = filter (UC × EV × aktér × objednateľ-parametre) → generuje: **PDF do zmluvy** (A+B próza, C–F tabuľky), **IDS** (D1 + F-negatívne), **skripty/checklisty** (C, D2, D3, E, G), **MD balík** ako zdroj pravdy.

Otázka: ak dokumenty v LOIN dostatočne oštrukturujeme, vypadne z nich zoznam a hierarchia informačných kontajnerov, prepojená s objektmi — a zvyšok je len náhľad?

---