# POLIA — polia schémy v1.5 (generované)
<!-- Generuje `assetin schema export` z pydantic modelov v assetin/schema/. Needitovať ručne; záväzný text je docs/SCHEMA-v1.md. -->
Zdroj: `frontmatter` = YAML hlavička, `inline` = `kluc::` v tele pod sekciou, `blok` = YAML blok pod sekciou. Cieľ odkazu = povolené typy wikilinku (kotva: ziadna | volitelna | povinna).
**[V26] Trieda obmedzenia** (PAS 1958 6.3.3): `obmedzenie: prítomnosť` = či jednotka bola dodaná (IDS cardinality / minOccurs) · `obmedzenie: hodnota` = aké hodnoty smie niesť (výčet, vzor, rozsah, dátový typ, jednotka). Pole bez značky nie je obmedzenie, ale popis alebo väzba.

## GOAL — §1 GOAL — cieľ (organizácia / aktívum / projekt).
Sekcie tela (poradie šablóny): `## Popis`

| Pole | Typ | Povinné | Zdroj | Sekcia | Cieľ odkazu | Názov | Popis / export |
|---|---|---|---|---|---|---|---|
| `id` | str | ✓ | frontmatter |  |  | ID | prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia · → 29481-3 specId/localCode ; 7817-3 name |
| `guid` | str |  | frontmatter |  |  | GUID | generuje nástroj · → specId/guid ; dt:GUID |
| `typ` | enum{GOAL, UC, ER, IU-O, IU-C, STD, GEO, PROP, DEF, EV, ACT, PROT, PROJ} | ✓ | frontmatter |  |  | Typ |  |
| `nazov` | str | ✓ | frontmatter |  |  | Názov |  |
| `nazov_en` | str | ✓ | frontmatter |  |  | Názov (EN) | → specId/shortTitle ; 7817-3 Purpose/Language |
| `stav` | enum{NP, WD, PUB, WDRL} | ✓ | frontmatter |  |  | Stav | → documentStatus |
| `verzia` | str | ✓ | frontmatter |  |  | Verzia | → specId/version |
| `jazyk` | str |  | frontmatter |  |  | Jazyk | ISO 639-1 · → uc/language |
| `autor` | str |  | frontmatter |  |  | Autor | → authoring/author |
| `licencia` | str |  | frontmatter |  |  | Licencia | → authoring/copyright |
| `aliases` | list[str] |  | frontmatter |  |  | Aliasy | [V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview) |
| `uroven` | enum{organizacia, aktivum, projekt} | ✓ | frontmatter |  |  | Úroveň | organizacia (OIR) | aktivum (AIR) | projekt (PIR) |
| `zdroj_ir` | enum{OIR, AIR, PIR} | ✓ | frontmatter |  |  | Zdroj IR | perspektíva stakeholdera (DIS 2026) |
| `aktivum` | str |  | frontmatter |  |  | Aktívum | iba uroven: aktivum | projekt |
| `termin` | date |  | frontmatter |  |  | Termín | iba uroven: projekt |
| `kpi` | list[KPI] |  | frontmatter |  |  | KPI | metrika organizácie/aktíva/projektu, nie modelu |
| `kpi[].metrika` | str | ✓ |  |  |  | Metrika |  |
| `kpi[].ciel` | str |  |  |  |  | Cieľ |  |
| `prispieva_k` | list[wikilink] |  | inline | Popis | GOAL (ziadna) | Prispieva k | nižšia → vyššia úroveň |
| `zdroj_oir` | list[wikilink] |  | inline | Popis | GOAL, IU-C (ziadna) | Zdroj OIR |  |

## UC — §2 UC — use case (účel užitia).
Sekcie tela (poradie šablóny): `## Zhrnutie` · `## Cieľ a rozsah` · `## Vymedzenie (čo use case nie je)` · `## Rámcové podmienky` · `## Prínosy` · `## Spúšťacia udalosť` · `## Aktéri` · `## Hierarchia` · `## Business context` · `## Business rules` · `## Fázy → ER`

| Pole | Typ | Povinné | Zdroj | Sekcia | Cieľ odkazu | Názov | Popis / export |
|---|---|---|---|---|---|---|---|
| `id` | str | ✓ | frontmatter |  |  | ID | prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia · → 29481-3 specId/localCode ; 7817-3 name |
| `guid` | str |  | frontmatter |  |  | GUID | generuje nástroj · → specId/guid ; dt:GUID |
| `typ` | enum{GOAL, UC, ER, IU-O, IU-C, STD, GEO, PROP, DEF, EV, ACT, PROT, PROJ} | ✓ | frontmatter |  |  | Typ |  |
| `nazov` | str | ✓ | frontmatter |  |  | Názov |  |
| `nazov_en` | str | ✓ | frontmatter |  |  | Názov (EN) | → specId/shortTitle ; 7817-3 Purpose/Language |
| `stav` | enum{NP, WD, PUB, WDRL} | ✓ | frontmatter |  |  | Stav | → documentStatus |
| `verzia` | str | ✓ | frontmatter |  |  | Verzia | → specId/version |
| `jazyk` | str |  | frontmatter |  |  | Jazyk | ISO 639-1 · → uc/language |
| `autor` | str |  | frontmatter |  |  | Autor | → authoring/author |
| `licencia` | str |  | frontmatter |  |  | Licencia | → authoring/copyright |
| `aliases` | list[str] |  | frontmatter |  |  | Aliasy | [V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview) |
| `kratky_nazov_en` | str |  | frontmatter |  |  | Krátky názov (EN) | → specId/shortTitle |
| `typ_ulohy` | enum{delivery, utilization, oboje} | ✓ | frontmatter |  |  | Typ úlohy | [V6] sumár taskov poskytovateľov |
| `region` | list[str] |  | frontmatter |  |  | Región | ISO 3166-1 alpha-3 · → uc/region |
| `faza_iso22263` | list[enum{inception, brief, design, production, maintenance, demolition}] | ✓ | frontmatter |  |  | Fáza ISO 22263 | [V1] prípustnosť scenára · → standardProjectPhase |
| `faza_lokalna` | list[str] |  | frontmatter |  |  | Fáza (lokálna) | → localProjectPhase |
| `construction_entity` | list[str] |  | frontmatter |  |  | Construction entity | → constructionEntity |
| `zrelost` | enum{Outlook, Example, Proven} |  | frontmatter |  |  | Zrelosť | UCM |
| `pouzitie` | list[str] |  | frontmatter |  |  | Použitie | sloveso + podstatné meno (29481-1 tab. 1) · → use |
| `norma` | list[str] |  | inline | Rámcové podmienky |  | Norma | → reference{basisStandard, fullCitation} |
| `podporuje_ciel` | list[wikilink] |  | inline | Prínosy | GOAL (ziadna) | Podporuje cieľ |  |
| `spustacia_udalost` | list[wikilink] |  | inline | Spúšťacia udalosť | EV (ziadna) | Spúšťacia udalosť | iba impact |
| `aktor` | list[wikilink] |  | inline | Aktéri | ACT (ziadna) | Aktéri | → actor |
| `nadradeny_uc` | list[wikilink] |  | inline | Hierarchia | UC (ziadna) | Nadradený UC | → subUc / subIdm |
| `ulohy` | list[Uloha] |  | blok | Business context |  | Úlohy | [V17] · → businessContextMap |
| `ulohy[].id` | str | ✓ |  |  |  | ID úlohy |  |
| `ulohy[].nazov` | str | ✓ |  |  |  | Názov |  |
| `ulohy[].typ` | enum{delivery, utilization} | ✓ |  |  |  | Typ | delivery | utilization (PAS 6.2.1) |
| `ulohy[].aktor` | wikilink | ✓ |  |  | ACT (ziadna) | Aktér | → 29481-3 businessContextMap |
| `ulohy[].vystup` | list[wikilink] |  |  |  | IU-O, IU-C (ziadna) | Výstup |  |
| `pravidlo` | list[wikilink] |  | inline | Business rules | DEF (ziadna) | Business rules | → businessRule |

## ER — §3 ER — exchange requirement.
Sekcie tela (poradie šablóny): `## Popis` · `## Informačné jednotky` · `## Prepisy pre túto výmenu`

| Pole | Typ | Povinné | Zdroj | Sekcia | Cieľ odkazu | Názov | Popis / export |
|---|---|---|---|---|---|---|---|
| `id` | str | ✓ | frontmatter |  |  | ID | prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia · → 29481-3 specId/localCode ; 7817-3 name |
| `guid` | str |  | frontmatter |  |  | GUID | generuje nástroj · → specId/guid ; dt:GUID |
| `typ` | enum{GOAL, UC, ER, IU-O, IU-C, STD, GEO, PROP, DEF, EV, ACT, PROT, PROJ} | ✓ | frontmatter |  |  | Typ |  |
| `nazov` | str | ✓ | frontmatter |  |  | Názov |  |
| `nazov_en` | str | ✓ | frontmatter |  |  | Názov (EN) | → specId/shortTitle ; 7817-3 Purpose/Language |
| `stav` | enum{NP, WD, PUB, WDRL} | ✓ | frontmatter |  |  | Stav | → documentStatus |
| `verzia` | str | ✓ | frontmatter |  |  | Verzia | → specId/version |
| `jazyk` | str |  | frontmatter |  |  | Jazyk | ISO 639-1 · → uc/language |
| `autor` | str |  | frontmatter |  |  | Autor | → authoring/author |
| `licencia` | str |  | frontmatter |  |  | Licencia | → authoring/copyright |
| `aliases` | list[str] |  | frontmatter |  |  | Aliasy | [V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview) |
| `forma` | Forma |  | frontmatter |  |  | Forma |  |
| `forma.format` | str |  |  |  |  | Formát | → 7817-3 Document/Format ; IDS @ifcVersion |
| `forma.verzia_schemy` | str |  |  |  |  | Verzia schémy |  |
| `forma.nativny_format` | str |  |  |  |  | Natívny formát |  |
| `forma.max_velkost_mb` | float |  |  |  |  | Max. veľkosť (MB) |  |
| `poskytovatel_predvoleny` | wikilink |  | frontmatter |  | ACT (ziadna) | Predvolený poskytovateľ | len pre IU bez vlastného poskytovateľa |
| `prijemca` | wikilink |  | frontmatter |  | ACT (ziadna) | Príjemca | jeden na výmenu; IU dedí |
| `uc` | list[wikilink] |  | inline | Popis | UC (ziadna) | UC | práve jeden (kontroluje C3) |
| `spustacia_udalost` | list[wikilink] |  | inline | Popis | EV (ziadna) | Spúšťacia udalosť | delivery, ≥1 · → 7817-3 InformationDeliveryMilestone ; IDS info/milestone |
| `precondition` | list[wikilink] |  | inline | Popis | ER (ziadna) | Precondition |  |
| `referencne_info` | list[wikilink] |  | inline | Popis | IU-C (ziadna) | Referenčné informácie |  |
| `standard` | list[wikilink] |  | inline | Popis | STD (ziadna) | Štandard |  |
| `zapnute` | list[wikilink] |  | inline | Popis | STD (volitelna) | Zapnuté pravidlá | plati: na_vyziadanie |
| `obsahuje` | list[wikilink] |  | inline | Informačné jednotky | IU-O, IU-C (ziadna) | Obsahuje | → informationUnit / subInformationUnit |
| `prepisy` | list[Prepis] |  | blok | Prepisy pre túto výmenu |  | Prepisy |  |
| `prepisy[].iu` | wikilink | ✓ |  |  | IU-O, IU-C (ziadna) | IU |  |
| `prepisy[].polozka` | str |  |  |  |  | Položka | kľúč položky: `atribut` alebo `nazov`; pri nejednoznačnosti `Pset.nazov` |
| `prepisy[].povinnost` | enum{required, optional, prohibited} |  |  |  |  | Povinnosť | obmedzenie: prítomnosť |
| `prepisy[].hodnoty` | list[str | int | float | bool] |  |  |  |  | Hodnoty | obmedzenie: hodnota |
| `prepisy[].hodnoty_ref` | wikilink |  |  |  | STD (povinna) | Slovník | obmedzenie: hodnota |
| `prepisy[].rozsah` | Rozsah_hodnot |  |  |  |  | Rozsah | obmedzenie: hodnota |
| `prepisy[].rozsah.min` | float |  |  |  |  | Minimum | → IDS minInclusive |
| `prepisy[].rozsah.max` | float |  |  |  |  | Maximum | → IDS maxInclusive |
| `prepisy[].rozsah.min_exkluzivne` | bool |  |  |  |  | Min. exkluzívne |  |
| `prepisy[].rozsah.max_exkluzivne` | bool |  |  |  |  | Max. exkluzívne |  |
| `prepisy[].zavaznost` | enum{zmluvne, musi, ma, informativne} |  |  |  |  | Záväznosť |  |
| `prepisy[].geometria.profil` | wikilink |  |  |  | GEO (ziadna) | Profil geometrie |  |

## IU-O — §4 IU-O — informačná jednotka: typ objektu (= šablóna IDS špecifikácie).
Sekcie tela (poradie šablóny): `## Členenie (iba výnimky voči STD-clenenie)` · `## Roly` · `## Trasovateľnosť` · `## Väzby`

| Pole | Typ | Povinné | Zdroj | Sekcia | Cieľ odkazu | Názov | Popis / export |
|---|---|---|---|---|---|---|---|
| `id` | str | ✓ | frontmatter |  |  | ID | prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia · → 29481-3 specId/localCode ; 7817-3 name |
| `guid` | str |  | frontmatter |  |  | GUID | generuje nástroj · → specId/guid ; dt:GUID |
| `typ` | enum{GOAL, UC, ER, IU-O, IU-C, STD, GEO, PROP, DEF, EV, ACT, PROT, PROJ} | ✓ | frontmatter |  |  | Typ |  |
| `nazov` | str | ✓ | frontmatter |  |  | Názov |  |
| `nazov_en` | str | ✓ | frontmatter |  |  | Názov (EN) | → specId/shortTitle ; 7817-3 Purpose/Language |
| `stav` | enum{NP, WD, PUB, WDRL} | ✓ | frontmatter |  |  | Stav | → documentStatus |
| `verzia` | str | ✓ | frontmatter |  |  | Verzia | → specId/version |
| `jazyk` | str |  | frontmatter |  |  | Jazyk | ISO 639-1 · → uc/language |
| `autor` | str |  | frontmatter |  |  | Autor | → authoring/author |
| `licencia` | str |  | frontmatter |  |  | Licencia | → authoring/copyright |
| `aliases` | list[str] |  | frontmatter |  |  | Aliasy | [V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview) |
| `objekt` | Objekt | ✓ | frontmatter |  |  | Objekt |  |
| `objekt.ifc_entita` | str | ✓ |  |  |  | IFC entita | → 7817-3 ObjectType ; IDS applicability/entity |
| `objekt.predefined_type` | str |  |  |  |  | PredefinedType |  |
| `objekt.uri` | str |  |  |  |  | bSDD URI | → @dt:about |
| `klasifikacia` | list[Klasifikacia] |  | frontmatter |  |  | Klasifikácia |  |
| `klasifikacia[].system` | str | ✓ |  |  |  | Systém | → IDS classification facet ; 7817-3 DictionaryRef |
| `klasifikacia[].pravidlo` | wikilink |  |  |  | STD (povinna) | Pravidlo (slovník) | [V14] tabuľka a vzor kódu žijú v STD |
| `klasifikacia[].povinnost` | enum{required, optional, prohibited} |  |  |  |  | Povinnosť | [V25] s povinnosťou → IDS requirements (cardinality); bez nej zužuje applicability · obmedzenie: prítomnosť |
| `klasifikacia[].uri` | str |  |  |  |  | URI |  |
| `filter` | list[FacetEntity | FacetAttribute | FacetClassification | FacetProperty | FacetMaterial | FacetPartOf] |  | frontmatter |  |  | Filter | [V9] iba zužuje applicability |
| `pritomnost_v_modeli` | enum{required, optional, prohibited} | ✓ | frontmatter |  |  | Prítomnosť v modeli | → IDS minOccurs/maxOccurs · obmedzenie: prítomnosť |
| `uroven` | enum{typ, vyskyt} | ✓ | frontmatter |  |  | Úroveň | typ | vyskyt |
| `zdovodnenie` | str |  | frontmatter |  |  | Zdôvodnenie | → IDS description |
| `pokyn` | str |  | frontmatter |  |  | Pokyn | → IDS instructions |
| `zavaznost_predvolena` | enum{zmluvne, musi, ma, informativne} |  | frontmatter |  |  | Predvolená záväznosť | predvoľba pre položky |
| `geometria` | Geometria |  | frontmatter |  |  | Geometria | → 7817-3 GeometricalInformation |
| `geometria.ShapeAssembly` | enum{NotRequired, SingleObjectSingularShape, SingleObjectMultipleShapes, MultipleObjects} |  |  |  |  |  | → 7817-3 ShapeAssembly |
| `geometria.ShapeRepresentation` | enum{NotRequired, SingleBoundingPrimitive, OuterShellAsSingularShape, OuterShellAsSeparateShapes} |  |  |  |  |  | → 7817-3 ShapeRepresentation |
| `geometria.ShapeInfluence` | ShapeInfluenceModel |  |  |  |  |  | → 7817-3 ShapeInfluence |
| `geometria.ShapeInfluence.InsideGeometry` | enum{NotRequired, NoInsideGeometry, InsideGeometryAsPartOfShape, SeparateShapes} |  |  |  |  |  | → 7817-3 ShapeInfluence |
| `geometria.ShapeInfluence.Connections` | enum{NotRequired, NoConnections, ConnectionsAsPartOfShape, SeparateShapes} |  |  |  |  |  |  |
| `geometria.ShapeInfluence.Openings` | enum{NotRequired, NoOpenings, OpeningsAsPartOfShape, SeparateShapes} |  |  |  |  |  |  |
| `geometria.ShapeInfluence.OperatingAndClearanceZones` | enum{NotRequired, NoOperatingAndClearanceZones, OperatingAndClearanceZonesAsPartOfShape, SeparateShapes} |  |  |  |  |  |  |
| `geometria.ShapeInfluence.Features` | enum{NotRequired, NoFeatures, FeaturesAsPartOfShape, SeparateShapes} |  |  |  |  |  |  |
| `geometria.ShapeInfluence.ThresholdDimension` | ThresholdDimensionModel |  |  |  |  |  |  |
| `geometria.ShapeInfluence.ThresholdDimension.hodnota` | float |  |  |  |  | Hodnota |  |
| `geometria.ShapeInfluence.ThresholdDimension.jednotka` | str |  |  |  |  | Jednotka |  |
| `geometria.Dimensionality` | enum{NotRequired, 0D, 1D, 2D, 3D} |  |  |  |  |  | → 7817-3 Dimensionality |
| `geometria.Appearance` | enum{NotRequired, NoAppearanceInformation, SymbolicByMapping, SingularMaterial, MultipleMaterials, ConceptualAppearance, RealisticAppearance} |  |  |  |  |  | → 7817-3 Appearance |
| `geometria.ParametricBehaviour` | enum{NotRequested, Requested} |  |  |  |  |  | → 7817-3 ParametricBehaviour |
| `geometria.Location` | LocationModel |  |  |  |  |  | → 7817-3 Location |
| `geometria.Location.PositioningType` | enum{Absolute, Relative, NotDefined} |  |  |  |  |  | → 7817-3 Location |
| `geometria.Location.ReferenceObject` | str |  |  |  |  |  |  |
| `geometria.Location.crs` | enum{NotRequired, ProjectedCRS, EngineeringCRS, GeographicCRS} |  |  |  |  | CRS typ |  |
| `geometria.profil` | wikilink |  |  |  | GEO (ziadna) | Profil | preset; explicitný aspekt poráža profil |
| `geometria.placeholder` | bool |  |  |  |  | Placeholder |  |
| `geometria.poznamka` | GeoPoznamka |  |  |  |  | Poznámka |  |
| `geometria.poznamka.zahrna` | list[str] |  |  |  |  | Zahŕňa |  |
| `geometria.poznamka.nezahrna` | list[str] |  |  |  |  | Nezahŕňa |  |
| `geometria.poznamka.text` | str |  |  |  |  | Text |  |
| `geometria.pokyn` | str |  |  |  |  | Pokyn | → IDS instructions |
| `geometria.overenie` | enum{manual, clash-detection} |  |  |  |  | Overenie | §14b: manual (predvoľba) | clash-detection |
| `geometria.postup` | str |  |  |  |  | Postup overenia |  |
| `geometria.presnost` | str |  |  |  |  | Presnosť | metadáta kvality (7817-1 6.1 pozn. 3) |
| `geometria.zavaznost` | enum{zmluvne, musi, ma, informativne} |  |  |  |  | Záväznosť |  |
| `alfanumerika` | list[Polozka] |  | frontmatter |  |  | Alfanumerika | → 7817-3 AlphanumericalInformation ; IDS requirements |
| `alfanumerika[].ifc` | IfcAtribut | IfcVlastnost | IfcMaterial |  |  |  |  | IFC |  |
| `alfanumerika[].ifc.atribut` | str | ✓ |  |  |  | IFC atribút | → IDS attribute facet |
| `alfanumerika[].prop` | wikilink |  |  |  | PROP (ziadna) | Vlastná vlastnosť | iba mimo IFC (§7) |
| `alfanumerika[].datovy_typ` | str |  |  |  |  | Dátový typ | [V24] IFC jednoduchý typ VEĽKÝMI (IFCAREAMEASURE…); len pri `ifc.pset` a `prop` · → IDS @dataType · obmedzenie: hodnota |
| `alfanumerika[].rola` | enum{identifikacia, obsah} |  |  |  |  | Rola | identifikacia | obsah (predvoľba obsah) |
| `alfanumerika[].vzor` | str |  |  |  |  | Vzor (regex) | → IDS xs:pattern · obmedzenie: hodnota |
| `alfanumerika[].pravidlo` | wikilink |  |  |  | STD (volitelna) | Pravidlo | zdroj konvencie (nie kópia) |
| `alfanumerika[].povinnost` | enum{required, optional, prohibited} |  |  |  |  | Povinnosť | → IDS cardinality · obmedzenie: prítomnosť |
| `alfanumerika[].pokyn` | str |  |  |  |  | Pokyn | → IDS instructions |
| `alfanumerika[].definicia_ref` | wikilink |  |  |  | DEF (ziadna) | Definícia | [V2] meraná hodnota · → Property.Definition + ReferenceDocumentRef |
| `alfanumerika[].hodnoty` | list[str | int | float | bool] |  |  |  |  | Hodnoty | → 7817-3 PossibleValues ; IDS xs:enumeration · obmedzenie: hodnota |
| `alfanumerika[].hodnoty_ref` | wikilink |  |  |  | STD (povinna) | Slovník | [V14] vylučuje sa s `hodnoty` · obmedzenie: hodnota |
| `alfanumerika[].rozsah` | Rozsah_hodnot |  |  |  |  | Rozsah | → IDS bounds · obmedzenie: hodnota |
| `alfanumerika[].rozsah.min` | float |  |  |  |  | Minimum | → IDS minInclusive |
| `alfanumerika[].rozsah.max` | float |  |  |  |  | Maximum | → IDS maxInclusive |
| `alfanumerika[].rozsah.min_exkluzivne` | bool |  |  |  |  | Min. exkluzívne |  |
| `alfanumerika[].rozsah.max_exkluzivne` | bool |  |  |  |  | Max. exkluzívne |  |
| `alfanumerika[].povaha` | enum{informacny, technicky} |  |  |  |  | Povaha |  |
| `alfanumerika[].overenie` | enum{IDS, manual} |  |  |  |  | Overenie | §14b: IDS (predvoľba) | manual |
| `alfanumerika[].postup` | str |  |  |  |  | Postup overenia |  |
| `alfanumerika[].tolerancia` | str |  |  |  |  | Tolerancia | metadáta; zhodu s realitou overuje dokumentačná položka (§0.6) · obmedzenie: hodnota |
| `alfanumerika[].dolozene_v` | wikilink |  |  |  | IU-C (ziadna) | Doložené v | [V4] kontajner, ktorý položku dokladuje |
| `alfanumerika[].zavaznost` | enum{zmluvne, musi, ma, informativne} |  |  |  |  | Záväznosť |  |
| `dokumentacia` | list[Dokumentacia] |  | frontmatter |  |  | Dokumentácia | → 7817-3 Documentation |
| `dokumentacia[].dok` | wikilink | ✓ |  |  | IU-C (ziadna) | Dokument | vždy odkaz na IU-C (A5) · → 7817-3 Documentation/Document ; IfcRelAssociatesDocument |
| `dokumentacia[].povinnost` | enum{required, optional, prohibited} |  |  |  |  | Povinnosť | obmedzenie: prítomnosť |
| `dokumentacia[].pokyn` | str |  |  |  |  | Pokyn |  |
| `dokumentacia[].overenie` | enum{manual} |  |  |  |  | Overenie | §14b: manual |
| `dokumentacia[].postup` | str |  |  |  |  | Postup overenia |  |
| `dokumentacia[].automatizovatelne` | bool |  |  |  |  | Automatizovateľné |  |
| `dokumentacia[].dokladuje` | list[str] |  |  |  |  | Dokladuje položky | [V4] kľúče položiek IU-O |
| `dokumentacia[].zavaznost` | enum{zmluvne, musi, ma, informativne} |  |  |  |  | Záväznosť |  |
| `clenenie` | list[wikilink] |  | inline | Členenie (iba výnimky voči STD-clenenie) | STD (ziadna) | Členenie | dedí; tu len prepis/výnimka (IDS partOf) |
| `poskytovatel` | list[wikilink] |  | inline | Roly | ACT (ziadna) | Poskytovateľ | autoritatívny; delí Specification/IDS · → 7817-3 ProvidingActor |
| `overuje` | list[wikilink] |  | inline | Roly | ACT (ziadna) | Overuje | reviewer (19650-4) |
| `pre_task` | list[wikilink] |  | inline | Trasovateľnosť | UC (povinna) | Pre úlohu |  |
| `odvodene_z` | list[wikilink] |  | inline | Väzby | IU-O, IU-C, DEF (ziadna) | Odvodené z |  |
| `nadradene_pri_rozpore` | list[wikilink] |  | inline | Väzby | IU-O, IU-C (ziadna) | Nadradené pri rozpore | cieľ má prednosť (§0.3) |
| `doplnuje` | list[wikilink] |  | inline | Väzby | IU-O, IU-C (ziadna) | Dopĺňa |  |
| `dokladuje` | list[wikilink] |  | inline | Väzby | IU-O, IU-C (ziadna) | Dokladuje |  |
| `dolozene_v` | list[wikilink] |  | inline | Väzby | IU-C (ziadna) | Doložené v |  |
| `typ_poziadavky` | list[str] |  | frontmatter |  |  | Typ požiadavky | odvodené: geometria = D2, alfanumerika = D1, dokumentacia = D3 · odvodené |

## IU-C — §5 IU-C — informačná jednotka: kontajner.
Sekcie tela (poradie šablóny): `## Ukotvenie (povinné, ≥1)` · `## Obsah (M:N)` · `## Roly` · `## TIDP väzby` · `## Väzby`

| Pole | Typ | Povinné | Zdroj | Sekcia | Cieľ odkazu | Názov | Popis / export |
|---|---|---|---|---|---|---|---|
| `id` | str | ✓ | frontmatter |  |  | ID | prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia · → 29481-3 specId/localCode ; 7817-3 name |
| `guid` | str |  | frontmatter |  |  | GUID | generuje nástroj · → specId/guid ; dt:GUID |
| `typ` | enum{GOAL, UC, ER, IU-O, IU-C, STD, GEO, PROP, DEF, EV, ACT, PROT, PROJ} | ✓ | frontmatter |  |  | Typ |  |
| `nazov` | str | ✓ | frontmatter |  |  | Názov |  |
| `nazov_en` | str | ✓ | frontmatter |  |  | Názov (EN) | → specId/shortTitle ; 7817-3 Purpose/Language |
| `stav` | enum{NP, WD, PUB, WDRL} | ✓ | frontmatter |  |  | Stav | → documentStatus |
| `verzia` | str | ✓ | frontmatter |  |  | Verzia | → specId/version |
| `jazyk` | str |  | frontmatter |  |  | Jazyk | ISO 639-1 · → uc/language |
| `autor` | str |  | frontmatter |  |  | Autor | → authoring/author |
| `licencia` | str |  | frontmatter |  |  | Licencia | → authoring/copyright |
| `aliases` | list[str] |  | frontmatter |  |  | Aliasy | [V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview) |
| `druh` | enum{model, dokument, dataset} | ✓ | frontmatter |  |  | Druh | model | dokument | dataset (dataset len bez nositeľa v modeli, V10) |
| `datovy_typ_29481` | str |  | frontmatter |  |  | Dátový typ 29481 | → informationUnit/dataType |
| `mvd` | Mvd |  | frontmatter |  |  | MVD | [V26] pohľad na schému, v ktorom sa kontajner odovzdáva (len `druh: model`) · → informationUnit/correspondingMvd |
| `mvd.basis` | str |  |  |  |  | Základ | schéma, nad ktorou MVD stojí |
| `mvd.name` | str |  |  |  |  | Názov | napr. Reference View |
| `forma` | Forma |  | frontmatter |  |  | Forma | → 7817-3 Document/Format |
| `forma.format` | str |  |  |  |  | Formát | → 7817-3 Document/Format ; IDS @ifcVersion |
| `forma.verzia_schemy` | str |  |  |  |  | Verzia schémy |  |
| `forma.nativny_format` | str |  |  |  |  | Natívny formát |  |
| `forma.max_velkost_mb` | float |  |  |  |  | Max. veľkosť (MB) |  |
| `identifikacia` | Identifikacia |  | frontmatter |  |  | Identifikácia |  |
| `identifikacia.pravidlo` | wikilink |  |  |  | STD (volitelna) | Pravidlo | konvencia ID kontajnera |
| `identifikacia.vzor` | str |  |  |  |  | Vzor (regex) |  |
| `metadata_cde` | MetadataCDE |  | frontmatter |  |  | Metadáta CDE |  |
| `metadata_cde.status` | str |  |  |  |  | Status | enum z STD-cde |
| `metadata_cde.revizia_vzor` | str |  |  |  |  | Vzor revízie (regex) |  |
| `metadata_cde.klasifikacia_bezpecnosti` | str |  |  |  |  | Klasifikácia bezpečnosti |  |
| `georeferencovanie_prepis` | Georeferencovanie |  | frontmatter |  |  | Georeferencovanie (prepis) | iba ak sa líši od STD-FED-01 |
| `georeferencovanie_prepis.model_cs` | ModelCS |  |  |  |  | Model CS |  |
| `georeferencovanie_prepis.model_cs.FirstCoordinate` | float |  |  |  |  |  |  |
| `georeferencovanie_prepis.model_cs.SecondCoordinate` | float |  |  |  |  |  |  |
| `georeferencovanie_prepis.model_cs.Height` | float |  |  |  |  |  |  |
| `georeferencovanie_prepis.model_cs.XAxisAbscissa` | float |  |  |  |  |  |  |
| `georeferencovanie_prepis.model_cs.XAxisOrdinate` | float |  |  |  |  |  |  |
| `tidp` | TIDP |  | frontmatter |  |  | TIDP |  |
| `tidp.odhad_pracnosti_h` | float |  |  |  |  | Odhad prácnosti (h) |  |
| `dokument` | Dokument |  | frontmatter |  |  | Dokument | iba druh: dokument |
| `dokument.type` | str |  |  |  |  | Typ | → 7817-3 Document @type |
| `dokument.form` | str |  |  |  |  | Forma | → @form |
| `dokument.content` | str |  |  |  |  | Obsah | → @content |
| `dokument.struktura` | list[str] |  |  |  |  | Štruktúra (kapitoly) |  |
| `dataset` | Dataset |  | frontmatter |  |  | Dataset | iba druh: dataset |
| `dataset.kluc` | str |  |  |  |  | Kľúč |  |
| `dataset.struktura` | list[StlpecDatasetu] |  |  |  |  | Štruktúra |  |
| `dataset.struktura[].stlpec` | str |  |  |  |  | Stĺpec |  |
| `dataset.struktura[].typ` | str |  |  |  |  | Typ |  |
| `dataset.struktura[].jednotka` | str |  |  |  |  | Jednotka |  |
| `dataset.struktura[].vzor` | str |  |  |  |  | Vzor |  |
| `dataset.jeden_riadok` | str |  |  |  |  | Jeden riadok = |  |
| `pokyn` | str |  | frontmatter |  |  | Pokyn |  |
| `overenie` | enum{manual} |  | frontmatter |  |  | Overenie | §14b: manual |
| `postup` | str |  | frontmatter |  |  | Postup overenia |  |
| `automatizovatelne` | bool |  | frontmatter |  |  | Automatizovateľné |  |
| `zavaznost` | enum{zmluvne, musi, ma, informativne} |  | frontmatter |  |  | Záväznosť |  |
| `viaze_sa_na` | list[wikilink | enum{#aktivum, #proces}] |  | inline | Ukotvenie (povinné, ≥1) | IU-O, IU-C, STD (volitelna) | Viaže sa na | alebo literál #aktivum / #proces (vedome) |
| `obsahuje` | list[Priradenie] |  | blok | Obsah (M:N) |  | Obsahuje | [V27] priradenie objektov kontajneru; `rozsah` zužuje na aspekty LOIN · → subInformationUnit |
| `obsahuje[].iu` | wikilink | ✓ |  |  | IU-O (ziadna) | Objekt | → subInformationUnit |
| `obsahuje[].rozsah` | list[enum{geometria, alfanumerika, dokumentacia}] |  |  |  |  | Rozsah aspektov | [V27] prázdne = všetky aspekty, ktoré daná IU-O definuje (7817-1 tri zložky LOIN) |
| `poskytovatel` | list[wikilink] |  | inline | Roly | ACT (ziadna) | Poskytovateľ |  |
| `overuje` | list[wikilink] |  | inline | Roly | ACT (ziadna) | Overuje |  |
| `predchodca` | list[wikilink] |  | inline | TIDP väzby | IU-C (ziadna) | Predchodca |  |
| `nadvaznost` | list[wikilink] |  | inline | TIDP väzby | IU-C (ziadna) | Nadväznosť |  |
| `nadradene_pri_rozpore` | list[wikilink] |  | inline | Väzby | IU-O, IU-C (ziadna) | Nadradené pri rozpore |  |
| `odvodene_z` | list[wikilink] |  | inline | Väzby | IU-O, IU-C (ziadna) | Odvodené z |  |
| `doplnuje` | list[wikilink] |  | inline | Väzby | IU-O, IU-C (ziadna) | Dopĺňa |  |
| `dokladuje` | list[wikilink] |  | inline | Väzby | IU-O, IU-C (ziadna) | Dokladuje |  |
| `dolozene_v` | list[wikilink] |  | inline | Väzby | IU-C (ziadna) | Doložené v |  |
| `typ_poziadavky` | str |  | frontmatter |  |  | Typ požiadavky | odvodené: C (model/dataset) | E (dokument) · odvodené |

## STD — §6 STD — informačný štandard: index note + sub-records (rules, GEO profiles, dictionaries).
Pod-záznamy: `pravidlo`, `profil`, `slovnik`

| Pole | Typ | Povinné | Zdroj | Sekcia | Cieľ odkazu | Názov | Popis / export |
|---|---|---|---|---|---|---|---|
| `id` | str | ✓ | frontmatter |  |  | ID | prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia · → 29481-3 specId/localCode ; 7817-3 name |
| `guid` | str |  | frontmatter |  |  | GUID | generuje nástroj · → specId/guid ; dt:GUID |
| `typ` | enum{GOAL, UC, ER, IU-O, IU-C, STD, GEO, PROP, DEF, EV, ACT, PROT, PROJ} | ✓ | frontmatter |  |  | Typ |  |
| `nazov` | str | ✓ | frontmatter |  |  | Názov |  |
| `nazov_en` | str | ✓ | frontmatter |  |  | Názov (EN) | → specId/shortTitle ; 7817-3 Purpose/Language |
| `stav` | enum{NP, WD, PUB, WDRL} | ✓ | frontmatter |  |  | Stav | → documentStatus |
| `verzia` | str | ✓ | frontmatter |  |  | Verzia | → specId/version |
| `jazyk` | str |  | frontmatter |  |  | Jazyk | ISO 639-1 · → uc/language |
| `autor` | str |  | frontmatter |  |  | Autor | → authoring/author |
| `licencia` | str |  | frontmatter |  |  | Licencia | → authoring/copyright |
| `aliases` | list[str] |  | frontmatter |  |  | Aliasy | [V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview) |
| `prepisuje` | list[wikilink] |  | inline |  | STD (ziadna) | Prepisuje | projekt: STD-projekt prepisuje:: [[STD]] |

## PROP — §7 PROP — vlastnosť (iba vlastné, mimo IFC).
Sekcie tela (poradie šablóny): `## Popis`

| Pole | Typ | Povinné | Zdroj | Sekcia | Cieľ odkazu | Názov | Popis / export |
|---|---|---|---|---|---|---|---|
| `id` | str | ✓ | frontmatter |  |  | ID | prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia · → 29481-3 specId/localCode ; 7817-3 name |
| `guid` | str |  | frontmatter |  |  | GUID | generuje nástroj · → specId/guid ; dt:GUID |
| `typ` | enum{GOAL, UC, ER, IU-O, IU-C, STD, GEO, PROP, DEF, EV, ACT, PROT, PROJ} | ✓ | frontmatter |  |  | Typ |  |
| `nazov` | str | ✓ | frontmatter |  |  | Názov |  |
| `nazov_en` | str | ✓ | frontmatter |  |  | Názov (EN) | → specId/shortTitle ; 7817-3 Purpose/Language |
| `stav` | enum{NP, WD, PUB, WDRL} | ✓ | frontmatter |  |  | Stav | → documentStatus |
| `verzia` | str | ✓ | frontmatter |  |  | Verzia | → specId/version |
| `jazyk` | str |  | frontmatter |  |  | Jazyk | ISO 639-1 · → uc/language |
| `autor` | str |  | frontmatter |  |  | Autor | → authoring/author |
| `licencia` | str |  | frontmatter |  |  | Licencia | → authoring/copyright |
| `aliases` | list[str] |  | frontmatter |  |  | Aliasy | [V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview) |
| `zdroj_importu` | str |  | frontmatter |  |  | Zdroj importu |  |
| `aplikovatelne_na` | list[str] |  | frontmatter |  |  | Aplikovateľné na | ako IfcPropertySetTemplate.ApplicableEntity |
| `template_type` | str |  | frontmatter |  |  | Template type |  |
| `definicia` | str |  | frontmatter |  |  | Definícia | → Definition |
| `definicia_ref` | wikilink |  | frontmatter |  | DEF (ziadna) | Definícia (ref) | → ReferenceDocumentRef |
| `odvodene_z` | wikilink |  | frontmatter |  | DEF (ziadna) | Odvodené z | [V2] zmluvná/odvodená hodnota odkazuje na meranú |
| `datovy_typ` | enum{string, number, integer, boolean, date, enum, uri} |  | frontmatter |  |  | Dátový typ | → DataType (23387) · obmedzenie: hodnota |
| `jednotka` | str |  | frontmatter |  |  | Jednotka | → UnitRef · obmedzenie: hodnota |
| `velicina` | str |  | frontmatter |  |  | Veličina | → QuantityKindRef · obmedzenie: hodnota |
| `hodnoty` | list[str | int | float | bool] |  | frontmatter |  |  | Hodnoty | → PossibleValues ; IDS enum · obmedzenie: hodnota |
| `uri` | str |  | frontmatter |  |  | URI | → dt:about |
| `ifc` | IfcPset |  | frontmatter |  |  | IFC | → IDS propertySet/baseName |
| `ifc.pset` | str | ✓ |  |  |  | Property set | → IDS propertySet |
| `ifc.nazov` | str | ✓ |  |  |  | Vlastnosť | → IDS baseName |

## DEF — §8 DEF — definícia hodnoty / meracie pravidlo.
Sekcie tela (poradie šablóny): `## Poznámka`

| Pole | Typ | Povinné | Zdroj | Sekcia | Cieľ odkazu | Názov | Popis / export |
|---|---|---|---|---|---|---|---|
| `id` | str | ✓ | frontmatter |  |  | ID | prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia · → 29481-3 specId/localCode ; 7817-3 name |
| `guid` | str |  | frontmatter |  |  | GUID | generuje nástroj · → specId/guid ; dt:GUID |
| `typ` | enum{GOAL, UC, ER, IU-O, IU-C, STD, GEO, PROP, DEF, EV, ACT, PROT, PROJ} | ✓ | frontmatter |  |  | Typ |  |
| `nazov` | str | ✓ | frontmatter |  |  | Názov |  |
| `nazov_en` | str | ✓ | frontmatter |  |  | Názov (EN) | → specId/shortTitle ; 7817-3 Purpose/Language |
| `stav` | enum{NP, WD, PUB, WDRL} | ✓ | frontmatter |  |  | Stav | → documentStatus |
| `verzia` | str | ✓ | frontmatter |  |  | Verzia | → specId/version |
| `jazyk` | str |  | frontmatter |  |  | Jazyk | ISO 639-1 · → uc/language |
| `autor` | str |  | frontmatter |  |  | Autor | → authoring/author |
| `licencia` | str |  | frontmatter |  |  | Licencia | → authoring/copyright |
| `aliases` | list[str] |  | frontmatter |  |  | Aliasy | [V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview) |
| `definicia` | str | ✓ | frontmatter |  |  | Definícia | → 7817-3 Property.Definition ; 29481-3 businessRule/proposition |
| `referencny_dokument` | str |  | frontmatter |  |  | Referenčný dokument | → ReferenceDocumentRef |
| `hranica_merania` | str |  | frontmatter |  |  | Hranica merania |  |
| `jednotka` | str |  | frontmatter |  |  | Jednotka | obmedzenie: hodnota |
| `zaokruhlenie` | float |  | frontmatter |  |  | Zaokrúhlenie | obmedzenie: hodnota |
| `tolerancia` | str |  | frontmatter |  |  | Tolerancia | obmedzenie: hodnota |
| `metoda_merania` | str |  | frontmatter |  |  | Metóda merania |  |
| `zodpovedny_za_meranie` | wikilink |  | frontmatter |  | ACT (ziadna) | Zodpovedný za meranie |  |
| `odvodene_z` | list[wikilink] |  | inline | Poznámka | DEF (ziadna) | Odvodené z |  |

## EV — §9 EV — udalosť.
Sekcie tela (poradie šablóny): `## Popis`

| Pole | Typ | Povinné | Zdroj | Sekcia | Cieľ odkazu | Názov | Popis / export |
|---|---|---|---|---|---|---|---|
| `id` | str | ✓ | frontmatter |  |  | ID | prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia · → 29481-3 specId/localCode ; 7817-3 name |
| `guid` | str |  | frontmatter |  |  | GUID | generuje nástroj · → specId/guid ; dt:GUID |
| `typ` | enum{GOAL, UC, ER, IU-O, IU-C, STD, GEO, PROP, DEF, EV, ACT, PROT, PROJ} | ✓ | frontmatter |  |  | Typ |  |
| `nazov` | str | ✓ | frontmatter |  |  | Názov |  |
| `nazov_en` | str | ✓ | frontmatter |  |  | Názov (EN) | → specId/shortTitle ; 7817-3 Purpose/Language |
| `stav` | enum{NP, WD, PUB, WDRL} | ✓ | frontmatter |  |  | Stav | → documentStatus |
| `verzia` | str | ✓ | frontmatter |  |  | Verzia | → specId/version |
| `jazyk` | str |  | frontmatter |  |  | Jazyk | ISO 639-1 · → uc/language |
| `autor` | str |  | frontmatter |  |  | Autor | → authoring/author |
| `licencia` | str |  | frontmatter |  |  | Licencia | → authoring/copyright |
| `aliases` | list[str] |  | frontmatter |  |  | Aliasy | [V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview) |
| `typ_udalosti` | enum{delivery, impact} | ✓ | frontmatter |  |  | Typ udalosti |  |
| `planovana` | bool |  | frontmatter |  |  | Plánovaná |  |
| `relativny_termin` | str |  | frontmatter |  |  | Relatívny termín |  |
| `objekt` | wikilink | enum{#aktivum, #proces} |  | frontmatter |  | IU-O (ziadna) | Objekt | iba impact (IU-O alebo #aktivum) |
| `faza_iso22263` | list[enum{inception, brief, design, production, maintenance, demolition}] |  | frontmatter |  |  | Fáza ISO 22263 | [V1] impact = stav aktíva, delivery = fáza výmeny |
| `faza_lokalna` | list[str] |  | frontmatter |  |  | Fáza (lokálna) |  |
| `datum` | date |  | frontmatter |  |  | Dátum | IBA v projekte · → 7817-3 InformationDeliveryMilestone/@Date |
| `vyvolava` | list[wikilink] |  | inline | Popis | EV (ziadna) | Vyvoláva | iba impact |

## ACT — §10 ACT — aktér (cesta strana/tím/funkcia).
Sekcie tela (poradie šablóny): `## Popis`

| Pole | Typ | Povinné | Zdroj | Sekcia | Cieľ odkazu | Názov | Popis / export |
|---|---|---|---|---|---|---|---|
| `id` | str | ✓ | frontmatter |  |  | ID | prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia · → 29481-3 specId/localCode ; 7817-3 name |
| `guid` | str |  | frontmatter |  |  | GUID | generuje nástroj · → specId/guid ; dt:GUID |
| `typ` | enum{GOAL, UC, ER, IU-O, IU-C, STD, GEO, PROP, DEF, EV, ACT, PROT, PROJ} | ✓ | frontmatter |  |  | Typ |  |
| `nazov` | str | ✓ | frontmatter |  |  | Názov |  |
| `nazov_en` | str | ✓ | frontmatter |  |  | Názov (EN) | → specId/shortTitle ; 7817-3 Purpose/Language |
| `stav` | enum{NP, WD, PUB, WDRL} | ✓ | frontmatter |  |  | Stav | → documentStatus |
| `verzia` | str | ✓ | frontmatter |  |  | Verzia | → specId/version |
| `jazyk` | str |  | frontmatter |  |  | Jazyk | ISO 639-1 · → uc/language |
| `autor` | str |  | frontmatter |  |  | Autor | → authoring/author |
| `licencia` | str |  | frontmatter |  |  | Licencia | → authoring/copyright |
| `aliases` | list[str] |  | frontmatter |  |  | Aliasy | [V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview) |
| `uroven` | enum{strana, tim, funkcia} | ✓ | frontmatter |  |  | Úroveň | strana | tim | funkcia; odvodí sa z cesty a kontroluje (A9) |
| `strana` | enum{poverujuca, veduca-poverena, poverena} | ✓ | frontmatter |  |  | Strana | → 29481-3 classification ; 7817-3 @affiliation |
| `klasifikacia_19650` | str |  | frontmatter |  |  | Klasifikácia 19650 |  |
| `zmluvne_oznacenie` | str |  | frontmatter |  |  | Zmluvné označenie | IBA projekt |
| `osoby` | list[Osoba] |  | frontmatter |  |  | Osoby | IBA projekt |
| `osoby[].meno` | str |  |  |  |  | Meno | → 7817-3 @firstName |
| `osoby[].priezvisko` | str |  |  |  |  | Priezvisko | → @lastName |
| `osoby[].email` | str |  |  |  |  | E-mail | → EMail |
| `osoby[].organizacia` | str |  |  |  |  | Organizácia |  |

## PROT — §11 PROT — BIM protokol (próza, zmluvný obal).

| Pole | Typ | Povinné | Zdroj | Sekcia | Cieľ odkazu | Názov | Popis / export |
|---|---|---|---|---|---|---|---|
| `id` | str | ✓ | frontmatter |  |  | ID | prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia · → 29481-3 specId/localCode ; 7817-3 name |
| `guid` | str |  | frontmatter |  |  | GUID | generuje nástroj · → specId/guid ; dt:GUID |
| `typ` | enum{GOAL, UC, ER, IU-O, IU-C, STD, GEO, PROP, DEF, EV, ACT, PROT, PROJ} | ✓ | frontmatter |  |  | Typ |  |
| `nazov` | str | ✓ | frontmatter |  |  | Názov |  |
| `nazov_en` | str | ✓ | frontmatter |  |  | Názov (EN) | → specId/shortTitle ; 7817-3 Purpose/Language |
| `stav` | enum{NP, WD, PUB, WDRL} | ✓ | frontmatter |  |  | Stav | → documentStatus |
| `verzia` | str | ✓ | frontmatter |  |  | Verzia | → specId/version |
| `jazyk` | str |  | frontmatter |  |  | Jazyk | ISO 639-1 · → uc/language |
| `autor` | str |  | frontmatter |  |  | Autor | → authoring/author |
| `licencia` | str |  | frontmatter |  |  | Licencia | → authoring/copyright |
| `aliases` | list[str] |  | frontmatter |  |  | Aliasy | [V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview) |
| `odkazuje_na` | list[wikilink] |  | frontmatter |  | PROJ, STD (ziadna) | Odkazuje na |  |
| `funkcie` | list[wikilink] |  | frontmatter |  | ACT (ziadna) | Funkcie |  |
| `prednost_dokumentov` | list[enum{PROT, EIR, STD, BEP}] |  | frontmatter |  |  | Prednosť dokumentov |  |
| `zavaznost` | enum{zmluvne} |  | frontmatter |  |  | Záväznosť | vždy zmluvne, bez overenia (F11) |

## PROJ — §12 PROJ — projektová inštancia (= EIR).
Sekcie tela (poradie šablóny): `## Popis`

| Pole | Typ | Povinné | Zdroj | Sekcia | Cieľ odkazu | Názov | Popis / export |
|---|---|---|---|---|---|---|---|
| `id` | str | ✓ | frontmatter |  |  | ID | prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia · → 29481-3 specId/localCode ; 7817-3 name |
| `guid` | str |  | frontmatter |  |  | GUID | generuje nástroj · → specId/guid ; dt:GUID |
| `typ` | enum{GOAL, UC, ER, IU-O, IU-C, STD, GEO, PROP, DEF, EV, ACT, PROT, PROJ} | ✓ | frontmatter |  |  | Typ |  |
| `nazov` | str | ✓ | frontmatter |  |  | Názov |  |
| `nazov_en` | str | ✓ | frontmatter |  |  | Názov (EN) | → specId/shortTitle ; 7817-3 Purpose/Language |
| `stav` | enum{NP, WD, PUB, WDRL} | ✓ | frontmatter |  |  | Stav | → documentStatus |
| `verzia` | str | ✓ | frontmatter |  |  | Verzia | → specId/version |
| `jazyk` | str |  | frontmatter |  |  | Jazyk | ISO 639-1 · → uc/language |
| `autor` | str |  | frontmatter |  |  | Autor | → authoring/author |
| `licencia` | str |  | frontmatter |  |  | Licencia | → authoring/copyright |
| `aliases` | list[str] |  | frontmatter |  |  | Aliasy | [V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview) |
| `projekt` | str | ✓ | frontmatter |  |  | Projekt |  |
| `spustacia_udalost` | wikilink | ✓ | frontmatter |  | EV (ziadna) | Spúšťacia udalosť | impact event – POVINNÉ (PAS 6.1.3) |
| `aktivum` | wikilink | str |  | frontmatter |  |  | Aktívum |  |
| `ciele` | list[wikilink] |  | frontmatter |  | GOAL (ziadna) | Ciele |  |
| `poverenie` | str |  | frontmatter |  |  | Poverenie |  |
| `strany` | map[StranaProj] |  | frontmatter |  |  | Strany | kľúč = "[[ACT-…]]" |
| `strany.zmluvne_oznacenie` | str |  |  |  |  | Zmluvné označenie |  |
| `strany.organizacia` | str |  |  |  |  | Organizácia |  |
| `er` | list[wikilink] |  | frontmatter |  | ER (ziadna) | ER |  |
| `udalosti` | list[UdalostProj] |  | frontmatter |  |  | Udalosti |  |
| `udalosti[].ev` | wikilink | ✓ |  |  | EV (ziadna) | Udalosť |  |
| `udalosti[].datum` | date |  |  |  |  | Dátum |  |
| `std_projekt` | wikilink |  | frontmatter |  | STD (ziadna) | STD projekt |  |
| `vystupy` | list[Vystup] |  | frontmatter |  |  | Výstupy | generované, s hash |
| `vystupy[].typ` | str | ✓ |  |  |  | Typ |  |
| `vystupy[].subor` | str | ✓ |  |  |  | Súbor |  |
| `vystupy[].hash` | str |  |  |  |  | Hash |  |

## Pod-záznam `pravidlo` — §6 STD — informačný štandard: index note + sub-records (rules, GEO profiles, dictionaries).

| Pole | Typ | Povinné | Zdroj | Sekcia | Cieľ odkazu | Názov | Popis / export |
|---|---|---|---|---|---|---|---|
| `id` | str | ✓ | frontmatter |  |  | ID | == prvý token nadpisu (A11) |
| `poznamka` | str |  | frontmatter |  |  | Poznámka (rodič) | odvodené |
| `nazov` | str | ✓ | frontmatter |  |  | Názov |  |
| `rozsah` | enum{objekt, kontajner, federacia} | ✓ | frontmatter |  |  | Rozsah | objekt | kontajner | federacia (federacia = LEN relačné cross-file) |
| `plati` | enum{vzdy, na_vyziadanie} | ✓ | frontmatter |  |  | Platí | vzdy | na_vyziadanie (ER zapína cez `zapnute::`) |
| `ucel_federacie` | bool |  | frontmatter |  |  | Účel federácie |  |
| `overenie` | enum{IDS, manual, clash-detection} |  | frontmatter |  |  | Overenie | §14b |
| `zavaznost` | enum{zmluvne, musi, ma, informativne} |  | frontmatter |  |  | Záväznosť |  |
| `zdroj_normy` | str |  | frontmatter |  |  | Zdroj (norma) |  |
| `hodnoty` | list[str | int | float | bool] | map[Any] |  | frontmatter |  |  | Hodnoty | [V11] vylučuje sa so `zdroj_hodnot` · obmedzenie: hodnota |
| `zdroj_hodnot` | wikilink |  | frontmatter |  | IU-C (ziadna) | Zdroj hodnôt | [V11] master DiMS |
| `applicability` | Applicability |  | frontmatter |  |  | Applicability | → IDS applicability |
| `applicability.entity` | str | list[str] |  |  |  |  | Entita | [V5] môže byť abstraktná – generátor rozvinie · → IDS applicability/entity |
| `applicability.predefined_type` | str |  |  |  |  | PredefinedType |  |
| `applicability.filter` | list[FacetEntity | FacetAttribute | FacetClassification | FacetProperty | FacetMaterial | FacetPartOf] |  |  |  |  | Filter |  |
| `pritomnost_v_modeli` | enum{required, optional, prohibited} |  | frontmatter |  |  | Prítomnosť v modeli | → IDS minOccurs/maxOccurs · obmedzenie: prítomnosť |
| `requirements` | list[FacetEntity | FacetAttribute | FacetClassification | FacetProperty | FacetMaterial | FacetPartOf] |  | frontmatter |  |  | Requirements | → IDS requirements |
| `text` | str |  | frontmatter |  |  | Text |  |
| `pokyn` | str |  | frontmatter |  |  | Pokyn |  |
| `postup` | str |  | frontmatter |  |  | Postup (fallback) |  |
| `vynimka` | bool |  | frontmatter |  |  | Výnimka | núdzový ```ids blok len s vynimka: true (F7) |

## Pod-záznam `profil` — §6a GEO — geometrický profil (v STD-geo-profily).

| Pole | Typ | Povinné | Zdroj | Sekcia | Cieľ odkazu | Názov | Popis / export |
|---|---|---|---|---|---|---|---|
| `id` | str | ✓ | frontmatter |  |  | ID | == prvý token nadpisu (A11) |
| `poznamka` | str |  | frontmatter |  |  | Poznámka (rodič) | odvodené |
| `nazov` | str | ✓ | frontmatter |  |  | Názov |  |
| `aspekty` | Aspekty | ✓ | frontmatter |  |  | Aspekty | → 7817-3 GeometricalInformation |
| `aspekty.ShapeAssembly` | enum{NotRequired, SingleObjectSingularShape, SingleObjectMultipleShapes, MultipleObjects} |  |  |  |  |  | → 7817-3 ShapeAssembly |
| `aspekty.ShapeRepresentation` | enum{NotRequired, SingleBoundingPrimitive, OuterShellAsSingularShape, OuterShellAsSeparateShapes} |  |  |  |  |  | → 7817-3 ShapeRepresentation |
| `aspekty.ShapeInfluence` | ShapeInfluenceModel |  |  |  |  |  | → 7817-3 ShapeInfluence |
| `aspekty.ShapeInfluence.InsideGeometry` | enum{NotRequired, NoInsideGeometry, InsideGeometryAsPartOfShape, SeparateShapes} |  |  |  |  |  | → 7817-3 ShapeInfluence |
| `aspekty.ShapeInfluence.Connections` | enum{NotRequired, NoConnections, ConnectionsAsPartOfShape, SeparateShapes} |  |  |  |  |  |  |
| `aspekty.ShapeInfluence.Openings` | enum{NotRequired, NoOpenings, OpeningsAsPartOfShape, SeparateShapes} |  |  |  |  |  |  |
| `aspekty.ShapeInfluence.OperatingAndClearanceZones` | enum{NotRequired, NoOperatingAndClearanceZones, OperatingAndClearanceZonesAsPartOfShape, SeparateShapes} |  |  |  |  |  |  |
| `aspekty.ShapeInfluence.Features` | enum{NotRequired, NoFeatures, FeaturesAsPartOfShape, SeparateShapes} |  |  |  |  |  |  |
| `aspekty.ShapeInfluence.ThresholdDimension` | ThresholdDimensionModel |  |  |  |  |  |  |
| `aspekty.ShapeInfluence.ThresholdDimension.hodnota` | float |  |  |  |  | Hodnota |  |
| `aspekty.ShapeInfluence.ThresholdDimension.jednotka` | str |  |  |  |  | Jednotka |  |
| `aspekty.Dimensionality` | enum{NotRequired, 0D, 1D, 2D, 3D} |  |  |  |  |  | → 7817-3 Dimensionality |
| `aspekty.Appearance` | enum{NotRequired, NoAppearanceInformation, SymbolicByMapping, SingularMaterial, MultipleMaterials, ConceptualAppearance, RealisticAppearance} |  |  |  |  |  | → 7817-3 Appearance |
| `aspekty.ParametricBehaviour` | enum{NotRequested, Requested} |  |  |  |  |  | → 7817-3 ParametricBehaviour |
| `aspekty.Location` | LocationModel |  |  |  |  |  | → 7817-3 Location |
| `aspekty.Location.PositioningType` | enum{Absolute, Relative, NotDefined} |  |  |  |  |  | → 7817-3 Location |
| `aspekty.Location.ReferenceObject` | str |  |  |  |  |  |  |
| `aspekty.Location.crs` | enum{NotRequired, ProjectedCRS, EngineeringCRS, GeographicCRS} |  |  |  |  | CRS typ |  |
| `dictionary` | str |  | frontmatter |  |  | Dictionary | → 7817-3 Detail/Dictionary |
| `vhodne_pre` | str |  | frontmatter |  |  | Vhodné pre |  |

## Pod-záznam `slovnik` — Dictionary in STD-klasifikacia (§0.10): ``hodnoty`` or ``vzor``, optionally ``odvodene_z``.

| Pole | Typ | Povinné | Zdroj | Sekcia | Cieľ odkazu | Názov | Popis / export |
|---|---|---|---|---|---|---|---|
| `id` | str | ✓ | frontmatter |  |  | ID | == prvý token nadpisu (A11) |
| `poznamka` | str |  | frontmatter |  |  | Poznámka (rodič) | odvodené |
| `system` | str |  | frontmatter |  |  | Systém |  |
| `hodnoty` | list[str | int | float | bool] |  | frontmatter |  |  | Hodnoty | obmedzenie: hodnota |
| `vzor` | str |  | frontmatter |  |  | Vzor (regex) | obmedzenie: hodnota |
| `odvodene_z` | wikilink |  | frontmatter |  | STD (povinna) | Odvodené z |  |
| `uri` | str |  | frontmatter |  |  | URI |  |
