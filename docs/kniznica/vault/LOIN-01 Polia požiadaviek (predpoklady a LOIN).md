---
name: LOIN-01 Polia požiadaviek
description: Predpoklady LOIN (účel, udalosť, aktéri, objekt) a informačná špecifikácia — sekcie 1–6 návrhu
status: v1.1 (2026-09-09)
cast_serie: "[[LOIN-00 Index]]"
origin: ai
verified:
---


# Štruktúra prepojených požiadaviek (LOIN) — návrh pre MD editor

Cieľ: stanoviť polia a väzby pre dve vrstvy poznámok otvárateľných v Obsidiane:
- **vrstva A** — objektová/prvková informačná jednotka (LOIN podľa ISO 7817-1 v plnom rozsahu),
- **vrstva B** — kontajnerová informačná jednotka (ISO 19650-1 10.4/11.2, CEN/TR 18093, PAS 1958 MIDP bez dátumov).

Spoločný atóm oboch vrstiev = **information unit** (ISO 29481-1:2025, 3.3.11; PAS 1958, 3.1.4.13): *„anything from entire information containers … to specific properties of objects"*. LOIN je spôsob, ako jednotku popísať (PAS 1958, 6.3.2 c).

Postup: polia prechádzame po jednom; každé pole má sekciu *Zdroje → Čo z toho vyplýva → Rozhodnutie → Otvorené otázky*.

---

## 1. Účel (why) — use case

### 1.1 Zdroje

**ISO 7817-1, 5.2**
- Účel je *predpoklad* LOIN; **LOIN sám účel neurčuje** (5.1: „ovlivněna … ale nejsou její součástí").
- Jedna LOIN môže slúžiť viacerým účelom v tom istom milníku (5.2 príklad 2).
- Účely môžu byť *nezveřejněné* (bezpečnostné dôvody) — oznamované len oprávneným aktérom.
- Účely sa odvodzujú z OIR / PIR / AIR (5.2 poznámka).

**ISO 19650-1, 5.1**
- Katalóg typických účelov pověřující strany: registr aktiv, soulad s předpisy, management rizik, obchodní otázky (kapacita, zabezpečení, renovace, dopady, provoz, údržba, výměny, uvádění mimo provoz).
- 3.3.2: požadavek na informace = *co, kdy, jak, pro koho*.

**ISO 29481-1:2025 (IDM)**
- 3.3.2 **use case** = popis business kontextu sledom akcií rolí *k naplneniu účelu*; use case vymedzuje **rozsah** kontextu.
- 3.3.3 **business context** = prostredie (role, aktivity, interakcie, produkty), v ktorom aktéri vykonávajú procesy.
- 3.3.10 **exchange requirement (ER)** = definovaná množina information units potrebná na naplnenie use case.
- Úvod: **jeden EIR (19650) ↔ viac ER (IDM)**; ER je generický (typy rolí), EIR je viazaný na konkrétne pověření.
- 3.3.9 poznámka: „ako" informácie vzniknú *nie je* súčasť požiadavky — je to LOIN.
- 5.2 spoločné metadáta každého IDM komponentu: plný názov, krátky názov, **GUID**, autori, **change log**.
- 5.3.1 use case musí uviesť: **aim, scope, uses, regional context, project phases**.
- 5.3.2–5.3.3: štandardné fázy podľa **ISO 22263** + povinné mapovanie na lokálne fázy (1:1, 1:n, n:1).
- A.2.2: use case môže mať **sub-use cases**; A.2.4: ER sa dajú skladať / rozkladať.
- 5.5.1: ER môže mať **preconditions** (iný ER, ktorý musí byť splnený skôr).

**PAS 1958:2026**
- 6.2.1: **purpose = use case + business context** (prevzaté z 29481-1).
- Dva druhy úloh: **utilization task** (informáciu *použije*: cost forecasting, energy prediction, insuring…) vs **delivery task** (informáciu *vyrobí*: surveying, servicing, drafting…). Tá istá úloha môže byť podľa kontextu jedno aj druhé.
- 6.1.3 / obr. 15, 23, 24: reťazec **impact event → use case(s) → business context → information specification**; use case je jeden zo štyroch filtrov (purpose, object, milestone, actor), ktorými sa organizačná špecifikácia zúži na projektovú.
- 6.2.2.1: use case definovať dôsledne; **nepoužívať „5D/6D" ako názov use case**; hodnota štandardnej knižnice use cases („off-the-shelf starting point").
- Zdroje príkladov: ISO 12911, ISO 19650-3 príloha A.2 (prvá polovica zoznamu), 19650-1 (tam nazvané „purposes"), bSI Use Case Management Tool, OSCRE.
- 6.2.3.1: business context rozkladá úlohy na **aktivity a rozhodnutia** → výstup je *„purpose at a task, decision or activity level"* → účel má teda **dve granularity**: use case (hrubý, znovupoužiteľný) a úloha/rozhodnutie (jemný, viazaný na process map).
- Obr. 19: informačná jednotka má existovať **raz** a byť asociovaná k viacerým účelom.

**ISO 21597 (ICDD)** — *nie je* zdroj pre účel; rieši balenie kontajnerov a linksety. Relevantné až pre väzby (`X_`) a vrstvu B. (Pôvodne uvedené omylom namiesto ISO 29481.)

### 1.2 Čo z toho vyplýva

1. **„Why" nie je textové pole na LOIN riadku, ale odkaz do registra use cases.** Riadok (information unit) odkazuje na ≥1 use case; use case sa nedupikuje do riadku. (7817-1 5.2, PAS obr. 19, 29481-1 vzťah EIR↔ER.)
2. **Use case je samostatná poznámka** s vlastnými metadátami (29481-1 5.2/5.3), nie položka v zozname.
3. **Dve úrovne účelu:** `use_case` (povinné) + voliteľne `úloha/rozhodnutie` (aktivita z process mapy), keď treba presnosť. Bez business context mapy stačí use case + typ úlohy.
4. **Typ úlohy** (utilization / delivery) je vlastnosť use case, nie LOIN riadku — rozhoduje, či jednotka je vstup (utilization) alebo výstup (delivery) úlohy.
5. **Impact event nie je účel**, je spúšťač, ktorý use case aktivuje (→ pole *kdy*, kontext).
6. **ER = zoskupenie LOIN riadkov pre jeden use case.** V editore je to *pohľad* (filter riadkov podľa use case), nie ďalšia entita — kým nepotrebujeme preconditions alebo skladanie ER.
7. **EIR = ER filtrovaný na pověření** (aktér + milník). Vrstva B je teda pohľad + kontajnerové polia, nie kópia. Pozor: PAS 6.3.6 odporúča projektovú špecifikáciu **duplikovať**, aby žila nezávisle od organizačnej — riešiť verziou/snapshotom, nie ručnou kópiou.
8. Mimo rozsahu účelu: *ako* (LOIN), validácia voči stavebným predpisom (7817-2 mimo scope).

### 1.3 Rozhodnutie — štruktúra poznámky `use case`

```
---
id: UC-0003                      # stabilné ID (29481-1 5.2: GUID / short title)
nazov: Plánovanie údržby TZB     # plný názov
kratky_nazov: údržba-TZB
typ_ulohy: utilization | delivery | oboje     # PAS 1958 6.2.1
cil: …                           # aim (29481-1 5.3.1)
rozsah: …                        # scope
pouzitia: […]                    # uses
regionalny_kontext: SK | CZ | SK+CZ
faza_iso22263: [operation, maintenance]        # štandardné fázy
faza_lokalna: [prevádzka]        # mapovanie na SK/CZ stupne
odvodene_z: ["[[OIR-…]]", "[[AIR-…]]"]         # 7817-1 5.2 pozn.
zverejnenie: verejny | nezverejneny            # 7817-1 5.2
nadradeny_uc: "[[UC-0001]]"      # sub-use case (29481-1 A.2.2)
zdroj_vzoru: 19650-3 A.2 / bSI UCM / vlastný
autor, zmeny: …                  # change log (29481-1 5.2)
---
## Popis (aim, scope, uses)
## Business context
- process map:: [[PM-…]]         # voliteľné, BPMN (29481-1 4.5.2)
- interaction map:: [[IM-…]]     # voliteľné (29481-1 4.5.3)
- úlohy / rozhodnutia: zoznam s ID (PAS 6.2.3.1)
## Exchange requirement
- vygenerované dotazom: všetky riadky A/B, kde ucel:: [[UC-0003]]
- preconditions:: [[UC-…]]       # 29481-1 5.5.1
```

**Na LOIN riadku (vrstva A aj B):**
```
- ucel:: [[UC-0003]], [[UC-0007]]         # ≥1, povinné
- uloha:: [[UC-0003#T2 Naplánovať revíziu]]  # voliteľné, jemná granularita
```

### 1.3a Doplnenie — vzťah LOIN „why" ↔ IDM (potvrdené)

- 7817-1 príloha A: LOIN sa dá použiť na popis **ER medzi viacerými stranami podľa ISO 29481-1** aj **EIR medzi dvoma stranami podľa 19650-1**.
- 29481-1 úvod: LOIN je *„a more comprehensive way of defining information units that form part of an exchange requirement"*.
- Reťazec: **IDM (use case + business context) → ER (množina information units) → LOIN popisuje každú jednotku → EIR = ER filtrovaný na pověření.**
- **29481-3** (idmXML) dáva strojový tvar use case: `specId` (guid, idmCode, fullTitle, shortTitle), `authoring` (author, changeLog), `subUc`, `summary`, `aimAndScope`, `language`, `use` (1..*), `standardProjectPhase` (1..*, ISO 22263). → použiť ako názvy polí vo frontmatter, aby bol export do idmXML priamy.
- **bSI Use Case Management** (ucm.buildingsmart.org) — živá knižnica; štruktúra publikovaného use case: GUID, Identifier, Life Cycle Stage (ISO 22263 alebo národné: ÖNORM, HOAI, SIA 112), Revision, Project Status, **Maturity (Outlook / Example / Proven)**, Publisher, Authors; sekcie *Management Summary, Purpose and Scope, Description, Life Cycle Stages, BIM Objectives & Benefits, **Delimitation** (čo use case nie je), **Prerequisite / Framework Conditions** (normy, predpisy), Abbreviations, Exchange Requirements, Files*.
- Relevantné publikované use cases (bS Austria, 2022): *Ausschreibung FM* (automatická tvorba Flächen-/Anlagenlisten — Proven), *Veränderungsmanagement* (dokumentácia Ist-Zustand = pasportizácia — Outlook), *Raummanagement und Anlagenmanagement* (Proven), *Routinemässige Reinigung* (bS CH, plošne riadený utilization), *Kostenermittlung eBKP-H*, bS DE *Mengen- und Kostenermittlung* (IDM+MVD).
- Historická bSI IDM knižnica (~100–200 IDM vo Word/PDF) — literatúra ju hodnotí ako prakticky nepoužiteľnú (príliš ťažké, nezdieľateľné) → potvrdzuje prístup PAS 1958: databáza informačných jednotiek + filtre, nie dokumenty. Návrh "IDM packages" cez WBS (Lee et al.) = to isté, čo náš sub-use case rozpad.

**Doplniť do šablóny use case:** `vymedzenie_negativne` (Delimitation), `ramcove_podmienky` (normy/predpisy — už máme `odvodene_z`, toto je širšie), `zrelost` (Outlook/Example/Proven), `jazyk`.

### 1.3b Doplnenie — vzorový IDM z prílohy B ISO 29481-1:2025 (idm_DesignAuthoring, v0.2, ISO/TC 59/SC 13)

Balík: `idm_DesignAuthoring.xml` (idmXML podľa 29481-3), `.docx` (ľudsky čitateľná verzia), `.html` + XSLT, BPMN `Diagram(2).bpmn` + PNG, interaction map + transaction map PNG.

**Strom idmXML (skutočná štruktúra):**
```
idm
├─ specId (guid, shortTitle, fullTitle, subTitle, idmCode, localCode, documentStatus, version)
├─ authoring (changeLog[], author[], committee, publisher)
├─ uc
│   ├─ specId, authoring
│   ├─ summary, aimAndScope, language
│   ├─ use (name + classification: "BIM Project Execution Planning Guide 2.2")
│   ├─ standardProjectPhase[] (name, outcomes, informationRequirements → associatedEr GUID)
│   ├─ localProjectPhase[] (…, classification: AIA / RIBA)
│   ├─ actor[] (id, name, classification)
│   ├─ benefits, requiredResources, requiredCompetencies
│   └─ reference (basisStandard, fullCitation)
├─ businessContextMap
│   ├─ pm: diagram (BPMN súbor) + dataObjectAndEr[] (BPMN data object ↔ ER GUID)
│   └─ im: diagram (interaction + transaction map)
└─ er (specId, authoring, description, correspondingMvd)
    └─ subEr[] → er
        ├─ informationUnit[] (id, name, dataType, isMandatory, definition, examples,
        │     subInformationUnit[] → vnorené jednotky, correspondingExternalElement(basis,name))
        └─ constraint[] (associatedInformationUnit, associatedBusinessRule, description)
```

**Čo z toho vyplýva pre náš editor:**

1. **Väzba fáza ↔ ER žije na use case**, nie na riadku: `standardProjectPhase.informationRequirements.associatedEr`. Vzor má 2 ER (Brief pre Inception/Brief; DesignAuthoring pre Design/Production) a každá štandardná aj lokálna fáza ukazuje na jeden z nich. → pole *kdy* na riadku je odvodené z toho, ku ktorému ER riadok patrí; **ER je entita** (s GUID), nie len pohľad — koriguje záver 1.2 bod 6. Riešenie: ER = poznámka s vlastným ID (`ER-…`), riadky sa naň odkazujú (`er:: [[ER-…]]`), a use case mapuje fázy → ER.
2. **Informačné jednotky v ER sú vo vzore prevažne kontajnery** (Cover Letter, Drawings, Specifications, *BIM Models → IFC Models / Native Models*, Calculations, Cost Estimates) s vnorením cez `subInformationUnit`. → **Vrstva B = ER tabuľka**; vrstva A (objektový LOIN) visí *pod* jednotkou typu kontajner (napr. pod "IFC Models"). Potvrdzuje dvojvrstvový model a PAS pozn. 2 k information unit.
3. **`dataType` je voľný text** ("Document", "IFC File", "Drawing Set", "Physical or Digital Samples") — slabé. My: `typ_jednotky` (objekt | kontajner | dokument) + LOIN komponenty namiesto voľného typu.
4. **Constraints sú voľný text na jednotku** ("Version must be specified", "signed by responsible party") — pre strojovú kontrolu nepoužiteľné. My: štruktúrované podľa PAS 6.3.3 (a) prítomnosť = `isMandatory`, (b) hodnota/pravidlo = `constraint` s typom + odkazom na definíciu (`DEF-`), + `overenie` (IDS / metadata / manuál). Poznámka: `associatedBusinessRule` je pripravený hák na pravidlo — použiť ako odkaz na `DEF-`/normu.
5. **`correspondingExternalElement (basis, name)`** = hák na schému (IFC entita/pset, bSDD) → u nás priamo odkaz na IDS špecifikáciu / IFC entitu v riadku vrstvy A.
6. **BPMN data object ↔ ER cez `dataObjectAndEr`**: process map má tri lane (Client / *Exchange Requirements* / Architect) a ER sú data objects v strednej lane. → ak budeme mať process mapy, každý data object má ID, ktoré = ER-ID. Bez BPMN stačí zoznam úloh s ID (rozhodnutie z 1.4 zostáva).
7. **Konvencia `idmCode`**: `uc-<UseCase>-<region IC>-<phase PD>-<?>-<lang EN>-<author>-<YYYYMMDD>-<shortTitle>-<status NP>` — typ-prefix + krátky názov + status. Prevziať zjednodušene: `UC-0101` + `documentStatus` (NP/WD/…/PUB) + `version`.
8. **Authoring sa vo vzore duplikuje na každom komponente** (autori, komisia, changelog ×5). V MD: dediť z nadradenej poznámky, changelog = git história + `version` vo frontmatter; nekopírovať.
9. **Use case má `actor[]` s classification** (vo vzore "No classification") → my klasifikovať roly podľa ISO 19650-1 kap. 7 / 19650-4 (provider/receiver/reviewer) — pripravené na pole *kdo*.
10. **`use` má classification** (taxonómia BIM uses) → náš `zdroj_vzoru` / knižnica use cases (19650-3 A.2, bSI UCM, vlastný katalóg).
11. Ľudsky čitateľná forma (docx): UC tabuľka pole/hodnota, tabuľka mapovania fáz (ISO 22263 ↔ AIA ↔ RIBA), ER tabuľka *Name | Data Type | Mandatory | Definition | Constraint* s vnorením odsadením. → Dataview tabuľka nad riadkami dá to isté.

**Zmena rozhodnutí:** ER je samostatná poznámka (nie iba pohľad); vrstva B = ER; fáza/milník → ER sa mapuje na use case. Doplniť do šablóny use case: `pouzitia` → `use` s klasifikáciou, `aktori` (id, rola, klasifikácia), `prinosy`, `zdroje_a_kompetencie`, `documentStatus`, `version`; mapovanie `faza_iso22263 → [[ER-…]]`.

### 1.4 Otvorené otázky
- [ ] Knižnica use cases: začať zo zoznamu 19650-3 príloha A.2 + 19650-1 5.1, alebo z katalógu služieb Assetin (pasportizácia, FM)?
- [ ] Business context mapy (BPMN / interaction map) v v1, alebo len textový zoznam úloh a rozhodnutí?
- [ ] Lokálne fázy: SK (stupne PD podľa stavebného zákona 25/2025) a CZ (výkonové fáze) — jedna mapovacia tabuľka na ISO 22263 v samostatnej poznámke?
- [ ] Preconditions medzi use cases — potrebujeme v v1?

---

## 2. Spúšťacia udalosť / milník (when)

### 2.1 Zdroje
- 7817-1, 5.3: predpoklad *kdy* = milník pro předání informací; ten istý objekt môže mať v rôznych milníkoch rôzny LOIN.
- 19650-1: milník = *plánovaná událost pro předem stanovenou výměnu informací*; 19650-2, 5.1.2–5.1.3: míľniky odvodené z bodov klíčových rozhodnutí a plánu prací.
- 19650-3: v prevádzkovej fáze je *kdy* = **trigger event** (AIR viazané na trigger events; príl. A.3 príklady).
- PAS 1958, 6.1.3: trigger event = **impact event** (iniciuje projekt, mimo IDM, iniciuje use case; definuje filter *objekt*) + **delivery event** (iniciuje delivery tasks; zoskupené do work stages). Tab. 2: väzba impact → delivery je organizačná (risk mgmt).
- 29481-3: udalosti nemá; míľnik = `standardProjectPhase / localProjectPhase → associatedEr`.

### 2.2 Rozhodnutie (zjednodušené)
- Pole sa volá **`spustacia_udalost`** (19650-3: trigger event); pojem „míľnik" sa nepoužíva — míľnik dodacej fázy = plánovaný delivery event.
- Jeden register `EV-`, dva typy: `delivery` | `impact`. Atribúty v registri: `planovana`, `relativny_termin` (delivery), `objekt`, `faza_iso22263`, `faza_lokalna`, `vyvolava:: [[EV-…]]` (impact → delivery).
- **Kde:** EV je samostatná poznámka v registri (`EV/`). Impact event → **UC** a **PROJ** (`spustacia_udalost::`, iniciuje scenár / projekt); delivery event → **ER** (`spustacia_udalost::` — ER si udalosť *vyberá*, neautoruje ju); **IU dedí udalosť z ER**. Dátum len v PROJ.
- **Fáza (B1, 2026-09-09):** `UC.faza` = prípustnosť scenára (autorované); `EV.faza` = kde udalosť nastáva (autorované, oba typy, list; impact = stav aktíva, delivery = fáza projektu); **ER fázu nemá — dedí ju z EV**; UC sekcia „Fázy → ER" sa generuje; validátor `EV.faza ∈ UC.faza`.
- **Export:** delivery eventy s fázou → 29481-3 `standardProjectPhase → associatedEr`; impact mimo idmXML.

### 2.3 Otvorené otázky
- [ ] Mapovacia tabuľka fáz ISO 22263 ↔ SK stupne PD (vyhláška k zákonu 25/2025) ↔ CZ 131/2024 — jedna poznámka `EV-fazy`.
- [ ] Seed delivery/impact eventov z 19650-3 A.3 vs. z katalógu služieb Assetin.

## 3. Aktéri (who)

### 3.1 Zdroje
- 19650-1 kap. 7: strany (poverujúca, vedúca poverená, poverená), tímy (projektový, realizačný, úlohový), **funkcie** (nie role; 1 osoba → n funkcií, 1 funkcia → n osôb).
- 19650-2 5.1.1 (funkcia managementu informácií), 5.4.2 (podrobná matica odpovědnosti), 5.4.4 (TIDP **per úlohový tím**).
- 19650-4 3.2: transakčné roly provider / receiver / reviewer.
- 29481-3 `uc/actor{id, name, classification}`; 7817-3 `Prerequisites/ProvidingActor|ReceivingActor{Role, Description, EMail, @firstName, @lastName, @affiliation}`.
- PAS 1958: aktér = filter špecifikácie.
- BIM protokol: Koordinátor BIM / Správca informácií per strana; prevodná tabuľka Objednávateľ / GZ / subdodávateľ.

### 3.2 Rozhodnutie — dve osi
**Os 1 – organizačná pozícia** (register `ACT-`, hierarchická cesta):
```
strana      poverujuca | veduca-poverena | poverena      (19650-1; enum)
└─ tím      ARCH | STAT | VZT | ELE | FM | geodet …       (úlohový tím; nutná úroveň kvôli TIDP)
   └─ funkcia  koordinator-BIM | spravca-informacii | modelar | …  (voliteľná)
```
ID = cesta, napr. `ACT-poverena/VZT/koordinator-BIM`. Odkaz môže mieriť na ľubovoľnú hĺbku: knižnica typicky na stranu/tím, projekt na tím/funkciu.
Projektové mapovanie `zmluvne_oznacenie` (Objednávateľ, GZ, subdodávateľ) žije v projektovej inštancii, nie v knižnici.

**Os 2 – transakčná rola** (polia na IU/ER, nie v `ACT-`):
`poskytovatel:: [[ACT-…]]`, `prijemca:: [[ACT-…]]`, `overuje:: [[ACT-…]]` (reviewer), voliteľne `autorizuje::`, `akceptuje::`. RACI = generovaný pohľad IU × ACT.

**Osoby** (meno, e-mail): iba projektová inštancia (BEP/RACI), nikdy knižnica.

### 3.3 Export
- 29481-3: `actor.classification` = strana; `actor.name` = tím/funkcia.
- 7817-3: `@affiliation` = strana; `Role` = tím/funkcia; ProvidingActor/ReceivingActor z `poskytovatel`/`prijemca`; `overuje` → `userDefinedProperty`.

### 3.4 Otvorené
- [ ] Číselník funkcií: 19650-1 funkcie vs. role z BIM protokolu — zjednotiť do jedného enumu?

## 4. Objekt a členenie (what)
*(nasleduje)*

## 5. LOIN (how)
Pokryté sekciami 10 (7817-3 zložky a enumy), 11–13 (kontajnery, ukotvenie), 14 (typológia). Zhrnutie: IU-O = `SpecificationPerObjectType`; geometria = enumy 7817-3; alfanumerika = odkazy na `PROP-`; dokumentácia = `Document` (+Format) s `viaze_sa_na`; `clenenie` v IDS-tvare.

## 6. Informačná špecifikácia: kritériá vs. obmedzenia vs. akceptácia vs. overenie

### 6.1 Zdroje
- PAS 1958 6.3 + obr. 15: **information specification = information criteria (6.3.2) + information constraints (6.3.3)**; kritériá → ER → EIR; obmedzenia sú *mimo* ER, definované business kontextom, a exportujú sa do **informačného štandardu**. Obmedzenia typu: a) prítomnosť, b) hodnota (dátový typ, jednotka, enum, rozsah, syntax).
- 29481-3: `uc/businessRule{id, name, proposition, reference}`; `er/constraint{associatedInformationUnit, associatedBusinessRule, description}`.
- 7817-3 / 23387: hodnotové obmedzenia na `Property/DataType` (`PossibleValues/ValueList`), `UnitRef`, `DimensionRef`.
- 19650-2 5.1.4 (informačný štandard: štruktúrovanie, klasifikácia, metóda priradenia LOIN), 5.2.1 c (akceptačné kritériá per požiadavka); 19650-4 kap. 7 (sedem kritérií kontajnera).
- IDS 1.0: cardinality required/prohibited/optional; restriction enum/pattern/bounds; dataType; PartOf.

### 6.2 Rozhodnutie — tri druhy obmedzení, tri domovy
| Druh | Domov | Príklad | Overenie |
|---|---|---|---|
| **Hodnotové** | `PROP-` (23387 DataType, PossibleValues, UnitRef) — projektovo nezávislé | plocha: number, m², ≥0; `Name` ~ `^VZT-\d{2}-\d{3}$` | IDS property/attribute restriction |
| **Štruktúrne / organizačné** | `STD-` (informačný štandard) | zákaz Proxy; prvok ∈ IfcSpace; klasifikačný systém; naming; CRS; formáty | IDS PartOf / prohibited; skript |
| **Požiadavkové** | `constraint` na IU v danom ER (29481-3), odkaz na `businessRule` | v ER „povolenie": dvere musia mať `FireRating` | IDS cardinality required (+ zúženie hodnôt) |

Pravidlá:
- IU **nededuplikuje** hodnotové pravidlá — dedí z PROP; na IU sa píše len prítomnosť a prípadné zúženie.
- `businessRule` (UC) = zdroj pravidla (definícia + odkaz na normu/zmluvu); `constraint` (IU) = jeho uplatnenie.
- Export do zmluvy: štruktúrne → kapitola *informačný štandard*; požiadavkové → tabuľka LOIN/EIR; hodnotové → dátový slovník (príloha).

### 6.2a Alfanumerika — štyri vrstvy, jedna sa autoruje v LOIN
7817-3 `AlphanumericalInformation/Property` = 23387 `PropertyType` (DataType + PossibleValues, UnitRef, DimensionRef, QuantityKindRef) → typ, jednotka a prípustné hodnoty sú *súčasťou* LOIN, ale definované v PROP.

| Vrstva | Obsah | Autoruje sa v | LOIN? |
|---|---|---|---|
| 1 Definícia vlastnosti | názov, definícia, typ, jednotka, veličina, prípustné hodnoty | `PROP-` | viditeľná cez odkaz |
| 2 Požiadavka | ktorá vlastnosť, prítomnosť (= uvedenie), voliteľné zúženie množiny hodnôt | IU-O | **áno — jediná autorovaná** |
| 3 Validácia hodnoty | „FireRating = REI 60" | technická požiadavka (samostatná poznámka), väzba `dokladuje`/`overuje` na PROP | **nie** (7817-1 kap. 7; 7817-2 mimo scope) |
| 4 Metadáta kvality | tolerancia, presnosť, spoľahlivosť, status | IU / IU-C | nie (7817-1 6.1 pozn. 3) |

**Pravidlo:** v IU-O riadku len odkaz na PROP + povinnosť + prípadné zúženie množiny hodnôt; **nikdy konkrétna očakávaná hodnota**. PAS „obmedzenie b) hodnoty" = formát/typ hodnoty, nie očakávaná hodnota.

### 6.3 Pojmy (definitívne)
- **constraint** = *aké pravidlo* platí pre informáciu.
- **overenie** = *ako a čím* sa kontroluje {metóda: IDS | skript-kontajner | skript-cross-file | model-checker | CDE-metadata | manual | administrativne; nástroj; pravidlo_id}.
- **akceptacia** = *kedy a voči čomu* kontajner prejde: agregát constraints platných k `spustacia_udalost` + kritérium 19650-4 (7.1–7.7) + dôkaz + `overuje`. **Je to pohľad**, nie entita.

### 6.4 Metadáta (mimo LOIN — 7817-1 6.1 pozn. 3)
tolerance, presnosť, spoľahlivosť → atribúty na IU-O (per vlastnosť) alebo na IU-C (per kontajner); status/revízia → IU-C (CDE). Enum statusov z `STD-`.

### 6.5 `X_` väzby (definitívny zoznam v1)
`odvodene_z` · `nadradene_pri_rozpore` · `doplnuje` · `dokladuje` — smerované, inline polia, cieľ = ID poznámky. Rozšíriteľné.

### 6.6 Otvorené
- [ ] Číselník funkcií aktérov: Koordinátor BIM a CDE administrátor ostávajú **samostatné funkcie** (rozhodnuté 2026-09-09); zvyšok enumu doplniť.
- [ ] container breakdown: strom v `STD-` vs. `IU-C` poznámky.
- [ ] kvalifikátor rozsahu v `obsahuje`.

---