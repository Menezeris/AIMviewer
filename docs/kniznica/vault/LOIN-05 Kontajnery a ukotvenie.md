---
name: LOIN-05 Kontajnery
description: Kontajner ako druhá os (nie vrstva), povinné viaze_sa_na, a prečo sa kontajnery nedajú odvodiť z LOIN Documentation — sekcie 11–13
status: v1.1 (2026-09-09)
cast_serie: "[[LOIN-00 Index]]"
origin: ai
verified:
---


# 11. Informačné kontajnery — je to len ďalšia zoskupujúca vrstva?

## 11.1 Analýza

**Argumenty pre „kontajner = zoskupenie objektov":**
- 29481-3, príloha B: informačné jednotky sú kontajnery (`BIM Models → IFC Models / Native Models`) cez `subInformationUnit` — teda rekurzívne zoskupenie.
- 19650-2, 5.6.2 b): úlohový tím nemá tvoriť informácie „mimo přidělenou položku struktury členění informačního kontejneru" → objekty sú **prideľované** kontajnerom.
- MIDP/TIDP riadok je kontajner; objekty sú jeho obsah.

**Argumenty proti (kontajner nie je len obal):**
1. **19650-2, 5.4.4:** TIDP uvádza pre každý kontajner okrem iného **vlastnú úroveň informačních potřeb**, predchodcov/nadväznosti, odhad doby vytvárania, autora a míľniky. Kontajner je teda samostatný subjekt požiadavky, nie odvodenina.
2. **Vlastné požiadavky, ktoré nie sú vlastnosťou žiadneho objektu:** formát a verzia schémy (IFC 4.3), natívny + otvorený formát, konvencia pomenovania, statusové a revízne kódy, maximálna veľkosť (tvoja EIR 3.2.1 e iv: 300 MB), pozícia vo federačnej stratégii, bezpečnostná klasifikácia, súradnicový systém a základný bod.
3. **Kontajnery bez objektov:** PBR, revízna správa, protokol zamerania, rozpočet. V 7817-3 je `Documentation` viazaná *na typ objektu*, ale ako samostatná dodávka je to kontajner.
4. **Vzťah je M:N, nie strom.** `IfcSpace` je v architektonickom modeli, v room data sheete aj v FM exporte; jeden kontajner nesie mnoho typov objektov. Strom to nepopíše — je to **priradenie (matica)**, presne to, čo robí podrobná matica odpovědnosti (19650-2, 5.4.2: čo sa má vytvoriť, kedy a s kým vymeniť, ktorý úkolový tím je zodpovedný).
5. **7817-3 kontajnerovú úroveň nemá vôbec** — `Specification` ide rovno na typy objektov. Čiže ju musíme mať my, nie ju odvodzovať.

**Záver:** kontajner **nie je** ďalšia úroveň nad objektmi v jednom strome. Sú to **dve osi**, ktoré spája **priradenie**. To priradenie je zároveň generátorom TIDP/MIDP riadkov a matice zodpovednosti.

## 11.2 Navrhnutý model — tri prvky

```
IU-O   typ objektu (knižnica)     = 7817-3 SpecificationPerObjectType
       ObjectType (+URI bSDD/IFC), Alphanumerical (PROP refs),
       Documentation (+Format), Geometrical (enumy), clenenie (IDS PartOf)

IU-C   informačný kontajner (knižnica typov podľa federačnej stratégie)
       = 29481-3 informationUnit + kontajnerový blok:
       - forma: formát, verzia schémy, natívny/otvorený, max. veľkosť
       - identifikácia: konvencia pomenovania, pozícia v container breakdown
       - metadáta CDE: status, revízia, klasifikácia, bezpečnosť
       - georeferencovanie (7817-3 GeoReferencing: CRS + model CS + základný bod)
       - TIDP polia: predchodcovia, nadväznosti, odhad prácnosti, autorský tím
       - poznámka: kontajner môže byť aj čisto dokumentový (bez IU-O)

ALLOC  priradenie (M:N)  — na kontajneri ako zoznam:
       obsahuje:: [[IU-O-…]] (+ voliteľne rozsah: len geometria / len alfanumerika)
       zodpovedny:: [[rola]]
```

**Prečo priradenie žije na kontajneri, nie ako samostatná poznámka:** kontajner je dodávka a TIDP je organizovaný podľa kontajnerov; samostatná ALLOC poznámka na každý pár by explodovala (n×m). Ak ten istý typ objektu potrebuje rôzny LOIN v rôznych kontajneroch, rieši sa to prirodzene tým, že LOIN žije v `Specification`, ktorá je aj tak filtrovaná na účel × míľnik × 2 aktérov (7817-3, 10.2).

## 11.3 Knižnica vs. projekt (dôsledok z PAS a 7817-3)
- `IU-O` a `IU-C` sú **knižničné šablóny** (organizačná špecifikácia).
- `Specification` = **projektová inštancia**: filter (účel × míľnik × poskytovateľ × príjemca) nad knižnicou.
- **MIDP** = zoznam kontajnerov danej Specification + dátumy. **TIDP** = to isté filtrované na jeden úkolový tím. Obidve zostávajú **generované pohľady**, nie entity.

## 11.4 Čo tým padá a čo pribúda
- Padá: potreba „vrstvy B ako kópie vrstvy A"; kontajner nededí LOIN od objektov, má vlastný.
- Pribúda: pole `obsahuje` (M:N), kontajnerový blok požiadaviek, container breakdown ako súčasť `STD-`.
- Export: `IU-C` → 29481-3 `informationUnit` (+ `correspondingMvd` pre IDS/MVD); `IU-O` → 7817-3 `SpecificationPerObjectType`; väzba medzi nimi cez `referenceURI` + `GUID` (10.6).

## 11.5 Otvorené pred vzorom
- [ ] Rozsah priradenia: stačí `obsahuje:: [[IU-O]]`, alebo treba kvalifikátor (len geometria / len alfanumerika)?
- [ ] Kde žije container breakdown — v `STD-` alebo ako strom `IU-C` poznámok?
- [x] Čisto dokumentové kontajnery → vyriešené v sekcii 12 (IU-C bez `obsahuje`, s `viaze_sa_na`).

---

# 12. Ukotvenie dokumentov a kontajnerov na objekt/systém (`viaze_sa_na`)

## 12.1 Pre
- **7817-3:** `Documentation` je vnorená **do `SpecificationPerObjectType`** — schéma sama predpokladá, že dokument sa požaduje *k typu objektu*.
- **IFC:** `IfcRelAssociatesDocument` viaže `IfcDocumentReference/Information` na ľubovoľný `IfcObjectDefinition` — teda aj na `IfcSystem`, `IfcDistributionSystem`, `IfcSpace`, `IfcProject`.
- **ISO 21597 (ICDD):** linksety existujú práve na väzbu dokument ↔ prvok modelu.
- **IEC 62023** (normatívny odkaz v DIS 7817) a **ISO 81346:** štruktúra technickej dokumentácie sa odvodzuje od štruktúry systémov.
- Vecne: neukotvený PDF je presne ten problém, ktorý pasportizácia rieši.

## 12.2 Proti / limity
1. **Procesné a zmluvné kontajnery** (BEP, MIDP, TIDP, zápisy, register rizík, ponuka) nie sú o aktíve, ale o poverení. Ukotviť ich na `IfcSystem` by bolo umelé.
2. **M:N:** súhrnná technická správa sa týka mnohých systémov; jeden systém má mnoho dokumentov.
3. **Typ vs. výskyt:** požiadavka je na *type* („každá VZT jednotka má protokol o zaregulovaní"), väzba v modeli je na *výskyte*. Dve rôzne veci, obe potrebné.
4. **Dokumentácia podľa vyhlášky** je členená podľa druhu dokumentu, nie podľa systému.
5. **IDS 1.0 nemá Document facet** → väzbu nevie overiť; overenie je ETL / CDE metadáta / manuál.

## 12.3 Rozhodnutie
Zavádza sa **povinné pole `viaze_sa_na` (≥1)** na každom `IU-C` a na každom požadovanom dokumente, s hierarchiou kotiev od najkonkrétnejšej:

```
viaze_sa_na::
  1. [[IU-O-…]]              typ objektu (VZT jednotka, dvere)
  2. system                  IfcSystem / IfcDistributionSystem (+ 81346 kód)
  3. priestor                IfcSpace / IfcBuildingStorey / IfcBuilding / IfcSite
  4. aktivum                 IfcProject / celé aktívum
  5. proces                  ← výslovná výnimka: BEP, MIDP, zápisy, ponuka
```
**Pravidlo:** kotva „aktivum" alebo „proces" musí byť *zvolená vedome*, nie z lenivosti — ak sa nedá pomenovať nič konkrétnejšie, je to signál, nie medzera.

**Dva mechanizmy, nezamieňať:**
- *požiadavka* → dokument sa zapíše do `Documentation` pod `SpecificationPerObjectType` (7817-3, natívne);
- *dodávka* → `IfcRelAssociatesDocument` z výskytu na dokument, prípadne ICDD linkset pri cross-file.

## 12.4 Dôsledky
- **Ruší sa otvorená otázka 11.5 c):** samostatný typ `IU-D` netreba. Dokumentový kontajner = `IU-C` s prázdnym `obsahuje`, ale **nikdy nie prázdnym `viaze_sa_na`**.
- Rieši sa kolízia z úvodu (dokumentácia ako *objekt* vs. ako *zložka LOIN*): tá istá entita je zložkou objektu, na ktorý je ukotvená, a kontajnerom, keď je dodávkou.
- `overenie` pre väzbu dokumentov: ETL / CDE metadáta / manuál (nie IDS).

> Pozn.: sekcia písaná pred získaním CD 7817-3; závery upresnené/opravené v sekcii 10.

---

# 13. Dajú sa kontajnery odvodiť zo štruktúrovanej `Documentation` v LOIN?

Otázka: ak dokumenty v LOIN dostatočne oštrukturujeme, vypadne z nich zoznam a hierarchia kontajnerov?

## 13.1 Čo na tom sedí
- **Väzba objekt → dokument je natívna.** 7817-3 má `Documentation/Document` (`RequiredDocumentType`) *vnútri* `SpecificationPerObjectType`, s vlastným `dt:GUID`, `Name`, `ReferenceDocument`, `Description`, `Format` (FormatName/Version/Specification) a atribútmi `@type`, `@form`, `@content`.
- **M:N sa rieši opakovaným GUID.** Ten istý dokument (napr. súhrnná technická správa) môže byť referencovaný spod viacerých typov objektov — pravidlo referencovania zo schémy (10.6): v rámci súboru `GUID`, mimo `referenceURI` + `GUID`. Čiže „stretnú sa tam" funguje presne ako hovoríš.
- **Zoznam dokumentov ako pohľad** = zjednotenie `Document` GUID naprieč všetkými `SpecificationPerObjectType`. To je legitímny generovaný register.

## 13.2 Čo tak nevyjde (tri tvrdé dôvody)
1. **Modelové kontajnery v `Documentation` nie sú.** Čiastkové DiMS podľa profesií (EIR 3.3.3–3.3.5, 3.4.5) nesú *samotné objekty*, nie sú dokumentáciou k nim. Ak by register kontajnerov vznikal len z `Documentation`, IFC a natívne modely by z neho vypadli. Ich zdrojom je **federačná stratégia a štruktúra členenia informačných kontajnerov** (19650-1, 10.4; 19650-2, 5.3.2 c, 5.5.3), nie LOIN.
2. **Hierarchia nemá v LOIN zdroj.** `Documentation` je plochý zoznam `Document` bez rodiča/potomka. Hierarchia je *rozhodnutie*, nie odvodenina — a v tvojich šablónach existuje explicitne: „Zoznam a hierarchia dokumentov" (Zmluva → Príloha A BIM protokol → A.1 EIR → A.1.a Dátový štandard, A.1.b CDE štandard → A.1.b.1 adresárová štruktúra → A.2 BEP → A.2.a–e pre-BEP/BEP/RACI/MIDP/TIDP). Nič v LOIN tento strom nevygeneruje.
3. **Kontajnerové požiadavky sa pod `Document` nezmestia.** Formát áno (`Format`), ale konvencia pomenovania (EIR 3.3.5), max. veľkosť 300 MB (3.2.1 e iv), natívny + otvorený formát (3.2.1 a–b), statusové a revízne kódy (4.3.3 c–e), CRS a základný bod (3.4.2–3.4.3), bezpečnostná klasifikácia (BIM protokol kap. 9), TIDP polia (predchodcovia, prácnosť, autorský tím) — nič z toho nie je vlastnosť dokumentu v LOIN.

Vedľajšie: procesné/zmluvné kontajnery (BEP, MIDP, TIDP, RACI, pre-BEP) nevisia na žiadnom type objektu — sú prílohami zmluvy; a revízne správy sa viažu na *výskyt*, nie na typ.

## 13.3 Záver a syntéza
**Prepojené áno, odvodené nie.** Dokument je prvotriedna entita s vlastným GUID; LOIN naň iba **odkazuje** (nie kopíruje). Register kontajnerov je **zjednotenie dvoch zdrojov**:

```
register kontajnerov (IU-C)
├── dokumentové kontajnery      ← referencované z LOIN Documentation (GUID)
└── modelové/dátové kontajnery  ← z federačnej stratégie a container breakdown (STD-)
        hierarchia: jeden explicitný strom v STD-
        (zmluvná vetva = "Zoznam a hierarchia dokumentov" zo šablón;
         legislatívna vetva = vyhláška o dokumentácii stavieb)
```
Až potom platí tvoja druhá veta: **objekty aj dokumenty sú prvotriedne, stretávajú sa v `Documentation` / `viaze_sa_na`, a zvyšok sú náhľady** — EIR (podľa objektu), MIDP/TIDP (podľa kontajnera), dokumentačný register (podľa hierarchie), RACI (podľa roly).

## 13.4 Zistenia zo šablón EIR a BIM protokolu (seed pre knižnicu)
- **Účely užitia sú už kódované:** `U_PK` priestorová koordinácia, `U_PD` projektová dokumentácia, `U_VV` výkaz výmer, `U_VER` strojová verifikácia (IDS), `U_CDE` správa informácií — plus matica *fáza × účel* (ADS, DPZ). → priamy seed registra `UC-`, vrátane väzby fáza → ER.
- **Prednosť pri rozpore je zmluvná realita:** BIM protokol 1.3.3 (protokol > prílohy), EIR 3.2.1 i) a 5.1.1 g) (pri rozpore má prednosť IFC pred natívnym). → potvrdzuje typ väzby `nadradene_pri_rozpore` z našej `X_` diskusie ako prvotriedny.
- **Role sú definované:** Koordinátor BIM a Správca informácií zvlášť za poverujúcu, vedúcu poverenú a poverenú stranu (BIM protokol kap. 6) + prevodná tabuľka Objednávateľ/GZ/zhotoviteľ (tab. 1). → seed registra aktérov (sekcia 3) s klasifikáciou.
- **Akceptačné kritériá po míľnikoch** (EIR 5.1.1, tab. 4: Príprava / Rozpracovaný koncept / Finálny koncept / Čistopis). → seed poľa `akceptacia` a registra `EV-`.
- **Knižnica vs. projekt** je v šablónach zabudovaná: nemenné časti BEP vs. pracovná časť s riadeným postupom zmien (BIM protokol 8.1.2) → náš git/PR model.

---