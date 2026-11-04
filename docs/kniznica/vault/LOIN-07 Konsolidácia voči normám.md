---
name: LOIN-07 Konsolidácia
description: Matica zhody návrhu voči textom noriem a schémam (N/T/R/K), konflikty a ich riešenia, čo je naše rozšírenie — sekcia 15
status: v1.1 (2026-09-09)
cast_serie: "[[LOIN-00 Index]]"
origin: ai
verified:
---


# 15. Overenie celého návrhu voči normám a schémam (konsolidácia)

Legenda: **N** = natívne v schéme · **T** = v texte normy, v schéme chýba (export cez rozšírenie) · **R** = naše rozšírenie bez normovej opory · **K** = konflikt / napätie medzi zdrojmi.

## 15.1 Matica zhody

| Prvok návrhu | Opora v texte noriem | Opora v schéme | Stav |
|---|---|---|---|
| **GOAL-** ciele organizácie / aktíva (+KPI) | 19650-2 5.3.2 b; 19650-1 5.1 | 29481-3 `benefits`, `scopeKeyword` (text) | T |
| **UC-** use case | 29481-1 3.3.2, 5.3 | 29481-3 `uc` (1:1 per idm) | N |
| UC `pouzitie` sloveso+podst. meno | 29481-1 tab. 1 | `use` 1:* | N |
| UC `region`, `jazyk`, `stav`, `verzia` | 29481-1 5.3 | `region` 1:*, `language`, `documentStatus`, `version` | N |
| UC `constructionEntity`, `limitations` | UCM „Delimitation" | `constructionEntity`, `limitations` | N |
| UC `aktori` (rola + klasifikácia) | 19650-1 kap. 7; 19650-4 3.2 | `actor{id,name,classification}` | N (klasifikácia podľa 19650 = naša voľba) |
| UC → ER cez fázy | 29481-1 5.3.2 | `standardProjectPhase → associatedEr` | N |
| sub-UC ako samostatné poznámky | 29481-1 A.2.2 | `subUc` / `subIdm` | N (1 sub-UC = 1 `idm`) |
| **ER-** exchange requirement | 29481-1 3.3.10 | `er` (0:1 per idm), `subEr` | N |
| ER = množina IU; IU 1:* | 29481-1 | `informationUnit` 1:* | N |
| ER `forma` (formát/schéma/IDS) | PAS aspekt d; 19650-4 A | `correspondingMvd` | N (čiastočne) |
| ER `referencne_info` | 19650-2 5.1.6; PAS aspekt c | — | T |
| ER `precondition` | 29481-1 5.5.1 | — (len `subEr`) | T |
| **EIR = Specification** (účel × udalosť × 2 aktéri) | 19650-1 3.3.6; PAS obr. 24 | 7817-3 `Specification/Prerequisites` 1:1:1:1 | N |
| viac účelov na jednu LOIN (knižnica) | 7817-1 5.2 príkl. 2 | 7817-3 Purpose 1:1 | **K** → knižnica: zoznam; inštancia: jedna Specification |
| neznámy poskytovateľ v ranej fáze | 7817-1 5.4 príkl. 1 | 7817-3 ProvidingActor 1:1 | **K** → to isté riešenie |
| **IU-O** typ objektu | 7817-1 5.5 (objekt) | 7817-3 `SpecificationPerObjectType/ObjectType` (23387, `dt:about`) | N |
| IU-O `clenenie` (breakdown) | 7817-1 5.5 | 7817-3 len `Location.ReferenceObject` (voľný text); **IDS PartOf** | T + N (IDS) |
| IU-O geometria (5 aspektov, enumy) | 7817-1 6.2 | 7817-3 `GeometricalInformation` | N |
| IU-O alfanumerika → PROP | 7817-1 6.3 | 7817-3 `Property` (23387) | N |
| IU-O identifikácia = `Name` pattern (`VZT-01-003`) | 7817-1 6.3.2 | IDS **Attribute** facet (pattern); 7817-3 `Property` s `dt:about` = URI IFC atribútu `Name` + `Definition` = pravidlo; 29481-3 `businessRule` | N (mapované) |
| IU-O dokumentácia (+formát) | 7817-1 6.4 | 7817-3 `Documentation/Document` (+`Format`) | N |
| **PROP-** knižnica vlastností | 7817-1 6.3.1 (23387) | 7817-3 = 23387 `Property`; externý súbor cez `referenceURI`+`GUID` | N |
| **DEF-** definícia hodnoty (plocha podľa…) | 29481-1 5.5.2–3 | 7817-3 `Property.Definition` + `ReferenceDocumentRef`; 29481-3 `businessRule` | N (rozdelené: definícia / pravidlo) |
| **IU-C** kontajner | 19650-1 3.3.12, 10.4; 19650-2 5.4.4 | 29481-3 `informationUnit` (+`subInformationUnit`); 7817-3 **nemá** | T (export do 29481-3) |
| IU-C kontajnerový blok (formát, naming, veľkosť, statusy) | 19650-2 5.1.4, 5.1.7 | — | T |
| IU-C georeferencovanie | 19650-2 5.1.4 (CRS) | 7817-3 `GeoReferencing` | N |
| IU-C TIDP polia | 19650-2 5.4.4 | — | T |
| ALLOC `obsahuje` (M:N na kontajneri) | 19650-2 5.4.2, 5.6.2 b | — | T |
| **viaze_sa_na** → typ objektu | 7817-3 Documentation vnorená v ObjectType | N | N |
| `viaze_sa_na` → systém / priestor / aktívum | IFC `IfcRelAssociatesDocument`; IEC 62023; 81346 | — (mimo LOIN/IDM schém) | T |
| `viaze_sa_na` → `proces` | — | — | **R** |
| **EV-** delivery / impact | 19650-3 trigger events; PAS 6.1.3 | 7817-3 `InformationDeliveryMilestone` (+@Date); 29481-3 fázy; IDS `info/milestone` | N (delivery) / T (impact) |
| `spustacia_udalost` ako jediné pole *kdy* | 7817-1 5.3; PAS | — | N/T |
| **STD-** informačný štandard | 19650-2 5.1.4 („metoda přiřazování LOIN") | — | T |
| **akceptacia** {kritérium 19650-4, dôkaz, kto} | 19650-2 3.1.1.1, 5.2.1 c; 19650-4 kap. 7 | 29481-3 `constraint` (voľný text) | T |
| **overenie** {metóda, nástroj, pravidlo} | 7817-1 kap. 7; 19650-4 | IDS ako nástroj pre D1/F | T |
| reviewer | 19650-4 3.2.3 | 7817-3 len 2 aktéri | T |
| RACI | 19650-1 10.3; 19650-2 5.4.2 | — | T |
| **typ požiadavky A–I** | čiastočne 19650-2 5.2.1 a–e, 5.1.x | — | **R** (naša typológia) |
| **zavaznost** (zmluvne/musí/má/informatívne) | ISO shall/should/may | 29481-3 `isMandatory` (bool) | **R** (rozšírený enum) |
| **X_ väzby** (odvodené_z, nadradené_pri_rozpore, doplňuje, dokladuje) | 7817-1 6.1, 6.5; BIM protokol 1.3.3; EIR 3.2.1 i | — | **R** (typológia naša; koncept T) |
| knižnica → projekt (filter, snapshot) | PAS 6.3.6; 19650-1 | IDS `info` (purpose, milestone) ≈ Prerequisites | N/T |
| 1 IDS = 1 Specification | — | IDS `info/purpose`, `info/milestone`; specs ≈ `SpecificationPerObjectType` | N (mapovanie) |
| metadáta mimo LOIN (tolerancia, presnosť, spoľahlivosť, status) | 7817-1 6.1 pozn. 3, kap. 7 | — | N (zámerne mimo) |

## 15.2 Konflikty a ako sú vyriešené
1. **7817-1 text vs. 7817-3 schéma** (viac účelov / neznámy poskytovateľ): schéma je prísnejšia. Riešenie: knižničná IU nesie zoznam UC a rolí; projektová `Specification` je vždy 1×1×1×1. Žiadny zásah do modelu.
2. **29481-3 `uc` 1:1**: rozpad pasportizácie na sub-UC exportujeme ako viac `idm` súborov + `subIdm`. Interný model nezmenený.
3. **29481-3 odkazuje na 29481-1:2016**, nie 2025; 7817-3 je CD s nefinálnym namespace: obe schémy = exportné profily, MD = zdroj pravdy.
4. **Objekt/členenie**: koncept v 7817-1, chýba v oboch schémach → nesieme sami, verifikujeme IDS PartOf, exportujeme do `Location.ReferenceObject` / `correspondingExternalElement`.
5. **Dokumentácia per objekt (7817-3) vs. kontajner ako dodávka (19650-2)**: dve roly tej istej entity; GUID ich spája; kontajnerový register = zjednotenie oboch zdrojov (13.3).
6. **Aktér na jednotke**: 7817-3 dvaja, 19650-4 traja (+reviewer), 19650-2 RACI. Export: 2 do 7817-3; zvyšok do `userDefinedProperty`.
7. **Jazyk**: 29481-3 vyžaduje anglický `shortTitle`; 7817-3 `Purpose.Language`. Dôsledok: každý UC/ER/IU má povinný `kratky_nazov_en`.

## 15.3 Čo je naozaj naše (a nemá normovú oporu)
- typológia požiadaviek A–I; 4-stupňová `zavaznost`; pomenované typy `X_` väzieb; kotva `proces` vo `viaze_sa_na`; `clenenie` zapísané v IDS-tvare (relácia + cieľ); pravidlo „bez `overenie` len zmluvne/informatívne".
Všetko ostatné má oporu aspoň v texte normy; rozdiel je len v tom, či to schéma vie niesť.

## 15.4 Ostávajúce rozhodnutia (sekcie 3–6 nedokončené)
- [ ] aktéri: klasifikácia rolí (19650 funkcie vs. BIM protokol role), RACI ako pohľad;
- [ ] `constraint` vs. `akceptacia` vs. `overenie` — presné hranice polí;
- [ ] metadáta: kde žijú (IU alebo IU-C), enum statusov;
- [ ] `X_` väzby: konečný zoznam typov a smer;
- [ ] container breakdown: strom v `STD-` vs. `IU-C` poznámky;
- [ ] kvalifikátor rozsahu v `obsahuje` (len geometria / len alfanumerika).

---