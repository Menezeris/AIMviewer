---
name: LOIN-03 ISO 29481-3
description: idmXSD po elementoch (uc, businessContextMap, er, informationUnit, constraint), kardinality a mapovanie na náš model — sekcia 8
status: v1.1 (2026-09-09)
cast_serie: "[[LOIN-00 Index]]"
origin: ai
verified:
---


# 8. ISO 29481-3 (idmXSD) — schéma po elementoch a mapovanie na náš model

Zdroj: `[[ČSN EN ISO 29481-3 2023 - Schéma dat a kód]]` (EN ISO 29481-3:2022, idt ISO 29481-3:2022) + inštancia `idm_DesignAuthoring.xml` z prílohy B ISO 29481-1:2025.
Pozn.: norma je technický doplnok 29481-1, ale normatívne odkazuje na **29481-1:2016** (nie na 2025). XSD na `https://standards.iso.org/iso/29481/-3/ed-1/en`.

## 8.1 Konvencie schémy (kap. 4)
- camelCase; skratky iba `idm, uc, er, pm, im, tm, id`; množné číslo pre popisy/skupiny (`benefits`, `requiredResources`).
- Notácia: `PK` (primárny kľúč), `required` / `optional`, `1:1`, `0:1`, `1:*`, `0:*`.
- Norma sama uvádza (Introduction) väzby na **ISO 16739-1 (IFC), 12006-3, 19650-1, 23386, 23387, EN 17412-1 (LOIN), 21597-1 (ICDD)** a MVD — čiže LOIN a ICDD sú predpokladané ako *externé* naviazania, nie súčasť schémy. To je normatívne potvrdenie nášho rozšírenia.

## 8.2 Kostra (kap. 5, tab. 1)
```
idm  (jediný koreň)
├─ specId        1:1
├─ authoring     1:1
├─ subIdm        0:*
├─ uc            1:1   ← práve jeden UC na IDM
├─ businessContextMap 0:*
└─ er            0:1   ← práve jeden (alebo žiadny) ER na IDM
```
**Kritické zistenie:** `uc` je 1:1 a `er` 0:1 — jeden IDM = jeden use case + jeden ER. Viacero ER sa rieši **cez `subEr`** (a viacero UC cez `subUc` / `subIdm`). Náš plán „UC-0100 s piatimi sub-UC" a „ER s viacerými sub-ER" je teda presne to, čo schéma predpokladá; ale ak chceme sub-UC ako *samostatné poznámky*, pri exporte to bude buď `subUc` v jednom idm, alebo viac `idm` súborov (každý so svojím UC+ER). → **rozhodnutie: jeden `idm` na jeden sub-UC**, nadradený UC-0100 exportovať ako samostatný `idm` so `subIdm` odkazmi.
- `businessContextMap` a `er` môžu ostať nešpecifikované v ranej verzii (norma to explicitne dovoľuje) → naše v1 bez BPMN je legitímne.

## 8.3 specId (kap. 6, tab. 2) — každý komponent (idm, uc, bcm, er)
| atribút | reštrikcia | naše pole |
|---|---|---|
| `guid` | PK | `guid` (generovať) |
| `shortTitle` | required, **v angličtine** | `kratky_nazov_en` |
| `localShortTitle` | optional | `kratky_nazov` (sk) |
| `fullTitle` | required | `nazov_en` |
| `subTitle` | optional | — |
| `idmCode` | required | `idm_kod` (generovaný, kap. 11) |
| `localCode` | optional | **`id`** (naše UC-0101 / ER-0101 …) |
| `documentStatus` | required, enum **NP / WD / PUB / WDRL** | `stav` |
| `localDocumentStatus` | optional | — |
| `version` | optional | `verzia` |

## 8.4 authoring (kap. 7)
`copyright` (required!), `changeLog` **1:*** (id, changeDateTime, changeSummary, changedBy, change[changedElement, changedFrom]), `author` 0:* (person 1:* / organization 1:*), `committee` 0:* (name PK, leader, member), `publisher` 0:1.
→ V MD: `autor`, `licencia` vo frontmatter; **changeLog generovať z git histórie** pri exporte (norma vyžaduje ≥1 záznam).

## 8.5 uc (kap. 8, tab. 11) — kompletný zoznam
| element | reštr. | poznámka / naše pole |
|---|---|---|
| `specId`, `authoring` | 1:1 | viď vyššie |
| `subUc` | 0:* | `sub_uc:: [[UC-…]]` |
| `summary` | **1:1** | `## Zhrnutie` |
| `aimAndScope` | **1:1** | `## Cieľ a rozsah` |
| `language` | **1:1** | ISO 639-1 → `jazyk: sk` |
| `use` | **1:*** | `pouzitie:` — **názov musí byť sloveso+podstatné meno** (29481-1 tab. 1, pravidlo 3): `ZamerajPriestory`, `PrenesVymeryDoZmluvy`; + `classification` 0:1 |
| `standardProjectPhase` | **1:*** | enum **inception, brief, design, production, maintenance, demolition**; + `outcomes` 0:1, `informationRequirements` 0:1 → `associatedEr` 0:* |
| `localProjectPhase` | 0:* | SK stupne PD / CZ fázy + `classification` |
| `region` | **1:*** | `type` (kontinent/krajina/USR) + `value` (ISO 3166-1; default INT) → `SVK`, `CZE` |
| `constructionEntity` | 0:* | **typ stavby** (nemocnica, letisko…) + klasifikácia → chýbalo nám úplne! |
| `businessRule` | 0:* | id, name, `proposition` 1:1, reference → **kam patria naše meracie definície `DEF-`** |
| `actor` | 0:* | id, name (rola), `classification` 0:1 |
| `benefits` | 0:1 | prínosy |
| `limitations` | 0:1 | ≈ „Delimitation" z UCM → `vymedzenie_negativne` |
| `requiredResources`, `requiredCompetencies` | 0:1 | zdroje / kompetencie |
| `scopeKeyword`, `benefitKeyword` | 0:* | tagy |
| `reference` | 0:* | `basisStandard` (bool!) + `fullCitation` → normy, vyhlášky |
| `userDefinedProperty` | 0:* | **oficiálny hák na naše rozšírenia na úrovni UC** (name + description) |

Podporné: `classification` (id PK, name, version, publicationYear), `description` (title + `image`[caption, filePath]), `outcomes`, `informationRequirements` (description 1:* + `associatedEr` 0:*).

## 8.6 businessContextMap (kap. 9)
`specId`, `authoring`, `subBusinessContextMap` 0:*, `pm` 0:*, `im` 0:*.
- `pm`: `diagram` 1:1 (id, name, `diagramFilePath`, `imagFilePath`, `notation`, description) + `dataObjectAndEr` 0:* (associatedDataObject ↔ associatedEr) + `subPm`.
- `im`: `diagram` 1:1 + `tm` **1:*** ; `tm`: `diagram` 1:1 + `messageAndEr` 0:* (associatedMessage ↔ associatedEr).
- Default notácie: **BPMN (ISO/IEC 19510)** pre PM, **ISO 29481-2** pre IM/TM.
→ v1 vynechať (0:* dovoľuje); neskôr BPMN súbor + mapovanie data object ↔ ER.

## 8.7 er (kap. 10, tab. 40)
| element | reštr. | poznámka |
|---|---|---|
| `specId`, `authoring` | 1:1 | |
| `subEr` | 0:* | rekurzia |
| `informationUnit` | **1:*** | ER nesmie byť prázdny |
| `constraint` | 0:* | |
| `correspondingMvd` | 0:* | basis + name (+description) → miesto pre **IDS / MVD** |
| `description` | 0:* | |

**informationUnit (tab. 41):** `id` PK, `name` required, `dataType` required (voľný string), `isMandatory` boolean required, `definition` required, `examples` 0:1, `correspondingExternalElement` 0:* (`basis` + `name` + description → IFC entita, pset, bSDD/12006-3 term), `subInformationUnit` 0:* (rekurzia).

**constraint (tab. 44):** `id` PK, `associatedInformationUnit` optional, `associatedBusinessRule` optional, `description` 0:*.
→ Kľúč: **constraint sa viaže na businessRule z UC**. Naše `DEF-` (meracia definícia plochy) = `businessRule` na UC; constraint na IU naň odkazuje. Tým máme normatívne miesto aj pre RASE/pravidlá.

## 8.8 IDM kód (kap. 11)
`<specType>-<primaryUse>-<phaseStart><phaseEnd>-<region ISO 3166-1 alpha-3>-<lang ISO 639-1>-<author/committee>-<YYYYMMDD>-<shortTitle>-<documentStatus>`
Fázy: IN, BR, DE(sign), PR, MA, DE(molition) — pozn.: norma má **kolíziu skratiek Design/Demolition**, obe „DE".
Príklad pre nás: `uc-ZamerajPriestory-INMA-SVK-SK-Assetin-20260908-PriestorovaPasportizacia-WD`.

## 8.9 Čo schéma **nemá** (potvrdenie našich rozšírení)
1. **LOIN** — žiadne geometrické aspekty, alfanumerika, dokumentácia. → `userDefinedProperty` (UC) / `constraint` + `correspondingExternalElement` (IU), definitívne až ISO 7817-3.
2. **Ciele (GOAL)** — len `benefits` textom. → GOAL ostáva naša entita, export do `benefits` + `scopeKeyword`.
3. **Udalosti** — žiadny impact/delivery event. Potvrdené: `spustacia_udalost` je naša organizačná vrstva; do exportu ide len fáza.
4. **Akceptačné kritériá** (19650-4) — nie sú; iba `constraint` voľným textom.
5. **Kontajnerová/TIDP vrstva** — nie je; `correspondingMvd` a `correspondingExternalElement` sú jediné háky.
6. **PROP / dátové šablóny (23387)** — spomenuté v úvode, ale bez elementov; `correspondingExternalElement.basis = ISO 12006-3 / bSDD`.
7. **Aktér nie je viazaný na IU/ER** — `actor` je len zoznam na UC, bez väzby „kto posiela / kto prijíma túto jednotku". → naša väzba `poskytovatel/prijemca/reviewer` na IU je rozšírenie (v exporte cez `userDefinedProperty` alebo IM/TM).

## 8.10 Dôsledky pre v1 (zmeny oproti 7.4)
- **Pridať do UC:** `pouzitie` (sloveso+podstatné meno, 1:*), `region` (1:*), `constructionEntity`, `limitations`, `scopeKeyword`/`benefitKeyword`, `licencia`, `stav` (NP/WD/PUB/WDRL), `jazyk`.
- **`DEF-` = businessRule na UC**; IU constraint naň odkazuje.
- **`PROP-`** → `correspondingExternalElement`; tvarovať podľa ISO 23387.
- **Fázy:** `standardProjectPhase` povinný enum ISO 22263; SK/CZ do `localProjectPhase`.
- **Granularita súborov:** 1 sub-UC = 1 `idm`; nadradený UC → `subIdm`.
- **Aktéri:** schéma dáva len `actor{id, name, classification}` na UC; R/A/C/I a provider/receiver/reviewer sú rozšírenie (sekcia 3).

---