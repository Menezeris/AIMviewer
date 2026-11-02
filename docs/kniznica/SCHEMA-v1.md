---
name: SCHEMA-v1
description: Záväzné polia v1.5 pre všetky typy poznámok balíka zadávacích podmienok (GOAL, UC, ER, IU-O, IU-C, STD, GEO, PROP, DEF, EV, ACT, PROT, PROJ) s mapovaním na 29481-3, 7817-3, 23387, IDS 1.0 a s validačnými pravidlami
status: v1.5 (2026-09-14) — po vzore UC-0101, zapracované V1–V27 (V19 definícia vs. dosadenie, V20 pásma noriem, V21 jedno miesto poznámky, V22 odvodené údaje inšpektora, V23 reťazec ako strom, V24 `datovy_typ` na položke, V25 klasifikácia s povinnosťou do requirements, V26 MVD a dve triedy obmedzení podľa PAS 6.3.3, V27 rozsah priradenia v `IU-C.obsahuje`)
nadvazuje_na: "[[LOIN-editor-struktura-navrh]]"
predchodca: "[[SCHEMA-v1.0-archiv]]"
origin: ai
verified:
---

# SCHEMA v1.5 — polia poznámok

Zdroj rozhodnutí: séria `LOIN-00`…`LOIN-09` (§17–§20). Revízia v1.1 → v1.2 vznikla z prvého vzoru `UC-0101`; zmeny sú označené `[V1]`…`[V16]` a ich odôvodnenie je v `SCHEMA-v1.2 zmeny.md`. Revízia v1.2 → v1.3 (F1, `docs/PLAN.md` §0) pridáva `[V17]` a `[V18]`; vykonala ju migrácia `assetin migrate --to 1.3` (`assetin/engine/migrations/v1_2_to_v1_3.py`). Revízia v1.3 → v1.4 (12. 9.) pridáva `[V24]` (`datovy_typ` na položke, migrácia `v1_3_to_v1_4.py`) a `[V25]` (klasifikácia s `povinnost` ide do IDS requirements — výklad, nie pole). Revízia v1.4 → v1.5 (14. 9., kolo 4) pridáva `[V26]` (`IU-C.mvd` a pomenovanie dvoch tried obmedzení podľa PAS 1958 6.3.3 — trieda je atribút na definícii poľa, nové pole nepribudlo) a `[V27]` (`IU-C.obsahuje` je priradenie `iu` + `rozsah` aspektov LOIN, `ER.obsahuje` nesie len kontajnery; migrácia `v1_4_to_v1_5.py`). **Pozor na číslovanie:** v zadaní kola 4 boli označené ako V24 a V25; tie čísla už niesli `datovy_typ` a klasifikáciu, preto sú tu V26 a V27 (DECISIONS Z5). Rozhodnutia z prestavby editora sú `[V19]`…`[V23]`; **verzia balíka sa kvôli nim nebumpla a migrácia k nim nie je**, lebo nemenia ani jedno pole poznámky — V19 mení validačné pravidlo, V20 pridáva deklaráciu na *type* poznámky, V21 a V22 sú dôsledky pre appku. (V zadaní prestavby boli očíslované V17–V20; tie čísla už niesli úlohy UC a `aliases`, preto sú tu posunuté — mapovanie je v `docs/QUESTIONS.md` Q17.) Verzia schémy balíka je na jednom mieste: `KNIZNICA.md` v koreni (`schema_verzia`), PLAN R6. Strojová podoba schémy: pydantic modely v `assetin/schema/` → `docs/schema/*.json` a `docs/POLIA.md` (generované).

## 0. Pravidlá schémy
1. **MD je zdroj pravdy.** 29481-3, 7817-3, 23387 a IDS 1.0 sú exportné profily. Komentár `# → …` pri poli = kam sa exportuje; pole bez komentára = naše rozšírenie (export cez `userDefinedProperty` / `constraint` / vôbec).
2. **Vrstvu určuje priečinok**, nie pole: `zadanie/` = organizácia (knižnica), `aktiva/<budova>/` = aktívum, `projekty/<zakazka>/` = projekt. Nižšia vrstva **nekopíruje, vyberá a prepisuje**.
   **[V19] Deliaca čiara je definícia vs. dosadenie, nie „organizačné vs. projektové".** Knižnica je *jedna zásoba definícií*: ciele všetkých troch úrovní, účely užitia, výmeny, objekty, kontajnery, pravidlá, udalosti a aktéri. Cieľ „získať stavebné povolenie" je definícia (opakuje sa, nemá termín) → knižnica; „získať stavebné povolenie pre Budovu X do 30. 6. 2027" je dosadenie → projekt. Preto sú v `zadanie/` zakázané **`GOAL.termin`, `GOAL.aktivum`, `ACT.osoby`, `ACT.zmluvne_oznacenie`, `EV.datum` a celý typ `PROJ`** (§16.6, pravidlo A8), zatiaľ čo **`GOAL.uroven: projekt` zakázaná nie je** — je to druh cieľa, nie príznak vrstvy. GOAL sa tým správa rovnako ako EV (udalosť v knižnici, dátum až v projekte) a ACT (funkcia v knižnici, meno až v projekte).
3. **Odkazy:** vzťah poznámka → poznámka na najvyššej úrovni = inline pole v tele (`kluc:: [[cieľ]]`, smer daný umiestnením). Vo vnorených štruktúrach frontmatter = reťazec `"[[ID]]"` (Obsidian aj Dataview ho čítajú ako link).
   **Smer typovaných väzieb [V4]:** poznámka alebo položka, v ktorej pole stojí, je *subjekt*; cieľ odkazu je *objekt*.
   - `X nadradene_pri_rozpore:: Y` → **Y** má pri rozpore prednosť pred X.
   - `X dokladuje:: Y` → X je dokladom pre Y.
   - `X dolozene_v:: Y` → Y dokladuje X (inverzia; používa sa na položkách IU-O).
   - `X odvodene_z:: Y`, `X doplnuje:: Y` — zrejmé.
4. **ID** = prefix + číslo (`UC-0101`) alebo cesta (`ACT-poverena/ARCH`); názov súboru = `ID Názov.md`; `guid` generuje nástroj.
   **Výnimka ACT [V7]:** názov súboru = posledný segment cesty; strana a tím sú folder-notes (`registre/ACT/poverujuca/poverujuca.md`, `registre/ACT/poverena/ARCH/ARCH.md`).
   **ID nesie cesta [V18]:** `id:` vo frontmatter je udržiavaná kópia (validátor kontroluje zhodu, A3); `aliases: [<id>]` udržiava writer pri každom zápise (pridá `id`, cudzie aliasy neodstraňuje) — Obsidian ponúkne poznámku podľa ID v návrhári odkazov a Dataview číta `id` ako pole. Odkazy `[[ID]]` rozlišuje engine podľa ID, nie Obsidian (docs/QUESTIONS.md Q14).
5. **Každá poznámka:** `id, guid, typ, nazov, nazov_en, stav, verzia, jazyk`. `nazov_en` povinný (29481-3 `shortTitle` musí byť EN).
6. **`overenie` je obmedzené zložkou** (§14b) a autor ho píše len pri prepise predvoľby. Požiadavka bez overiteľnosti je prípustná iba so `zavaznost: zmluvne | informativne`.
   **[V3]** `IDS` overuje *prítomnosť, typ, vzor, výčet a rozsah* hodnoty. **Zhoda hodnoty s externým zdrojom** (zameranie, zmluva, podklad) sa nepíše na položku, ale na dokumentačnú položku, ktorá ju dokladuje: `dokumentacia[].postup`. Položka nesie iba `tolerancia` ako metadáta a `dolozene_v` ako odkaz.
7. **Prednosť pri prepisoch:** PROJ (dosadenie) > ER (výmena) > IU (knižnica) > STD (predvoľby). ER prepisuje hodnoty (`povinnost`, `hodnoty`, `profil`, `zavaznost`), nikdy definície.
8. Enumy §14; hodnoty mimo enumu validátor odmietne. Validačné pravidlá §16.
9. **Každá informácia má práve jedného nositeľa [V15].** Model (DiMS) nesie to, čo je o stavbe; CDE nesie kontajnery a ich metadáta; AIM/CAFM nesie prevádzku, zmluvy a osoby; knižnica nesie požiadavky a odkazy. Duplikát je vždy chyba, aj keď je pohodlný — ani smerom do modelu (nájomca do `IfcZone.LongName`), ani smerom von z neho (tabuľka miestností ako samostatný dataset).
10. **Slovníky sa neopisujú [V14].** Výčty hodnôt, kódy klasifikácií a konvencie žijú v `STD-klasifikacia` / `STD-naming`; položky a pravidlá na ne odkazujú (`hodnoty_ref`, `pravidlo`), nikdy ich nekopírujú. `hodnoty` a `hodnoty_ref` sa vylučujú.

## Spoločná hlavička
```yaml
id: UC-0101                 # → 29481-3 specId/localCode ; 7817-3 name
aliases: [UC-0101]          # [V18] udržiava writer; vždy obsahuje id
guid: 0c3b…                 # → specId/guid ; dt:GUID
typ: UC                     # GOAL | UC | ER | IU-O | IU-C | STD | GEO | PROP | DEF | EV | ACT | PROT | PROJ
nazov: Priestorová pasportizácia
nazov_en: Spatial survey    # → specId/shortTitle (EN povinné) ; 7817-3 Purpose/Language
stav: WD                    # → documentStatus: NP | WD | PUB | WDRL
verzia: 0.1                 # → specId/version
jazyk: sk                   # → uc/language (ISO 639-1)
autor: Assetin              # → authoring/author ; changeLog = git
licencia: CC-BY-4.0         # → authoring/copyright (required v 29481-3)
```

---

## 1. GOAL — cieľ (organizácia / aktívum / projekt)
Jeden typ, tri úrovne podľa 19650-1 kaskády OIR → AIR → PIR. Nižšia úroveň *prispieva* k vyššej (nutná, nie postačujúca podmienka). Nie „BIM cieľ" — BIM je prostriedok. „Projekt" = odpoveď na impact event (PAS 6.1.3; DIS 19650-1:2026), nie nutne výstavba. `zdroj_ir` je perspektíva stakeholdera (DIS 2026), nie dokument.
```yaml
typ: GOAL
uroven: aktivum               # organizacia (OIR) | aktivum (AIR) | projekt (PIR)
zdroj_ir: AIR                 # OIR | AIR | PIR
aktivum: Budova X             # iba uroven: aktivum | projekt
termin: 2027-06-30            # iba uroven: projekt
kpi:                          # metrika organizácie/aktíva/projektu, nie modelu
  - metrika: rozdiel zmluvnej a zameranej plochy nájomných jednotiek
    ciel: "< 1 %"
```
Telo: `## Popis`, `prispieva_k:: [[GOAL-…]]` (nižšia → vyššia), `zdroj_oir:: [[…]]`.
Umiestnenie: organizácia → `zadanie/GOAL/`; aktívum → `aktiva/<budova>/`; projekt → `projekty/<zakazka>/` (odkazovaný z `PROJ.ciele`).
Export: 29481-3 `uc/benefits` (text) + `benefitKeyword`.

---

## 2. UC — use case (zobrazovaný názov: „účel užitia")
**Čo to je:** scenár — „sled činností rolí na dosiahnutie účelu" (29481-1 3.3.2). *Use* = použitie procesu aktérmi, nie použitie informácie. Scenár informácie *potrebuje* (utilization tasky) aj *vyrába* (delivery tasky); vzorový IDM normy („Design Authoring") je výrobný scenár → pasportizácia je plnohodnotný UC.
**Dve „prečo":** lokálne = cieľ scenára (`aimAndScope`; 29481-1 „purpose", 7817-1 „proč", PAS „purpose = use case + business kontext", 19650-1 5.1 „purposes"); organizačné = GOAL.
**Tasky:** UC obsahuje tasky; každý je `delivery` alebo `utilization` (PAS 6.2.1; verifikácia, schvaľovanie, správa CDE = utilization). Impact event spúšťa UC; delivery event spúšťa tasky (→ ER).
**`typ_ulohy` [V6]** = sumár taskov **poskytovateľov** (poverenej strany). Preberacie tasky príjemcu (kontrola, autorizácia) sú v každom delivery UC a do sumáru sa nepočítajú. `utilization` = UC, ktorého poskytovateľské tasky informácie *používajú*, nie vyrábajú; `oboje` len ak poskytovatelia robia jedno aj druhé.
**Hranica:** profesie sa delia na **sub-UC** tam, kde sa líšia tasky/aktéri/jednotky (priestorová vs. TZB), nie kvôli poskytovateľovi.
```yaml
typ: UC
kratky_nazov_en: SpatialSurvey          # → specId/shortTitle
typ_ulohy: delivery                     # delivery | utilization | oboje (sumár taskov poskytovateľov)
region: [SVK, CZE]                      # → uc/region (ISO 3166-1 alpha-3), 1:*
faza_iso22263: [maintenance, demolition]  # → standardProjectPhase 1:* — PRÍPUSTNOSŤ scenára (B1) [V1]
faza_lokalna: [prevádzka]               # → localProjectPhase ; mapovanie v STD-fazy
construction_entity: [administratívna budova]   # → constructionEntity
zrelost: Example                        # Outlook | Example | Proven (UCM)
pouzitie:                               # → use 1:*, sloveso+podstatné meno (29481-1 tab. 1)
  - ZamerajPriestory
  - KlasifikujMiestnosti
```
Telo (poradie záväzné → 29481-3 `uc`):
```
## Zhrnutie                          # → summary
## Cieľ a rozsah                     # → aimAndScope   (lokálne „prečo")
## Vymedzenie (čo use case nie je)   # → limitations
## Rámcové podmienky                 # → reference{basisStandard, fullCitation}
- norma:: ISO 7817-1 …
## Prínosy                           # → benefits
podporuje_ciel:: [[GOAL-01]]
## Spúšťacia udalosť
spustacia_udalost:: [[EV-I-0007]]    # iba impact (delivery patrí na ER)
## Aktéri                            # → actor{id, name, classification}
aktor:: [[ACT-poverujuca]], [[ACT-poverena/ARCH]], [[ACT-poverena/geodet]]
## Hierarchia
nadradeny_uc:: [[UC-0100]]           # → subUc / subIdm pri exporte
## Business context                  # → businessContextMap (v1 bez BPMN) ; úlohy = YAML blok `ulohy:` [V17]
```yaml
ulohy:
  - id: T1
    nazov: zameranie priestorov
    typ: delivery                    # delivery | utilization
    aktor: "[[ACT-poverena/geodet]]"
  - id: T2
    nazov: vytvorenie IfcSpace a klasifikácia
    typ: delivery
    aktor: "[[ACT-poverena/ARCH]]"
    vystup: ["[[IU-O-storey]]", "[[IU-O-space]]"]
  - id: D1
    nazov: kontrola a autorizácia
    typ: utilization
    aktor: "[[ACT-poverujuca/koordinator-BIM]]"
```
## Business rules                    # → businessRule{id, name, proposition, reference}
pravidlo:: [[DEF-plocha-hruba]], [[DEF-plocha-cista]]
## Fázy → ER                         # GENEROVANÉ z ER.spustacia_udalost.faza ; → standardProjectPhase/…/associatedEr
```
**[V17] Úlohy sú dáta.** Blok `ulohy:` pod `## Business context` je *blokové pole* UC (jeden top-level kľúč = pole poznámky). Kotva `[[UC-0101#T2]]` (napr. `pre_task::` v IU-O) sa rozlišuje na `ulohy[].id`; `typ_ulohy` sa overuje ako sumár `ulohy[].typ` úloh poskytovateľov (V6, C5); export 29481-3 `businessContextMap` a RACI čítajú dáta, nie prózu. Pôvodný prozaický zoznam v1.2 (`- T1 … (delivery, [[ACT]]) → [[IU]]`) migrácia zachová ako HTML komentár.
Export: 1 sub-UC = 1 `idm` (29481-3 `uc` 1:1); rodič UC → `idm` so `subIdm`.

---

## 3. ER — exchange requirement
ER = **UC × delivery event × príjemca** (29481-1 3.3.10). Poskytovateľov v ER môže byť viac (rieši IU). ER = IDS súbor; IU-O sú šablóny špecifikácií; **prepisy = delta** medzi šablónou a materializovanou špecifikáciou pre túto výmenu. ER **fázu nemá** — dedí z EV.
```yaml
typ: ER
forma:                                 # → correspondingMvd ; IDS @ifcVersion ; PAS aspekt d
  format: IFC
  verzia_schemy: IFC4X3_ADD2
poskytovatel_predvoleny: "[[ACT-poverena/ARCH]]"   # len pre IU bez vlastného poskytovateľa
prijemca: "[[ACT-poverujuca]]"                     # jeden na výmenu; IU dedí
```
Telo:
```
## Popis                             # → er/description ; IDS info/description
uc:: [[UC-0101]]                     # práve jeden
spustacia_udalost:: [[EV-D-0012]]    # delivery, ≥1 ; ER si udalosť VYBERÁ ; → 7817-3 InformationDeliveryMilestone ; IDS info/milestone
precondition:: [[ER-0105]]           # 29481-1 5.5.1
referencne_info:: [[IU-C-podklady-PD]]         # 19650-2 5.1.6
standard:: [[STD]]                   # indexová poznámka; pravidlá plati: vzdy platia automaticky
zapnute:: [[STD-FED-10]], [[STD-CL-04]]        # podmienené pravidlá (plati: na_vyziadanie)
## Informačné jednotky               # → informationUnit 1:* ; [V27] len kontajnery (IU-C), objekty cez priradenie
obsahuje:: [[IU-O-space]], [[IU-O-storey]], [[IU-O-zone]], [[IU-C-arch-model]], [[IU-C-protokol-zamerania]]
```
Prepisy pre túto výmenu — delta voči IU (prednosť ER > IU); len hodnoty, nie definície. **Čistý YAML [V16]:**
```yaml
prepisy:
  - iu: "[[IU-O-space]]"
    polozka: GrossFloorArea
    povinnost: required
  - iu: "[[IU-O-space]]"
    geometria.profil: "[[GEO-G1]]"
```
Export: 29481-3 `er`; projektová inštancia = 7817-3 `Specification` **per (ER × udalosť × poskytovateľ)**; IDS súbor per Specification (`ids:info` ← ER + PROJ).

---

## 4. IU-O — informačná jednotka: typ objektu (= šablóna IDS špecifikácie)
```yaml
typ: IU-O
objekt:                                # → 7817-3 ObjectType (23387) ; IDS applicability/entity
  ifc_entita: IfcSpace
  predefined_type:
  uri: https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3/class/IfcSpace   # → @dt:about
klasifikacia:                          # → IDS classification facet ; 7817-3 DictionaryRef
  - system: CCI
    pravidlo: "[[STD-klasifikacia#CCI-priestory]]"   # [V14] tabuľka a vzor kódu žijú v STD, tu len odkaz
    povinnost: required                # [V25] s `povinnost` → IDS requirements (cardinality); BEZ nej → applicability
# [V25] Klasifikácia s povinnosťou je požiadavka („objekt musí mať kód"), preto ide do requirements.
# V applicability by objekt bez kódu do výberu nespadol a kontrolou by prešiel mlčky (Q36).
filter:                                # IDS applicability nad rámec entity + klasifikácia (voliteľné) [V16]
  - facet: attribute
    nazov: Description
    vzor: ".*KANCEL.*"
# [V9] filter iba ZUŽUJE applicability, nič nevynucuje. Ak filter používa atribút/vlastnosť,
# ktorá musí existovať na všetkých inštanciách entity, existuje k nej nefiltrované STD pravidlo
# `plati: vzdy` (vzor: STD-CL-06 pre IfcZone.ObjectType).
pritomnost_v_modeli: required          # → IDS minOccurs/maxOccurs: required | optional | prohibited
uroven: vyskyt                         # typ | vyskyt (požiadavka na typ, overenie per výskyt)
zdovodnenie: "Plochy miestností sú základ pre nájomné zmluvy (GOAL-01, T3)."   # → IDS description
pokyn: "Každá miestnosť ako samostatný IfcSpace, hranica po líci steny podľa DEF."   # → IDS instructions
zavaznost_predvolena: musi             # predvoľba pre položky

geometria:                             # → 7817-3 GeometricalInformation (enumy §14)
  profil: "[[GEO-G2]]"                 # preset; explicitný aspekt poráža profil
  ShapeAssembly: SingleObjectSingularShape
  ShapeRepresentation: OuterShellAsSingularShape
  ShapeInfluence:
    InsideGeometry: NotRequired
    Connections: NotRequired
    Openings: NotRequired
    OperatingAndClearanceZones: NotRequired
    Features: NotRequired
    ThresholdDimension: {hodnota: 0.1, jednotka: m}
  Dimensionality: 3D
  Appearance: NoAppearanceInformation
  ParametricBehaviour: NotRequested
  Location: {PositioningType: Relative, ReferenceObject: IfcBuildingStorey}
  placeholder: false
  poznamka: {zahrna: [], nezahrna: [zariaďovacie predmety], text: ""}
  pokyn: "obrys po líci omietky, výška po strop"
  overenie: manual                     # manual (predvoľba) | clash-detection
  postup: "porovnať obrys s protokolom zamerania, tolerancia podľa DEF"
  presnost: "±2 cm"                    # metadáta kvality (7817-1 6.1 pozn. 3)
  zavaznost: musi

alfanumerika:                          # → 7817-3 AlphanumericalInformation/Property ; IDS requirements
  - ifc: {atribut: Name}               # IFC atribút → IDS attribute facet
    rola: identifikacia                # identifikacia | obsah (predvoľba obsah)
    vzor: "^[0-9]{2}\\.[0-9]{3}$"
    pravidlo: "[[STD-NAME-03]]"        # zdroj konvencie (nie kópia)
    povinnost: required                # → IDS cardinality: required | optional | prohibited
    pokyn: "kód miestnosti: podlažie.poradie"
  - ifc: {pset: Qto_SpaceBaseQuantities, nazov: NetFloorArea, uri: https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3/prop/NetFloorArea}
    datovy_typ: IFCAREAMEASURE         # [V24] → IDS @dataType; IFC jednoduchý typ VEĽKÝMI
    # jednotka, definícia a aplikovateľnosť ostávajú v IFC 4.3 / bSDD; tu je len to, čo IDS žiada v súbore
    rola: obsah
    definicia_ref: "[[DEF-plocha-cista]]"   # [V2] meraná hodnota ; → Property.Definition + ReferenceDocumentRef
    povinnost: required
    hodnoty:                           # enum → 7817-3 PossibleValues ; IDS xs:enumeration
    hodnoty_ref:                       # [V14] odkaz na slovník v STD-klasifikacia; vylučuje sa s `hodnoty`
    rozsah:                            # číselný rozsah → IDS bounds
    povaha: informacny                 # informacny | technicky (voliteľné)
    pokyn: "vypočítať z obrysu IfcSpace podľa DEF"
    overenie: IDS                      # IDS (predvoľba) | manual
    tolerancia: "0.5 %"                # metadáta; zhodu s realitou overuje dokumentačná položka (§0.6)
    dolozene_v: "[[IU-C-protokol-zamerania]]"   # [V4] kontajner, ktorý túto položku dokladuje
  - ifc: {material: "beton"}           # material facet (voliteľné)
    povinnost: optional
  - prop: "[[PROP-…]]"                 # iba vlastná vlastnosť mimo IFC (§7)
    povinnost: required

dokumentacia:                          # → 7817-3 Documentation/Document (GUID z IU-C) ; IfcRelAssociatesDocument
  - dok: "[[IU-C-protokol-zamerania]]" # VŽDY odkaz na IU-C; inline dokument nie je prípustný (A5)
    povinnost: required
    pokyn: "viazať na IfcSpace cez IfcRelAssociatesDocument"
    overenie: manual
    postup: "revízia modelu v protokole = odovzdaná revízia; kapitola Odchýlky vyriešená; náhodná kontrola na mieste"
    automatizovatelne: false
    dokladuje: [NetFloorArea, GrossFloorArea]   # [V4] tento dokument je dokladom pre uvedené položky
```
Telo:
```
## Členenie (iba výnimky voči STD-clenenie)
clenenie:: [[STD-CL-02]]              # dedí; tu len prepis/výnimka (IDS partOf)
## Roly
poskytovatel:: [[ACT-poverena/ARCH]]  # AUTORITATÍVNY ; → 7817-3 ProvidingActor ; delí Specification/IDS
overuje:: [[ACT-poverujuca/koordinator-BIM]]     # reviewer (19650-4)
# prijemca sa dedí z ER
## Trasovateľnosť
pre_task:: [[UC-0101#T3]]             # voliteľné; zdroj pre zdovodnenie
## Väzby (typované, smerované — §0.3; len kde väzba mení overenie alebo prednosť)
odvodene_z:: / nadradene_pri_rozpore:: / doplnuje:: / dokladuje:: / dolozene_v::
```
**[V26] Dve triedy obmedzení (PAS 1958 6.3.3).** Polia požiadavky sa delia na dve triedy a mieša ich len ten, kto ich nepomenoval:

| Trieda | Čo hovorí | Polia | Kam ide do IDS |
|---|---|---|---|
| **prítomnosť jednotky** (6.3.3 a) | či jednotka vôbec bola dodaná | `pritomnost_v_modeli`, `alfanumerika[].povinnost`, `dokumentacia[].povinnost`, `klasifikacia[].povinnost` (V25), `facet.cardinality`, ER `prepisy[].povinnost` | `minOccurs/maxOccurs`, `cardinality` |
| **obmedzenie hodnoty** (6.3.3 b) | akú hodnotu smie niesť | `vzor`, `hodnoty`, `hodnoty_ref`, `rozsah`, `datovy_typ`, `tolerancia`, `jednotka` (DEF, PROP), `zaokruhlenie`, `velicina` | facet: `xs:pattern`, `xs:enumeration`, bounds, `@dataType` |

Nie je to nové pole: trieda je **atribút na definícii poľa** (`x-assetin.trieda_obmedzenia: pritomnost | hodnota` v `assetin/schema/`), preto ju vidno v `docs/schema/*.json`, v `docs/POLIA.md` aj v `/api/schema` bez toho, aby ju niekto udržiaval druhýkrát. Validátor a generátor IDS tieto dve triedy rozlišovali od začiatku (cardinality vs. facet) — teraz to o nich vie aj schéma a UI ich môže zobraziť oddelene. Pole bez značky nie je obmedzenie: je to popis (`pokyn`, `zdovodnenie`), väzba (`dolozene_v`) alebo metadáta overenia (`overenie`, `postup`).

Odvodené (autor nepíše): `typ_poziadavky` (geometria = D2, alfanumerika = D1, dokumentacia = D3), `overenie` predvoľby zo zložky (§14b).
Export: 7817-3 `SpecificationPerObjectType`; IDS `specification` (`identifier` = id, `name` = nazov, `description` = zdovodnenie, `instructions` = pokyn, `minOccurs/maxOccurs` = pritomnost_v_modeli; applicability = objekt + `klasifikacia` bez `povinnost` + filter; requirements = položky s facetom + `klasifikacia` s `povinnost` [V25]); 29481-3 `subInformationUnit` pod kontajnerom.

---

## 5. IU-C — informačná jednotka: kontajner
**[V10] DiMS je databáza.** Informácie o objektoch, ktoré majú nositeľa v modeli (miestnosti, plochy, zariadenia), sa **nevedú v samostatnom dataset kontajneri** — ich tabuľková podoba je *generovaný pohľad* (export z modelu danej revízie), ktorý môže byť súčasťou dokumentu (protokol, výkaz) alebo výstupu §13. Potvrdenie tretej strany (geodet) je dokument nad exportom, nie druhá kópia dát: doklad = podpis pod exportom + kapitola odchýlok.
`druh: dataset` je vyhradený pre dáta **bez nositeľa v modeli** (merania v čase, senzorika, harmonogramy).
**[V13]** Model tretej strany je kontajner iba vtedy, keď nesie objekty, ktoré v cieľovom DiMS nemajú nositeľa (mračno bodov = merané body, nie miestnosti). Porovnanie survey DiMS vs. ARCH = pravidlo `rozsah: federacia`, `overenie: clash-detection`.
```yaml
typ: IU-C
druh: model                            # model | dokument | dataset
datovy_typ_29481: IFC File             # → informationUnit/dataType (voľný string)
mvd:                                   # [V26] → informationUnit/correspondingMvd ; iba druh: model (E9)
  basis: IFC4X3_ADD2                   # schéma, nad ktorou MVD stojí
  name: Reference View                 # pohľad; bez neho musí generátor IDS hádať, čo v súbore smie byť
forma:
  format: IFC                          # → 7817-3 Document/Format (pri dokumente)
  verzia_schemy: IFC4X3_ADD2
  nativny_format: RVT
  max_velkost_mb: 300
identifikacia:
  pravidlo: "[[STD-NAME-CONT]]"        # konvencia ID kontajnera (rozsah: kontajner)
  vzor: "^PRJ-ARCH-ZZ-XX-M3-A-[0-9]{4}$"
metadata_cde:
  status: S2                           # enum z STD-cde
  revizia_vzor: "^P[0-9]{2}$"
  klasifikacia_bezpecnosti: interna
georeferencovanie_prepis:              # iba ak sa súbor líši od STD-FED-01 (A4); inak dedí
  model_cs: {FirstCoordinate: , SecondCoordinate: , Height: , XAxisAbscissa: , XAxisOrdinate: }
tidp:                                  # 19650-2 5.4.4 (bez dátumov v knižnici)
  odhad_pracnosti_h:
dokument:                              # iba druh: dokument ; → 7817-3 Document @type/@form/@content
  type: Survey Report
  form: Digital
  content:
  struktura: [Identifikácia, Metóda, Výsledky, Odchýlky, Potvrdenie]   # kapitoly (napr. podľa vyhlášky 131/2024)
dataset:                               # iba druh: dataset (dáta bez nositeľa v modeli)
  kluc:
  struktura:
    - {stlpec: , typ: , jednotka: , vzor: }
  jeden_riadok:
pokyn: "názov podľa STD-NAME-CONT, export IFC4X3_ADD2, jeden súbor na profesiu a SO"
overenie: manual                       # kontajner: manual (predvoľba)
postup: "názov podľa vzoru, hlavička FILE_SCHEMA, veľkosť, IfcMapConversion vs. STD-FED-01"
automatizovatelne: true
zavaznost: musi
```
Telo:
```
## Ukotvenie (povinné, ≥1) — C3
viaze_sa_na:: [[IU-O-space]]          # IU-O/IU-C, uzol štruktúry [[STD-clenenie#IfcSystem-VZT]], alebo literál #aktivum / #proces (vedome)
## Obsah (M:N)
```yaml
obsahuje:                             # [V27] priradenie kontajner → objekt (M:N), YAML blok
  - iu: "[[IU-O-storey]]"             # bez `rozsah` = všetky aspekty, ktoré daná IU-O definuje
  - iu: "[[IU-O-space]]"
    rozsah: [geometria, alfanumerika] # zúženie na zložky LOIN (7817-1): geometria | alfanumerika | dokumentacia
  - iu: "[[IU-O-zone]]"
    rozsah: [alfanumerika]
```
## Roly
poskytovatel:: [[ACT-poverena/ARCH]]  # autoritatívny ; TIDP = IU-C where poskytovatel = tím
overuje:: [[ACT-poverujuca/spravca-informacii]]
## TIDP väzby
predchodca:: [[IU-C-mracno-bodov]]    # [V13] survey DiMS, nie tabuľka hodnôt
nadvaznost:: [[IU-C-vzt-model]]
## Väzby
nadradene_pri_rozpore:: [[IU-C-protokol-zamerania]]   # cieľ má prednosť (§0.3)
```
**[V27] Rozsah priradenia.** Kontajner a objekt sú *dve osi spojené priradením*, nie strom „kontajner nad objektom" (LOIN-05 §11.1; PAS 1958 6.3.2.1 a–b: výmena je kolekcia informačných jednotiek a rámec LOIN ich štruktúruje). Tá istá miestnosť je v IFC modeli (geometria + alfanumerika) aj v protokole zamerania (len dokumentácia) — bez `rozsah` by výkres vyzeral, že má splniť celý LOIN miestnosti.
- Predvoľba pri chýbajúcom `rozsah`: **všetky aspekty, ktoré daná IU-O definuje** (neprázdne `geometria` / `alfanumerika` / `dokumentacia`), s jednou výnimkou: **dokumentačný aspekt patrí tomu kontajneru, ktorý objekt menuje v `dokumentacia[].dok`**. Inak by model „niesol" protokol a dve tvrdenia by si protirečili (§0.9). Rozchod oboch strán hlási E10.
- Dôsledok pre generátor IDS: z kontajnera ide do IDS **len to, čo je v rozsahu** — dokumentačný kontajner negeneruje žiadnu požiadavku na geometriu ani na vlastnosti.
- `druh: dokument` smie priraďovať objekty **iba** s `rozsah: [dokumentacia]` (E3); `druh: model` typicky bez rozsahu.
- Aspekt, ktorý daná IU-O nedefinuje, je varovanie (E8): nie je to zúženie, ale prázdna požiadavka.
- `ER.obsahuje` po V27 nesie **len kontajnery**; objekt sa do výmeny dostane cez priradenie. IU-O menovaná priamo vo výmene, ktorú nenesie žiadny jej kontajner, je varovanie „objekt bez kontajnera" (C13).

Odvodené: `typ_poziadavky` = C (model/dataset) | E (dokument).
Export: 29481-3 `informationUnit` (+`subInformationUnit` = IU-O z `obsahuje[].iu`, zúžené o `rozsah`); `correspondingMvd` = `mvd`; 7817-3 `Document` (keď referencovaný z IU-O); MIDP/TIDP riadok = tento kontajner + dátum z PROJ.

---

## 6. STD — informačný štandard (priečinok + indexová poznámka `STD/STD.md`)
Súbory: `STD.md` (index, Dataview zoznam pravidiel), `STD-clenenie`, `STD-naming`, `STD-formaty` (vrátane jednotiek), `STD-cde` (statusy, revízie, bezpečnosť), `STD-federacia` (CRS, podlažia, zóny/systémy, zakázané entity per DiMS, clash tolerancie), `STD-geo-profily`, `STD-klasifikacia` (**všetky slovníky, §0.10**), `STD-fazy` (ISO 22263 ↔ SK stupne PD ↔ CZ 131/2024). Projekt: `projekty/<x>/STD-projekt.md` s `prepisuje:: [[STD]]`.

Každé **pravidlo** = jeden `##` nadpis s YAML blokom:
```yaml
id: STD-FED-01
nazov: Georeferencovanie DiMS
rozsah: kontajner                      # objekt | kontajner | federacia (federacia = LEN relačné cross-file)
plati: vzdy                            # vzdy | na_vyziadanie (ER zapína cez `zapnute::`)
ucel_federacie: true                   # zaradenie do kapitoly „federácia" v PDF, hoci sa overuje per súbor
overenie: IDS                          # IDS | manual | clash-detection (podľa §14b)
zavaznost: musi
zdroj_normy: ISO 19650-2 5.1.4 ; IFC4.3
hodnoty: {crs: "EPSG:5514", vyskovy: "EPSG:8357", E: , N: , H: , rotacia: }
zdroj_hodnot:                          # [V11] master DiMS namiesto ručného zoznamu; vylučuje sa s `hodnoty`
applicability:                         # → IDS applicability
  entity: IFCPROJECTEDCRS
requirements:                          # → IDS requirements [V16 čistý YAML]
  - facet: attribute
    nazov: Name
    hodnota: "EPSG:5514"
    cardinality: required
text: Všetky DiMS používajú S-JTSK (EPSG:5514) a Bpv; základný bod a rotácia podľa hodnôt.
pokyn: "nastaviť IfcMapConversion pri exporte"
postup: "ak checker nepodporuje IfcProjectedCRS, skontrolovať hlavičku ručne"   # fallback
```

**[V11] Zdieľané slovníky federácie majú master DiMS.** Zoznam podlaží s výškami, názvy zón a systémov majú nositeľa v modeli (`IfcBuildingStorey.Elevation`, `IfcZone.Name`) — STD ich preto **neudržiava ako zoznam**. Pravidlo s `ucel_federacie: true` nesie buď `hodnoty` (novostavba, kým master neexistuje), **alebo** `zdroj_hodnot:: [[IU-C-arch-model]]` — master, z ktorého generátor pri akceptácii vyrobí IDS pre ostatné DiMS. Pri pasportizácii je master vždy ARCH („priestory len v ARCH"). STD drží vzor pomenovania, nie zoznam.

**[V5] Dedičnosť a kardinalita v IDS.** `applicability.entity` môže byť abstraktná IFC entita (`IFCELEMENT`); generátor ju rozvinie na konkrétne podtypy podľa schémy IFC 4.3, lebo IDS 1.0 dedičnosť nepozná. „Práve jeden" / počet inštancií nie je v IDS vyjadriteľné → vždy `postup`.

Zakázané entity per DiMS: `pritomnost_v_modeli: prohibited` na applicability (`IFCBUILDINGELEMENTPROXY`; v ARCH `IFCDISTRIBUTIONELEMENT`).
Núdzový blok ` ```ids ``` ` so surovým `<ids:requirements>` — `vynimka: true`.
Export: **všetko s `overenie: IDS`** (rozsah objekt aj kontajner) → IDS špecifikácia (`identifier` = id); `federacia` nikdy; ostatné → checklist / kapitola „Informačný štandard" v PDF.

### 6a. GEO — geometrický profil (v `STD-geo-profily`)
**[V8] Profily:** `GEO-G0` bez geometrie (IfcBuildingStorey, IfcZone, IfcSystem, IfcGroup — objekty bez vlastného tvaru), `GEO-G1` schematická, `GEO-G2` koordinačná, `GEO-G3` detailná.
```yaml
id: GEO-G2
nazov: G2 – koordinačná geometria
aspekty: {ShapeAssembly: SingleObjectSingularShape, ShapeRepresentation: OuterShellAsSingularShape, ShapeInfluence: {InsideGeometry: NotRequired, Connections: NotRequired, Openings: OpeningsAsPartOfShape, OperatingAndClearanceZones: NotRequired, Features: NotRequired}, Dimensionality: 3D, Appearance: SingularMaterial, ParametricBehaviour: NotRequested, Location: {PositioningType: Absolute}}
dictionary:                            # → 7817-3 Detail/Dictionary (napr. BIMForum LOD), voliteľné
vhodne_pre: Priestorová koordinácia a výkaz výmer na úrovni DSP
```
~4 globálne profily; IU-O prepisuje aspekty; ak >⅓ IU-O prepisuje, profily prekrojiť.

---

## 7. PROP — vlastnosť (iba vlastné, mimo IFC)
v1 bez PROP registra: IFC 4.3 / bSDD *je* register — IU-O odkazuje `ifc: {pset, nazov, uri}`; appka číta typ, jednotku, definíciu a `ApplicableEntity` + `TemplateType` live, validuje voči `objekt.ifc_entita` s dedičnosťou (bSDD `parentClass`); prepis len s `vynimka: true`. Projektové jednotky určuje `STD-formaty`. PROP poznámka **iba pre vlastnú vlastnosť** — typicky hodnotu, ktorá vzniká zmluvne alebo výpočtom mimo IFC (napr. prenajímateľná plocha na zóne).
```yaml
typ: PROP
zdroj_importu: vlastny
aplikovatelne_na: [IfcZone]            # ako IfcPropertySetTemplate.ApplicableEntity
template_type: PSET_OCCURRENCEDRIVEN
definicia: …                           # → Definition
definicia_ref: "[[DEF-…]]"             # → ReferenceDocumentRef ; businessRule
odvodene_z: "[[DEF-plocha-cista]]"     # [V2] zmluvná/odvodená hodnota odkazuje na meranú
datovy_typ: number                     # → DataType (23387)
jednotka: https://qudt.org/vocab/unit/M2           # → UnitRef
velicina: https://qudt.org/vocab/quantitykind/Area # → QuantityKindRef
hodnoty: []                            # → PossibleValues ; IDS enum
uri: https://…/prop/…                  # → dt:about
ifc: {pset: Pset_Assetin_Zone, nazov: RentableArea}   # → IDS propertySet/baseName
```
Export: externá knižnica `dt:Property` (`referenceURI` + `GUID`).

## 8. DEF — definícia hodnoty / meracie pravidlo
**[V2]** DEF definuje **meranú** hodnotu (hrubá, čistá plocha). Zmluvné a odvodené hodnoty (prenajímateľná plocha) sú vlastná vlastnosť (**PROP**) na zóne v utilization UC, s `odvodene_z` na DEF — nie ďalšia DEF a nie IFC quantity.
```yaml
typ: DEF
definicia: Plocha ohraničená lícom vnútorných povrchov obvodových a deliacich konštrukcií…
referencny_dokument: STN EN 15221-6 / IPMS / zmluva čl. X     # → ReferenceDocumentRef ; businessRule/reference
hranica_merania: líc omietky
jednotka: m2
zaokruhlenie: 0.01
tolerancia: ±0.5 %
metoda_merania: laserové zameranie po dokončení, porovnanie s modelom   # ako hodnota vzniká (C7)
zodpovedny_za_meranie: "[[ACT-poverena/geodet]]"
```
Export: 7817-3 `Property.Definition` + `ReferenceDocumentRef`; 29481-3 `businessRule{proposition, reference}` (cez UC `pravidlo::`).

## 9. EV — udalosť (samostatná poznámka v `registre/EV/`)
```yaml
typ: EV
typ_udalosti: delivery                 # delivery | impact
planovana: true
relativny_termin:                      # "10 dní od EV-I-0007" (neplánovaný delivery)
objekt: "[[IU-O-zone]]"                # iba impact: predmet udalosti (IU-O alebo #aktivum) [V14]
faza_iso22263: [maintenance]           # impact = stav aktíva pri spúšťači, delivery = fáza výmeny (B1) [V1]
faza_lokalna: [prevádzka]
datum:                                 # IBA v projekte (PROJ.udalosti) → 7817-3 InformationDeliveryMilestone/@Date
```
Telo: `vyvolava:: [[EV-D-…]]` (iba impact; PAS tab. 2).
Kde sa odkazuje: impact → UC a PROJ; delivery → ER (IU dedí). Export: delivery → 7817-3 `InformationDeliveryMilestone`, IDS `info/milestone`, 29481-3 fáza → ER; impact mimo schém.

## 10. ACT — aktér (cesta strana/tím/funkcia)
Súbory: `registre/ACT/<strana>/<tim>/<funkcia>.md` (C1); ID = cesta; názov súboru = posledný segment, strana a tím ako folder-note (§0.4 [V7]).
**[V7] Tím je povinná úroveň pre `strana: poverena | veduca-poverena`** (kvôli TIDP). Poverujúca strana má funkcie priamo pod stranou (`ACT-poverujuca/koordinator-BIM`).
```yaml
typ: ACT
id: ACT-poverena/ARCH/koordinator-BIM
uroven: funkcia                        # strana | tim | funkcia
strana: poverena                       # poverujuca | veduca-poverena | poverena → 29481-3 classification ; 7817-3 @affiliation
klasifikacia_19650: funkcia managementu informácií
zmluvne_oznacenie:                     # IBA projekt (Objednávateľ, GZ, subdodávateľ)
osoby: []                              # IBA projekt → 7817-3 @firstName/@lastName/EMail
```
Os 2 (transakčná rola) nie je v ACT, ale na IU/ER: `poskytovatel`, `prijemca`, `overuje`. Koordinátor BIM a CDE administrátor = samostatné funkcie. Export: 29481-3 `actor`; 7817-3 `Actor{Role = tím/funkcia, @affiliation = strana}`.

## 11. PROT — BIM protokol (próza, zmluvný obal)
```yaml
typ: PROT
odkazuje_na: ["[[PROJ-…]]", "[[STD]]"]           # C6
funkcie: ["[[ACT-…]]"]
prednost_dokumentov: [PROT, EIR, STD, BEP]        # → STD pravidlo + nadradene_pri_rozpore
```
Telo: próza (typy A, B; `zavaznost: zmluvne`, bez `overenie`).

## 12. PROJ — projektová inštancia (= EIR)
```yaml
typ: PROJ
projekt: Administratívna budova X
spustacia_udalost: "[[EV-I-0007]]"     # impact event, ktorý projekt iniciuje — POVINNÉ (PAS 6.1.3; DIS 19650-1:2026)
aktivum: "[[aktiva/Budova-X]]"
ciele: ["[[GOAL-P-01]]"]               # projektové GOAL (C5)
poverenie: ARCH
strany:                                # mapovanie rolí na zmluvné strany (neprepisuje poskytovateľa na IU)
  "[[ACT-poverujuca]]": {zmluvne_oznacenie: Objednávateľ, organizacia: Správa budov a.s.}
  "[[ACT-poverena/ARCH]]": {zmluvne_oznacenie: Zhotoviteľ, organizacia: Ateliér X s.r.o.}
er: ["[[ER-0101]]", "[[ER-0201]]"]     # vybrané ER
udalosti:                              # dátumy k EV
  - {ev: "[[EV-D-0012]]", datum: 2027-03-31}
std_projekt: "[[STD-projekt-X]]"
vystupy:                               # generované, s verziou/hash
  - {typ: IDS, subor: vystupy/ids/ER-0101_ARCH.ids, hash: …}
  - {typ: PDF, subor: vystupy/EIR-ARCH.pdf, hash: …}
```
Generuje: `Specification` per (ER × udalosť × poskytovateľ), IDS per Specification, PDF, MIDP/TIDP, RACI, checklist.

## 12a. Terminologické aliasy 2018 ↔ DIS 2026 (export/PDF prepínač; interné názvy sa nemenia)
| 19650:2018 (interné) | ISO/DIS 19650-1/-2:2026 |
|---|---|
| EIR | Information Production Requirements |
| BEP | Information Production Plan |
| MIDP + TIDP | Information Production Schedule (IPS) |
| OIR / AIR / PIR (dokumenty) | perspektívy stakeholderov → jedna organizačná sada → filter projekt/poverenie |
| dodacia / prevádzková fáza | zrušené; trigger event ako pivot |
| PIM → AIM | AIM trvalý; PIM bez samostatného miesta |
DIS: pripomienkovanie od 10. 3. 2026, publikácia ~2027; overiť v texte (ÚNMS/ÚNMZ).

---

## 13. Generované výstupy (nie entity)
| Výstup | Zdroje | Granularita |
|---|---|---|
| 7817-3 `Specification` | ER × PROJ (udalosť, príjemca) × poskytovateľ z IU | 1 per (ER × poskytovateľ) |
| IDS súbor | `ids:info` ← ER + PROJ; špecifikácie ← STD (`plati: vzdy` + `zapnute`, `overenie: IDS`) + IU-O daného ER s prepismi | 1 per Specification |
| PDF do zmluvy | všetko (A–I); kapitoly: ciele (GOAL), účely (UC), štandard (STD vrátane `ucel_federacie`), LOIN tabuľky, udalosti, akceptácia | per poverenie |
| MIDP / TIDP | IU-C z ER + PROJ dátumy; TIDP = filter `poskytovatel` = tím | |
| RACI | IU × ACT (poskytovatel / prijemca / overuje) | |
| Checklist akceptácie | `overenie: manual` (+ `postup`) a `clash-detection`; kritérium 19650-4 podľa typu | per udalosť |
| **Tabuľka objektov** (room schedule, výkaz) **[V10]** | IU-O daného ER × model danej revízie | per kontajner × revízia |
| Register kontajnerov | IU-C ∪ dokumenty z IU-O.dokumentacia; hierarchia z STD-federacia / vyhlášky; odkaz do CDE **[V12]** | |
| História udalostí aktíva | EV × AIM/CAFM záznamy **[V12]** | |
| UC „Fázy → ER" | ER.spustacia_udalost.faza | |

## 14. Enumy
- `stav`: NP, WD, PUB, WDRL · `typ_ulohy`: delivery, utilization, oboje · `zrelost`: Outlook, Example, Proven
- `uroven` (GOAL): organizacia, aktivum, projekt · `zdroj_ir`: OIR, AIR, PIR
- `faza_iso22263`: inception, brief, design, production, **maintenance**, demolition — „prevádzka" = `maintenance` **[V1]**
- `typ_udalosti`: delivery, impact
- `uroven` (IU-O): typ, vyskyt · `rola`: identifikacia, obsah · `povaha`: informacny, technicky
- `pritomnost_v_modeli` / `povinnost` (IDS cardinality): required, optional, prohibited
- `uroven` (ACT): strana, tim, funkcia · `strana`: poverujuca, veduca-poverena, poverena
- `rozsah`: objekt, kontajner, federacia · `plati`: vzdy, na_vyziadanie
- `overenie`: IDS, manual, clash-detection (obmedzené zložkou — §14b)
- `zavaznost`: zmluvne, musi, ma, informativne
- `typ_poziadavky` (odvodené): A, B, C, D1, D2, D3, E, F, G, H, I
- `druh` (IU-C): model, dokument, dataset · `datovy_typ` (23387, **len na `PROP`**): string, number, integer, boolean, date, enum, uri
- **[V27]** `rozsah` v `IU-C.obsahuje[]` (zložky LOIN podľa 7817-1): geometria, alfanumerika, dokumentacia
- **[V24]** `datovy_typ` na položke `alfanumerika[]` je iný slovník: meno IFC jednoduchého typu VEĽKÝMI (`IFCAREAMEASURE`, `IFCLENGTHMEASURE`, `IFCBOOLEAN`, `IFCLABEL`…), presne ako ho žiada IDS 1.0 `@dataType`. Uvádza sa len pri `ifc: {pset, nazov}` a pri `prop:`; pri `ifc: {atribut}` a `ifc: {material}` IDS `dataType` nemá (D20). Nositeľom pravdy ostáva IFC 4.3 ADD2 — v súbore je kópia, aby ju generátor nemusel hádať (rovnaká výnimka ako `uri`).
- geometria (7817-3 doslovne): `ShapeAssembly` NotRequired|SingleObjectSingularShape|SingleObjectMultipleShapes|MultipleObjects · `ShapeRepresentation` NotRequired|SingleBoundingPrimitive|OuterShellAsSingularShape|OuterShellAsSeparateShapes · `ShapeInfluence.*` NotRequired|No…|…AsPartOfShape|SeparateShapes · `Dimensionality` NotRequired|0D|1D|2D|3D · `Appearance` NotRequired|NoAppearanceInformation|SymbolicByMapping|SingularMaterial|MultipleMaterials|ConceptualAppearance|RealisticAppearance · `ParametricBehaviour` NotRequested|Requested · `PositioningType` Absolute|Relative|NotDefined · `crs.typ` NotRequired|ProjectedCRS|EngineeringCRS|GeographicCRS
- IDS `facet`: entity, attribute, classification, property, material, partOf · `relation`: IFCRELAGGREGATES, IFCRELASSIGNSTOGROUP, IFCRELCONTAINEDINSPATIALSTRUCTURE, IFCRELNESTS, IFCRELVOIDSELEMENT, IFCRELFILLSELEMENT
- väzby **[V4]**: `odvodene_z`, `nadradene_pri_rozpore`, `doplnuje`, `dokladuje`, `dolozene_v`

### 14b. `overenie` podľa zložky (predvoľba tučne)
| Zložka | Prípustné |
|---|---|
| IU-O alfanumerika, klasifikácia, členenie, materiál | **IDS**, manual |
| STD rozsah objekt / kontajner (štruktúra, zákazy, naming, CRS, podlažia, jednotky) | **IDS**, manual |
| IU-O geometria | **manual**, clash-detection |
| IU-O dokumentácia | **manual** |
| IU-C (formát, názov, veľkosť, metadáta) | **manual** |
| STD rozsah federacia (relačné cross-file) | **manual**, clash-detection |
| PROT (A, B) | žiadne (`zavaznost: zmluvne`) |

## 15. Priečinková štruktúra balíka
```
zadanie/                         # organizácia (knižnica)
├── GOAL/  UC/  ER/  IU-O/  IU-C/
├── STD/   STD.md (index) + STD-*.md
├── registre/  DEF/  EV/  ACT/<strana>/[<tim>/]<funkcia>.md  (PROP/ len vlastné)
└── PROT/
aktiva/<budova>/                 # aktívum: GOAL (aktivum), STD-aktivum prepisy, zdroj_hodnot masterov,
                                 #   ukazovatele cde: {system, projekt_id} a aim: {system, id}   [V12]
projekty/<zakazka>/              # projekt: PROJ, GOAL (projekt), STD-projekt, EV s dátumami, osoby
vystupy/<zakazka>/  ids/  pdf/  midp/  raci/  checklist/
```
**[V12]** Vrstva aktívum **nie je tieňová databáza CDE/CAFM**: register skutočných kontajnerov a história udalostí sú generované pohľady (§13) s odkazom do CDE/AIM, nie udržiavané zoznamy.

## 16. Validačné pravidlá (appka)
1. `EV.faza_iso22263 ⊆ UC.faza_iso22263` pre každý ER (cez `ER.uc` a `ER.spustacia_udalost`).
2. `overenie` len z §14b pre danú zložku; `IDS` nikde mimo alfanumeriky/klasifikácie/členenia/materiálu a STD objekt/kontajner.
3. Požiadavka bez `overenie` ⇒ `zavaznost ∈ {zmluvne, informativne}`.
4. `IU-C.viaze_sa_na` ≥ 1; literály `#aktivum`/`#proces` len s poznámkou.
5. `ER.spustacia_udalost` len `typ_udalosti: delivery`; `UC/PROJ.spustacia_udalost` len `impact`.
6. **[V19]** V `zadanie/` sú zakázané `GOAL.termin`, `GOAL.aktivum`, `ACT.osoby`, `ACT.zmluvne_oznacenie`, `EV.datum` a typ `PROJ` — sú to dosadenia, nie definície. `GOAL.uroven` vrstvu neurčuje. Cieľ, na ktorý neukazuje žiadny `podporuje_ciel` ani `prispieva_k`, je **varovanie** (F14): knižnica je katalóg, nie zoznam úloh.
7. IFC vlastnosť v IU-O: entita ∈ `ApplicableEntity` (s dedičnosťou) alebo `vynimka: true`; `template_type` vs. `uroven` = varovanie.
8. `IU-O.dokumentacia[].dok` musí byť IU-C (A5).
9. Prednosť prepisov PROJ > ER > IU > STD; ER prepisuje len `povinnost | hodnoty | rozsah | profil | zavaznost`.
10. `ER` má práve jeden `uc`; IU-O `poskytovatel` chýba ⇒ `ER.poskytovatel_predvoleny`; IDS/Specification sa generuje per poskytovateľ.
11. STD `rozsah: federacia` iba pre relačné pravidlá; pravidlo s fixnou hodnotou ⇒ `kontajner`.
12. `pouzitie` = sloveso + podstatné meno; `nazov_en` neprázdny.
13. **[V5]** Abstraktná entita v `applicability` ⇒ generátor rozvíja na podtypy; varovanie ak rozvinutie > 50 entít.
14. **[V11]** `hodnoty` a `zdroj_hodnot` sa na jednom pravidle vylučujú; `zdroj_hodnot` musí byť IU-C `druh: model`.
15. **[V14]** `hodnoty` a `hodnoty_ref` sa na jednej položke vylučujú; cieľ `hodnoty_ref` musí existovať a byť nadpis v `STD-klasifikacia`.
16. **[V10]** IU-C `druh: dataset` ⇒ žiadny stĺpec `dataset.struktura` nesmie mať nositeľa v IU-O uvedenom v `obsahuje[].iu` (inak je to duplikát modelu → chyba).
17. **[V7]** `ACT.uroven: funkcia` so `strana: poverena | veduca-poverena` musí mať v ceste tím; pri `poverujuca` je tím voliteľný.
18. **[V16]** Vnorené štruktúry (`filter`, `requirements`, ER `prepisy`) sa píšu ako YAML zoznam objektov; oddeľovač `·` v štruktúrovanom zápise je chyba (v prozaických hodnotách a v texte schémy je prípustný).
19. **[V17]** `ulohy[].id` unikátne v UC; `ulohy[].aktor` ∈ `aktor::`; kotva `#Tn` existuje ako `ulohy[].id`.
20. **[V18]** `id` == ID z cesty (PathScheme); `aliases` obsahuje `id` (varovanie, writer doplní); `KNIZNICA.md/schema_verzia` == verzia enginu.
21. **[V26][V27]** `mvd` iba na `druh: model` (E9); `obsahuje[].rozsah` len z aspektov, ktoré IU-O definuje (E8); dokument priraďuje len `rozsah: [dokumentacia]` (E3); IU-O vo `ER.obsahuje` bez kontajnera = varovanie (C13); `IU-O.dokumentacia[].dok` a priradenie kontajnera sú dve strany tej istej väzby (E10).
22. Frontmatter a YAML bloky sú platný YAML (A1) — v dvojito citovanej hodnote sa `"` escapuje alebo sa použijú jednoduché úvodzovky (migrácia v1.3 opravila `postup` v STD-CL-02 a STD-CL-04).

## 17. Terminológia: kód · UI · export

Tá istá vec má tri mená a všetky tri sú záväzné. V kóde a v cestách žije **kód typu**, v editore **popisok** a v dokumente do zmluvy **normatívny názov**. Mapovanie je jediné a strojové — `POPISOK` a `POPISOK_EXPORT` na modeli typu (`assetin/schema/typy/*.py`), čítateľné cez `assetin schema export`; appka ani generátor si vlastný zoznam nedržia.

| Kód a cesty | UI (ľavý panel) | Export do zmluvy |
|---|---|---|
| `GOAL` | Ciele | Ciele |
| `UC` | Účely užitia | Účely užitia |
| `EV` | Spúšťacie udalosti | Udalosti |
| `ER` | Výmeny | Požiadavky na výmenu |
| `IU-O` | Objekty | LOIN — typy objektov |
| `IU-C` | Kontajnery | LOIN — kontajnery |
| `STD`, `GEO` | Pravidlá a konvencie | **Informačný štandard** (19650-2 5.1.4) |
| `DEF` | Definície | Definície a meracie pravidlá |
| `ACT` | Aktéri | Aktéri |
| `PROP` | Vlastnosti | Vlastnosti |
| `PROT` | Protokoly | BIM protokol |
| `PROJ` | Projektové inštancie | EIR |

## 18. Pásma noriem [V20]

Každý typ poznámky deklaruje, na ktorú **otázku** odpovedá; z toho vzniká zoskupenie v editore aj poradie kapitol v exporte. Deklarácia je na type (`RAMEC`, `PRIEREZOVE`, `HRANICNE`, `HRANICNE_AK`), tabuľka pásiem v `assetin/schema/pasma.py`.

| Pásmo | Otázka | Norma | Typy |
|---|---|---|---|
| 1 | Prečo? | 19650-1 | `GOAL` |
| 2 | Kto a kedy? | 29481 | `UC`, `EV`, `ER` |
| 3 | Čo a ako podrobne? | 7817 | `IU-O`, `IU-C` |
| 4 | Pre koho a dokedy? | 19650-2 (EIR) | `PROJ`, `PROT` — v knižnici prázdne, dopĺňa poverenie |

- **Prierezové** (`STD`, `GEO`, `PROP`, `DEF`, `ACT`): nezaraďujú sa do postupnosti a **nečíslujú sa** — dopadajú na každé pásmo. Štandard a aktéri nie sú kroky reťazca; v editore ich nesie inšpektor a vlastný register, nie pásmo.
- **Hraničné**: `IU-C` sedí na šve `[29481, 7817]` (kontajner je aj informačná jednotka výmeny, aj nositeľ LOIN); `EV` na šve `[29481, 19650-2-eir]`, ale **iba ako `typ_udalosti: delivery`** — impact udalosť je stav aktíva, nie míľnik dodania.
- Pásmo nie je krok kaskády. Osem očíslovaných sekcií, ktoré mal prvý náhľad editora, v schéme nikdy nebolo.

## 19. Jedna poznámka žije na jednom mieste [V21]

Poznámka sa plne zobrazuje a edituje **iba vo svojom registri**. Všade inde je čip: ID, názov, náhľad po najazdení, klik naviguje. Žiadne rozbaľovanie obsahu cudzej poznámky na mieste — je to UI dôsledok §0.9 (jeden nositeľ informácie): `IU-O-space` patrí registru objektov, nie výmene, v ktorej sa práve zobrazuje, lebo tá istá jednotka bude aj v `ER-0201`.

## 20. Odvodené údaje [V22]

Engine musí pre ľubovoľnú položku alebo poznámku vypočítať tri veci (`assetin/engine/inspektor.py`):

1. **Pôvod hodnoty** — `vlastné` · `zdedené z <GEO-profil>` · `prepis <ER-id>` (aj s pôvodnou hodnotou) · `predvoľba §14b` · `pravidlo <STD-id>` · `definícia <DEF-id>` · `slovník <STD-klasifikacia#kotva>`.
2. **Dopadajúce pravidlá** s dôvodom: `vždy` · `zapnuté v <ER-id>` · `z položky <názov>`. `plati` a `zapnute::` rozhodujú, či pravidlo vo výmene *žije*; `applicability` rozhoduje, na *ktorý objekt* padne — preto `STD-CL-04` vidí `IU-O-space` a nie `IU-O-zone`.
3. **Dopad zmeny** — poznámky a výmeny, ktorých sa zmena dotkne; tranzitívne spätné odkazy cez `zapnute`, `pravidlo`, `hodnoty_ref`, `definicia_ref` a `obsahuje`. Toto je jediná vec, ktorú Obsidian nevie, a preto má prednosť.
