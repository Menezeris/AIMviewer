---
name: LOIN-04 ISO 7817-3
description: Šev 29481-3 ↔ 7817-3 a skutočná CD schéma LOIN (Specification, prerekvizity, tri zložky, GeoReferencing, referencovanie) — sekcie 9–10
status: v1.1 (2026-09-09)
cast_serie: "[[LOIN-00 Index]]"
origin: ai
verified:
---


# 9. Šev 29481-3 ↔ ISO 7817-3 (LOIN schéma)

> Pozn.: písané pred získaním CD 7817-3; závery upresnené v sekcii 10.

## 9.1 Kde je šev normatívne určený
- 29481-3, Introduction: schéma má poskytovať „tight digital links" na externé definície vrátane **EN 17412-1 (LOIN)**, 23386, 23387, 21597-1 (ICDD) — LOIN je teda predpokladaný ako *externé naviazanie*, nie ako obsah idmXSD.
- 7817-1, príloha A: LOIN slúži na popis **ER podľa 29481-1** a EIR podľa 19650-1.
- PAS 1958, obr. 15: šedý box = **information units „structured using level of information need"**; prerekvizity `+object +milestone +actor` sú *mimo* ER.
→ Šev je jednoznačne na `er/informationUnit`. Koncepčne sedí.

## 9.2 Tri miesta, kde nesedí (riešiť sami)

**(a) „Objekt" nemá v idmXSD domov.** Z troch LOIN prerekvizít na obr. 15 pokrýva 29481-3 iba *actor* (a to len ako zoznam na UC) a *milestone* (ako `standardProjectPhase`). **Objekt a štruktúra členenia (7817-1, 5.5) v schéme nie sú** — `constructionEntity` je typ stavby (nemocnica, letisko), nie objekt LOIN. A 7817-1 hovorí, že prerekvizity nie sú súčasťou LOIN → pravdepodobne ich nebude mať ani 7817-3. **Objekt/členenie teda nevlastní ani jedna schéma; musí byť naše pole.**

**(b) Granularita.** `informationUnit` je vo vzore prílohy B na úrovni *dodávky* (Cover Letter, Drawings, BIM Models → IFC Models), LOIN pracuje na úrovni *objektu* (stena, priestor). Medzičlánok „kontajner obsahuje objekty" v idmXSD chýba (`subInformationUnit` je len rekurzia bez sémantiky). → Naša vrstva A/B ostáva; mapovanie: IU typu kontajner = `informationUnit`, IU typu objekt = `subInformationUnit` s LOIN blokom.

**(c) Trojitý prekryv pravidiel.** `constraint` (29481-3, voľný text + `associatedBusinessRule`) × alfanumerická zložka LOIN (7817) × IDS facety. Pravidlo: **čo je LOIN = čo sa požaduje; čo je constraint = pravidlo hodnoty; čo je IDS = strojová kontrola.** Tolerancia/presnosť/spoľahlivosť ostáva metadátum (7817-1, 6.1 pozn. 3), nie LOIN ani constraint.

## 9.3 Riziko časovania
29481-3:2022 normatívne odkazuje na **29481-1:2016**, pričom platí edícia 2025 → schéma sama zaostáva a dá sa čakať jej revízia (zosúladenie s 2025 a s 7817-3). 7817-3 je DIS a môže sa meniť. → **nehardkódovať ani jednu**; držať náš MD model ako zdroj pravdy a schémy riešiť ako exportné profily.

## 9.4 Rozhodnutie
- IU poznámka = miesto švu. Obsahuje: idmXSD polia (`name`, `dataType`, `isMandatory`, `definition`, `correspondingExternalElement`) **+ náš blok `objekt`/`clenenie`** (nikde inde nie je) **+ blok `loin`** (3 zložky, 5 geometrických aspektov podľa 7817-1) **+ `constraint`** (→ `businessRule` na UC) **+ `overenie`** (IDS/manuál).
- Export v1: kostra → idmXSD; `loin` blok → `userDefinedProperty` / `constraint` (dočasne).
- Export v2 (po publikácii 7817-3): `loin` blok → natívny 7817-3 dokument; PROP tvarovať podľa **23387** už teraz, inak bude migrácia bolestivá.
- **Overiť v DIS 7817-3:** akým mechanizmom sa LOIN dokument viaže na `informationUnit` (GUID? URI?), či schéma pozná objekt/breakdown, a či rieši dokumentáciu ako zložku.
- Precedens: Liu/Hagedorn/König 2023 tento šev už spravili (LOIN ontológia pre ICDD kontajnery v rámci IDM) — použiť ako kontrolu nášho mapovania.
- **Pridať do UC:** `pouzitie` (sloveso+podstatné meno, 1:*), `region` (1:*), `constructionEntity`, `limitations`, `scopeKeyword`/`benefitKeyword`, `licencia`, `stav` (NP/WD/PUB/WDRL), `jazyk`.
- **`DEF-` = businessRule na UC** (id, name, proposition, reference), IU constraint naň odkazuje → ruší potrebu samostatnej entity mimo schémy.
- **`PROP-`** mapovať na `correspondingExternalElement` (basis + name) — a tvarovať podľa ISO 23387 kvôli 7817-3.
- **Fázy:** `standardProjectPhase` je povinný enum ISO 22263 (6 hodnôt) — mapovacia tabuľka SK/CZ ide do `localProjectPhase`. Potvrdzuje otvorenú otázku z 2.3.
- **Granularita súborov:** 1 sub-UC = 1 `idm` (UC 1:1, ER 0:1); nadradený UC → `subIdm`.
- **Aktéri (sekcia 3):** schéma dáva len `actor{id, name, classification}` na UC. Naše R/A/C/I a provider/receiver/reviewer sú rozšírenie — riešiť v sekcii 3.
1. Prečítať Liu 2023 + Akbas 2025 (názvy polí LOIN/IDS) a obstarať CEN/TR 17654.
2. Zamraziť polia IU + PROP + STD (v1).
3. Vzory: GOAL-01, EV register (SK stupne PD), UC-0100/0101, ER-0101, 5× IU, 2× DEF, 3× PROP.
4. Dataview pohľady: EIR, RACI, TIDP.
5. Až potom UC-0201 (nájmy) ako utilization test.

---

# 10. ISO/CD 7817-3 — skutočná schéma (príloha B XSD + príloha C príklady)

Zdroj: `ISO_CD_7817-3_ed_1_Annex_B.zip` (`ISO-7817-3.xsd` v1.0 + `ISO-23387.xsd` ed.2) a `Annex_C_extended` (10 XML inštancií).
Namespace `https://iso.org/2024/LOIN`, importuje `https://standards.iso.org/iso/23387/ed-2/en/`. Pozn. v XSD: *„Final LOIN Namespace will be specified after the review process"* → CD štádium, namespace sa ešte zmení.

## 10.1 Kostra
```
LevelOfInformationNeed
└─ Specification  1:*   (name, GUID)
   ├─ Prerequisites            1:1
   │   ├─ Purpose                      1   (Name, Definition, ReferenceDocument, Description, Language, Region, DictionaryRef)
   │   ├─ InformationDeliveryMilestone  1   (Name, Description, ReferenceDocument, @Date)
   │   ├─ ProvidingActor                1   (Role, Description, EMail, @firstName/@lastName/@affiliation)
   │   └─ ReceivingActor                1
   ├─ SpecificationPerObjectType  0:*  (extends dt:ConceptType)
   │   ├─ ObjectType                 1   (dt:ObjectTypeType → 23387/12006-3 SubjectType; @dt:about = URI do bSDD/IFC)
   │   ├─ AlphanumericalInformation  0:1
   │   ├─ Documentation              0:1
   │   └─ GeometricalInformation     0:1
   └─ GeoReferencing              0:1
```

## 10.2 Zásadné zistenie — Specification = jedna transakcia
Anotácia v XSD: *„A level of information need specification always has one purpose and two actors, given that it is a specific transaction. Actors should consolidate requirements for different actors and different purposes in separate level of information need specifications."*
→ **Purpose, milestone, providing actor, receiving actor sú v jednotnom čísle (1:1).** Viac účelov / aktérov = viac `Specification`.
→ Tým je normatívne potvrdené: **EIR = ER filtrovaný na (účel × míľnik × poskytovateľ × príjemca) = práve jedna `Specification`.** Toto je náš exportný útvar pre EIR.
→ Zároveň to koriguje 7817-1 (5.2: viac účelov na jednu LOIN; 5.4: poskytovateľ nemusí byť známy) — schéma je prísnejšia než text Part 1.

## 10.3 Oprava predchádzajúceho záveru (9.2 a)
Tvrdenie *„objekt nemá domov ani v jednej schéme"* bolo **nesprávne**: 7817-3 objekt má — `SpecificationPerObjectType/ObjectType` je 23387 `ObjectTypeType` (dedí `SubjectType`), s `@dt:about` na URI (v príklade `…/ifc/4.3/class/IfcColumn`) a `DictionaryRef`.
Presnejšie: **typ objektu je pokrytý; štruktúra členenia (7817-1, 5.5) a pozícia v nej pokrytá nie je.** Breakdown ostáva naše pole.

## 10.4 Tri zložky LOIN — čo schéma naozaj obsahuje

**AlphanumericalInformation** (GUID povinné): `Property` (0:*, `dt:PropertyType`), `QuantityKind`, `GroupsOfProperties` → `GroupOfProperties` alebo `GroupOfPropertiesRef`, `ReferenceDocument`, `Dimension`, `Unit`.
`dt:PropertyType` = ConceptType + `DataType` (s `PossibleValues/ValueList` → **enum hodnôt je súčasť schémy**), `Symbol`, `DimensionRef`, `UnitRef`, `QuantityKindRef`, `IsDependentOnRef`, `IsSpecializationOfRef`.
V príkladoch sa jednotky/veličiny odkazujú na **QUDT** (`qudt.org/vocab/unit/CentiM`, `…/quantitykind/Length`) a klasifikácia na **bSDD/Uniclass**.
Anotácia: jednotlivé property sa nemajú referencovať vnútri skupiny properties.

**Documentation** (GUID): `Document` 0:* = `RequiredDocumentType` — `Name`, `ReferenceDocument`, `Description`, **`Format` (FormatName, FormatVersion, FormatSpecification)**, atribúty `@type`, `@form`, `@content`.
→ Dokumentácia má v LOIN natívne miesto vrátane formátu; príklad: type="Technical Drawing", content="Horizontal Projection", Format PDF 1.7, ReferenceDocument → IfcDocumentInformation.

**GeometricalInformation** (GUID, `@placeholder`): päť aspektov 7817-1, ale *detail* je rozložený:
- `Detail`: `Dictionary` (ref — v príklade bimforum.org/lod), `ShapeAssembly` {NotRequired, SingleObjectSingularShape, SingleObjectMultipleShapes, MultipleObjects}, `ShapeRepresentation` {NotRequired, SingleBoundingPrimitive, OuterShellAsSingularShape, OuterShellAsSeparateShapes}, `ShapeInfluence` {InsideGeometry, Connections, Openings, **OperatingAndClearanceZones**, Features — každé {NotRequired, No…, …AsPartOfShape, SeparateShapes}; + `ThresholdDimension` (Threshold + Unit + Definition)}
- `Dimensionality` {NotRequired, 0D, 1D, 2D, 3D}
- `Appearance` {NotRequired, NoAppearanceInformation, SymbolicByMapping, SingularMaterial, MultipleMaterials, ConceptualAppearance, RealisticAppearance}
- `ParametricBehaviour` {NotRequested, Requested}  ← nekonzistentné s ostatnými („NotRequired") — CD chyba
- `Location` = `PositioningType` {Absolute | Relative | NotDefined} + `ReferenceObject` (voľný string: veta, filter, XPath alebo GUID)

## 10.5 GeoReferencing (novinka, ktorú sme nemali)
`CoordinateReferenceSystem`: `Type` {NotRequired, ProjectedCRS, EngineeringCRS, GeographicCRS} + `Datum` + `VerticalDatum` (ISO 19111; Name = WKT2/EPSG string; registry podľa ISO 19127, WKT2 podľa ISO 19162).
`ModelCoordinateSystem` (0:*): `IsProjected`, `FirstCoordinate`, `SecondCoordinate`, `Height`, `XAxisAbscissa`, `XAxisOrdinate`, `UnitScale`, `HorizontalScale`.
→ **Kapitola 3.4.2 tvojej EIR (S-JTSK / Bpv, základný bod, uhol ku severu) sa dá zapísať strojovo.** Príklady: 5 variantov georeferencovania.

## 10.6 Mechanizmus referencovania (odpoveď na otvorenú otázku z 9.4)
`dt:ReferenceType` = `@referenceURI` + `@GUID`, obidva voliteľné. Pravidlo z anotácie schémy:
- v rámci toho istého súboru → `GUID`;
- na externý zdroj → `referenceURI`;
- na konkrétny prvok v externom zdroji → **oboje**.
`split_example.xml` to ukazuje na knižnici vlastností: `dt:HasPropertyRef referenceURI="file:structural_properties_library.xml" GUID="…"`.
→ **Náš register `PROP-` = externá knižnica vlastností** presne v tomto tvare; väzba z 29481-3 `informationUnit` na LOIN `Specification` sa dá spraviť tým istým párom URI+GUID (schéma to normatívne nerieši, ale mechanizmus je pripravený).
`@dt:about` na ObjectType = URI do slovníka (bSDD/IFC).

## 10.7 Čo 7817-3 stále nemá (naše rozšírenia potvrdené)
1. **Štruktúra členenia / priestorová pozícia objektu** (7817-1, 5.5) — iba typ objektu.
2. **Kontajnerová vrstva (B)** — Documentation je *per objekt*, nie samostatný informačný kontajner; TIDP/MIDP polia žiadne.
3. **Akceptačné kritériá a overenie** (19650-4, IDS) — hodnotové obmedzenia áno (`PossibleValues`), tolerancia/presnosť/spoľahlivosť nie (v súlade so 7817-1, 6.1 pozn. 3 → metadáta).
4. **Ciele (GOAL)** a **udalosti** — `InformationDeliveryMilestone` áno, impact/delivery rozlíšenie nie.
5. **Reviewer** — len ProvidingActor a ReceivingActor.
6. **Väzby medzi zložkami LOIN** (naše `X_`) — žiadne.

## 10.8 Dôsledky pre v1 (nahrádza časti 7.4 a 9.4)
- **`IU` objektová = `SpecificationPerObjectType`.** Polia: ObjectType (+ URI do bSDD/IFC), Alphanumerical (PROP refs), Documentation (+ Format), Geometrical (enumy podľa 10.4). Náš voľný „detail" nahradiť trojicou ShapeAssembly / ShapeRepresentation / ShapeInfluence.
- **`ER` + filter (účel × míľnik × 2 aktéri) = `Specification`** → toto je EIR. Náš `spustacia_udalost` typu *delivery/milnik* exportuje do `InformationDeliveryMilestone` (s `@Date`); impact ostáva mimo.
- **`PROP-` = externá knižnica `dt:Property`** (DataType, PossibleValues, UnitRef/QuantityKindRef → QUDT). Potvrdené odporúčanie tvarovať podľa 23387.
- **`DEF-` (meracia definícia plochy)** → primárne `Property/Definition` + `ReferenceDocumentRef` (norma/zmluva); *pravidlo a overenie* ostáva ako `constraint`/`businessRule` v 29481-3. Deliť: definícia = 7817-3, pravidlo = 29481-3.
- **Aktéri (sekcia 3):** základ je daný — `ProvidingActor` / `ReceivingActor` s rolou; **reviewer a RACI sú naše rozšírenie**.
- **Pridať blok `georeferencovanie`** na úroveň ER/Specification (CRS + model CS).
- **Riziko:** CD štádium, namespace nefinálny, `ParametricBehaviour` enum nekonzistentný → mapovať cez profil, nie hardkódovať.

Stav: **ISO/DIS 7817-3 „Data model and schema"** — UML model + odvodené XSD pre LOIN, podľa pojmov Part 1 a metodiky Part 2, **v súlade s ISO 23387 (dátové šablóny)**; enquiry fáza, nepublikované.


---