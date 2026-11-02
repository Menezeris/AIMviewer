---
name: NORMS-GAP
description: Kontrola modelu knižnice voči normám (PAS 1958, ISO 29481-1/-3, ISO 7817-1/-3, ISO 19650-1) — pojem normy → náš typ/pole → sedí / medzera / rozpor, s klauzulou a miestom v kóde
status: v1.2 (2026-09-14, kolo 4) — zostavené z LOIN-00…09 v docs/vault/, plné texty noriem v repe nie sú; §7 = riadky revízie 11. 9. a suchý beh IDS; §8 = klauzuly PAS 1958 6.x citované zo zadania kola 4 (plný text má Samuel vo vaulte, v repe nie je)
origin: ai
verified:
---

# NORMS-GAP — model voči normám

## 0. Z čoho je to zostavené a čo v repe nie je

**V repe nie je plný text ani jednej normy.** `docs/normy/` obsahuje iba `README.md` (tabuľku, čo by tam malo byť, a zákaz commitovať texty pod copyrightom); priečinky `docs/normy/7817-3/` a `docs/normy/29481/` neexistujú. Konkrétne:

| Norma | Plný text v repe | Kde sa o nej vo vaulte hovorí |
|---|---|---|
| PAS 1958:2026 | **nie** (ani excerpt); od kola 4 sú klauzuly 6.1.3, 6.2.1, 6.3.2, 6.3.3, 7.1.2/7.1.3 citované v §8 zo zadania — plný text má Samuel vo vaulte `20_Resources/` | LOIN-01 §1–§2, §4, §6; LOIN-02 §7; LOIN-09 §17 |
| ISO 29481-1:2025 | nie | LOIN-01 §1; LOIN-07 §15 |
| ISO 29481-3 (idmXSD) | nie (LOIN-03 hovorí, že XSD je na standards.iso.org) | LOIN-03 §8 (element po elemente) |
| ISO 7817-1 | nie | LOIN-01 §5; LOIN-07 §15 |
| ISO/CD 7817-3 Annex B/C | nie | LOIN-04 §9–§10 (skeleton XSD z CD) |
| ISO 19650-1 (+ DIS 2026) | nie | LOIN-01 §1, LOIN-09 §19 |

Všetko nižšie je preto **druhotné čítanie** — klauzuly sú tak, ako ich cituje séria LOIN, a v tomto repe sa nedajú overiť proti norme. Kde vault pojem nemá, je to napísané výslovne („nie je vo vaulte“); nič sa nedomýšľa. Jediný normatívne odvodený artefakt v repe je `tests/fixtures/ids/dss/Configurations.ids` (DSS, CZ).

Stav v tabuľkách: **sedí** = pojem má v modeli jedného nositeľa a ten je exportovateľný do schémy normy · **medzera** = norma pojem má, model ho nenesie alebo len textom · **rozpor** = model a norma sa v tvare alebo v kardinalite líšia a niekto musí ustúpiť (vault to zväčša už rozhodol). Stĺpec *Miesto v kóde* je pydantic model (`assetin/schema/typy/…`), pole s jeho `export=`, alebo modul enginu.

---

## 1. PAS 1958:2026

| Pojem normy | Náš typ / pole | Stav | Klauzula (ako ju cituje vault) | LOIN poznámka | Miesto v kóde |
|---|---|---|---|---|---|
| trigger event = impact event + delivery event | `EV.typ_udalosti: impact \| delivery`; `UC.spustacia_udalost` (iba impact), `ER.spustacia_udalost` (iba delivery), `PROJ.spustacia_udalost` (impact, povinné) | **sedí** | 6.1.3; 6.3 f; obr. 21/23/24 | LOIN-01:177, LOIN-02:90, LOIN-09:32 (rozhodnutie 8) | `typy/ev.py` (`HRANICNE_AK = ("typ_udalosti","delivery")`), `typy/uc.py`, `typy/er.py:98` (`export="7817-3 InformationDeliveryMilestone ; IDS info/milestone"`), validácia §16 pravidlo 5; strom: `retazec.Retazec.spusta` / `Vymena.dodanie` |
| impact event **iniciuje** use case a definuje filter *objekt* | `UC.spustacia_udalost`; filter objekt nemáme | **medzera** (filter) | 6.1.3, PAS obr. 24 | LOIN-02:90 | `retazec.Retazec.spusta` stojí nad účelom (MODEL §5) |
| impact → delivery (tab. 2) je organizačná väzba (risk mgmt), nie IDM | `EV.vyvolava:: [[EV-D-…]]` (iba impact) | **sedí** ako hrana; **obsah tab. 2 nie je vo vaulte** | tab. 2; 19650-3 A.3 | LOIN-01:177, LOIN-02:90; SCHEMA §12 (`vyvolava`) | `typy/ev.py` (`vyvolava`); inšpektor EV „vyvoláva udalosť“ (`inspektor.prazdny_stav`) |
| use case (purpose = use case + business context) | `UC` | **sedí** | 6.2.1 (prevzaté z 29481-1); 6.1.3 reťazec impact → UC → BC → information specification | LOIN-01:50–53, LOIN-09:66 | `typy/uc.py` (`RAMEC="29481"`), `ulohy` → `export="businessContextMap"` |
| „5D/6D“ nie je názov use case; štandardná knižnica UC | názvy UC vo vzore sú vecné; knižnica = katalóg | sedí | 6.2.2.1 | LOIN-01:53 | — (obsah, nie schéma) |
| task = delivery \| utilization; atomický; UC obsahuje tasky | `UC.ulohy[].typ`; `UC.typ_ulohy` = sumár úloh **poskytovateľov** | **sedí** | 6.2.1; 6.2.3.1 (dve granularity účelu: UC a úloha/rozhodnutie) | LOIN-01:51, :55, :64; LOIN-09:70; DECISIONS V6 | `typy/uc.py:Uloha` (`typ: TypUlohyUC`), `typ_ulohy` odvodené (`predvolby`); strom: `Retazec.ulohy` |
| information specification = criteria (6.3.2) + constraints (6.3.3); constraints sú mimo ER, idú do informačného štandardu | criteria → položky IU-O (`alfanumerika`, `geometria`, `dokumentacia`), constraints → `STD` pravidlá (`plati: vzdy`) + `ER.zapnute` | **sedí** | 6.3, obr. 15 | LOIN-01:232; LOIN-08:44 („STD píše, ER zapína“) | `typy/iu_o.py`, `typy/std.py` (`Pravidlo.plati`), `typy/er.py` (`zapnute`) |
| information unit (3.1.4.13) = od celého kontajnera po vlastnosť objektu; má existovať raz, asociovaná k viacerým účelom (obr. 19) | `IU-O`, `IU-C`; jedna jednotka vo viacerých `ER.obsahuje` | **sedí** | 3.1.4.13; 6.3.2 c; obr. 19 | LOIN-01:17, :56 | `typy/er.py:124` (`obsahuje` → `export="informationUnit / subInformationUnit"`); strom: `Vymena.jednotky/kontajnery`, `Retazec.pozicie` (jedna jednotka, viac pozícií) |
| **information requirement** ako pojem PAS | — | **nie je vo vaulte** (vault má len *information specification* a 19650-1 3.3.2 „co, kdy, jak, pro koho“) | — | LOIN-01:35 (19650-1), :232 | — |
| **deliverable** | najbližšie `IU-C` (kontajner) | **nie je vo vaulte** ako pojem PAS; „dodávka“ je len vlastná úvaha o kontajneroch | — | LOIN-05:23, :50 | `typy/iu_c.py` |
| IR hierarchia OIR/AIR/PIR | `GOAL.uroven: organizacia \| aktivum \| projekt`, `GOAL.zdroj_ir: OIR \| AIR \| PIR`, `prispieva_k` (nižšia → vyššia) | **sedí** ako kaskáda; väzba na UC pozri §5 | 6.3 (PAS) + 19650-1 5.2–5.5 (LOIN-02 diagram) | LOIN-02:16–27; LOIN-09:68 | `typy/goal.py` (`RAMEC="19650-1"`, `prispieva_k`) |
| knižnica → projekt = filter (účel × objekt × míľnik × aktér), nie kópia | `PROJ` = dosadenie; knižnica = definície (V19 repo) | sedí | 6.3.6; obr. 24 | LOIN-09:25 (rozhodnutie 1); MODEL §3 | `typy/proj.py`, validátor F (dosadenia zakázané v knižnici) |
| specification response / lessons learned | — | **medzera** (nízka priorita) | 6.3.6.2.1 | LOIN-02 gap 19 | — |

## 2. ISO 29481-1 / 29481-3 (IDM, idmXSD)

| Pojem normy | Náš typ / pole | Stav | Klauzula | LOIN poznámka | Miesto v kóde |
|---|---|---|---|---|---|
| use case (3.3.2): sled akcií rolí k naplneniu účelu; `uc` 1:1 per `idm` | `UC`; sub-UC = samostatná poznámka, 1 sub-UC = 1 `idm` | **sedí** | 29481-1 3.3.2, 5.3.1 (aim, scope, uses, region, phases); 29481-3 kap. 8 tab. 11 | LOIN-01:38, :44; LOIN-03:31, :52–72; LOIN-09:45 (rozhodnutie 21) | `typy/uc.py` — `pouzitie→use`, `region→uc/region`, `faza_iso22263→standardProjectPhase`, `nadradeny_uc→subUc/subIdm` |
| task / activity | `UC.ulohy` | **medzera v norme, nie v modeli**: 29481-3 nemá element task; má len BPMN data object ↔ ER (`dataObjectAndEr`) | 29481-3 kap. 9 (`pm`, `dataObjectAndEr`) | LOIN-03:76–79; LOIN-01:154, :64 | `typy/uc.py:Uloha` → `export="29481-3 businessContextMap"`; úloha je pojem PAS 6.2.1, nie 29481 |
| exchange requirement (3.3.10): množina IU pre use case; `er` 0:1 per idm; `informationUnit` 1:* | `ER` = UC × delivery udalosť × príjemca; `obsahuje` ≥ 1 (validátor) | **sedí**; kardinalita 0:1 per idm je rozpor s naším „viac ER na UC“ → rieši export 1 sub-UC = 1 idm | 29481-1 3.3.10, 5.5.1; 29481-3 kap. 10 tab. 40 | LOIN-01:40–41, :47; LOIN-03:31, :83–90; LOIN-09:26 (rozhodnutie 2) | `typy/er.py`; strom: `Retazec.vymeny` (deti účelu, MODEL §5) |
| ER `preconditions` (iný ER splnený skôr) | `ER.referencne_info` | **medzera** (29481-3 má len `subEr`) | 29481-1 5.5.1 | LOIN-07:30–31 | `typy/er.py` (`referencne_info`) |
| informationUnit (tab. 41): `dataType` voľný text, `isMandatory` bool, `correspondingExternalElement`, `subInformationUnit` rekurzívne | `IU-C` natívne; `IU-O` ako `subInformationUnit` kontajnera; `zavaznost` (4 stupne) vs. `isMandatory` (bool) | **sedí** s **rozporom** v `dataType` (voľný text — slabé) a v `zavaznost` (rozšírený enum, R) | 29481-3 tab. 41 | LOIN-03:93; LOIN-01:151; LOIN-04:25; LOIN-07:58 | `typy/iu_c.py:77` (`datovy_typ_29481` → `informationUnit/dataType`), `iu_c.py:108` (`obsahuje` → `subInformationUnit`) |
| actor: `uc/actor{id, name, classification}` — **bez väzby na IU/ER** | `ACT` register (strana → tím → funkcia) + transakčné roly `poskytovatel / prijemca / overuje` na IU a ER | **medzera v norme** — naše roly na IU/ER sú rozšírenie (export cez `userDefinedProperty` alebo IM/TM) | 29481-3 tab. 11 (`actor` 0:*), §8.9 bod 7 | LOIN-03:66, :110; LOIN-09:31 (rozhodnutie 7); LOIN-07:56 | `typy/act.py:32` (`strana` → `29481-3 classification ; 7817-3 @affiliation`), `typy/iu_o.py:188` (`poskytovatel` → `7817-3 ProvidingActor`) |
| businessRule{id, name, proposition, reference}; constraint sa viaže na businessRule z UC | `DEF` (meracie pravidlo), `UC.pravidlo` | **sedí** (rozdelené: definícia do 7817-3 `Property.Definition`, pravidlo do 29481-3 `businessRule`) | 29481-3 tab. 11 (`businessRule`), tab. 44 (`constraint`) | LOIN-03:65, :95–96, :114; LOIN-07:42 | `typy/def_.py:23` (`export="7817-3 Property.Definition ; 29481-3 businessRule/proposition"`), `typy/uc.py:102` (`pravidlo` → `businessRule`) |
| milestone: 29481-3 **udalosti nemá**; míľnik = `standardProjectPhase / localProjectPhase → associatedEr` | `EV` register (delivery) + `UC.faza_iso22263` | **rozpor** (vedomý): náš míľnik je udalosť, do 29481-3 ide len fáza | 29481-3 kap. 8 (`standardProjectPhase` enum inception…demolition) | LOIN-01:178; LOIN-03:62, :103–105 (§8.9 bod 3) | `typy/uc.py:49` (`faza_iso22263` → `standardProjectPhase`), `typy/ev.py` |
| businessContextMap (`pm` BPMN + `dataObjectAndEr`), transactionMap (`im`/`tm`, ISO 29481-2) | `UC.ulohy` (bez BPMN diagramu); `im/tm` v v1 vynechané | **medzera** (diagram, správy) — vedome | 29481-3 kap. 9 | LOIN-03:76–81 | `typy/uc.py:94` (`ulohy` → `businessContextMap`) |
| `benefits`, `scopeKeyword` (jediné miesto pre ciele) | `GOAL` + `UC.podporuje_ciel` | **medzera v norme**: GOAL je naša entita, exportuje sa textom | 29481-3 tab. 11 | LOIN-03:104 (§8.9 bod 2); SCHEMA §2 („Prínosy → benefits“) | `typy/goal.py` (bez `export=`), `typy/uc.py` (`podporuje_ciel` pod `## Prínosy`) |

## 3. ISO 7817-1 / 7817-3 (LOIN)

| Pojem normy | Náš typ / pole | Stav | Klauzula | LOIN poznámka | Miesto v kóde |
|---|---|---|---|---|---|
| purpose: predpoklad LOIN, LOIN ho neurčuje; jedna LOIN môže slúžiť viacerým účelom (5.2 príkl. 2); účely sa odvodzujú z OIR/PIR/AIR | `UC` (účel), `GOAL` (odvodenie) | **sedí**; **rozpor** medzi 7817-1 (viac účelov) a 7817-3 (`Purpose` 1:1 per `Specification`) — vault rozhodol: knižnica = zoznam, inštancia = jedna `Specification` | 7817-1 5.1, 5.2; 7817-3 `Specification/Prerequisites/Purpose` 1 | LOIN-01:28–31; LOIN-04:62, :74–78; LOIN-07:33 (K) | `typy/uc.py`; generátor `Specification` per (ER × udalosť × poskytovateľ) — F4 |
| milestone (5.3): predpoklad *kedy*; ten istý objekt má v rôznych míľnikoch rôzny LOIN | `EV` (delivery) → `InformationDeliveryMilestone`; rôzny LOIN per míľnik = `ER.prepisy` (delta voči IU) | **sedí** | 7817-1 5.3; 7817-3 `InformationDeliveryMilestone` (Name, @Date) | LOIN-01:174; LOIN-04:63 | `typy/er.py:98`, `typy/ev.py:35` (`datum` → `@Date`, v knižnici zakázané — dosadenie), `Prepis` (`typy/er.py`) |
| actor: `ProvidingActor` / `ReceivingActor` 1:1; **reviewer nie je**; poskytovateľ nemusí byť známy (7817-1 5.4 príkl. 1) | `poskytovatel`, `prijemca`, `overuje` | **sedí** (2 roly) + **rozšírenie** (`overuje`, 19650-4 reviewer) + **rozpor** (5.4 vs. 1:1 → `poskytovatel_predvoleny` na ER) | 7817-1 5.4; 7817-3 `Prerequisites` | LOIN-01:197, :212, :218; LOIN-04:120 (§10.7 bod 5); LOIN-07:34 (K), :56 (T) | `typy/iu_o.py:188`, `typy/er.py` (`prijemca`, `poskytovatel_predvoleny`), `typy/act.py:12–14` (`@firstName/@lastName/EMail` — dosadenie, v knižnici zakázané) |
| object type: `SpecificationPerObjectType/ObjectType` (23387 `ObjectTypeType`, `@dt:about` URI, `DictionaryRef`) | `IU-O.objekt{ifc_entita, predefined_type, uri}`, `klasifikacia[]` | **sedí** | 7817-1 5.5; 7817-3 `SpecificationPerObjectType` | LOIN-04:81–82; LOIN-05:32; LOIN-09:33 (rozhodnutie 9) | `typy/iu_o.py:29` (`ifc_entita` → `7817-3 ObjectType ; IDS applicability/entity`), `:32` (`uri` → `@dt:about`), `:36` (`klasifikacia.system` → `DictionaryRef`) |
| štruktúra členenia / pozícia objektu (5.5) | `STD-clenenie` (`plati: vzdy`), `IU-O.clenenie` výnimkou; IDS PartOf z detskej strany | **medzera v 7817-3** (len `Location.ReferenceObject` voľný text) — pokrytá cez STD + IDS | 7817-1 5.5 | LOIN-04:82, :115 (§10.7 bod 1); LOIN-07:39; LOIN-09:30 (rozhodnutie 6) | `typy/std.py` (`Pravidlo.rozsah`, `applicability`), `typy/iu_o.py` (`clenenie`) |
| geometrical information: 5 aspektov (Detail, Dimensionality, Appearance, ParametricBehaviour, Location) | `IU-O.geometria` + `GEO` profily G0–G3 ako presety v STD | **sedí** (aspekty 7817-3 sú pravda, profil je preset) | 7817-1 6.2; 7817-3 `GeometricalInformation` | LOIN-04:94–99; LOIN-09:38 (rozhodnutie 14); DECISIONS V8 | `typy/iu_o.py:164` (`geometria` → `7817-3 GeometricalInformation`), `typy/std.py:97–98` (`GEO.aspekty`, `dictionary` → `Detail/Dictionary`) |
| alphanumerical information: `Property` (23387 `PropertyType` s `DataType`, `PossibleValues`, `UnitRef`, `DimensionRef`, `QuantityKindRef`) | `IU-O.alfanumerika[]` položky; typ/jednotka/hodnoty v `PROP`; slovníky v `STD-klasifikacia` (`hodnoty_ref`) | **sedí** | 7817-1 6.3, 6.3.1 (23387); 7817-3 `AlphanumericalInformation` | LOIN-04:86–89; LOIN-01:251; LOIN-09:37 (rozhodnutie 13) | `typy/iu_o.py:169` (`alfanumerika` → `7817-3 AlphanumericalInformation ; IDS requirements`), `:73` (`hodnoty` → `PossibleValues ; IDS xs:enumeration`), `typy/prop.py:42–45` (`DataType (23387)`, `UnitRef`, `QuantityKindRef`, `PossibleValues`) |
| identifikácia objektu = vzor atribútu `Name` (typ vs. výskyt) | `IU-O.alfanumerika[].ifc.atribut: Name` + `vzor`; `pravidlo` → STD | **sedí** (mapované cez IDS Attribute facet) | 7817-1 6.3.2 | LOIN-07:40; LOIN-09:33, :39 (rozhodnutie 15) | `typy/iu_o.py:56` (`vzor` → `IDS xs:pattern`) |
| documentation: `Document` (Name, Format{FormatName, FormatVersion, FormatSpecification}, @type/@form/@content) — **vnorená do `SpecificationPerObjectType`** | `IU-O.dokumentacia[]` (per objekt) **a** `IU-C` (samostatný kontajner, 7817-3 ho nemá) | **sedí** (per objekt) + **medzera v 7817-3** (kontajnerová vrstva); vault rozhodol: register kontajnerov ≠ odvodený z LOIN Documentation | 7817-1 6.4; 7817-3 `Documentation/Document` | LOIN-04:91–92, :116 (§10.7 bod 2); LOIN-05:72; LOIN-09:36 (rozhodnutie 12) | `typy/iu_o.py:171` (`dokumentacia` → `7817-3 Documentation`), `:121` (`dok` → `Documentation/Document ; IfcRelAssociatesDocument`), `typy/iu_c.py:44–46` (`@type/@form/@content`), `:78` (`forma` → `Document/Format`, `technicky`) |
| Specification = 1 purpose + 2 actors (+ 1 milestone) = jedna transakcia; EIR = práve jedna Specification | generuje sa per (ER × udalosť × poskytovateľ) — F4 | **sedí** (normatívne potvrdené) | 7817-3 anotácia XSD k `Specification` | LOIN-04:74–78; LOIN-07:32; LOIN-09:27 (rozhodnutie 3) | generátor 7817-3 (F4, `PLAN` §6) |
| metadáta (tolerancia, presnosť, spoľahlivosť, status) mimo LOIN | na položke IU (`tolerancia`), na IU-C (`metadata_cde`) | **sedí** (zámerne mimo) | 7817-1 6.1 pozn. 3, kap. 7 | LOIN-07:62; LOIN-09:43 (rozhodnutie 19) | `typy/iu_o.py` (`Polozka.tolerancia`), `typy/iu_c.py` |
| GeoReferencing (CRS, Datum, VerticalDatum, ModelCoordinateSystem) | `IU-C.georeferencovanie` | **sedí** | 7817-3 `GeoReferencing` | LOIN-04:101–104; LOIN-07:45 | `typy/iu_c.py` |
| CD štádium: namespace 7817-3 sa ešte zmení | export F4 | **riziko** | poznámka v XSD | LOIN-04:55 | — |

## 4. ISO 19650-1 (+ DIS 2026)

| Pojem normy | Náš typ / pole | Stav | Klauzula | LOIN poznámka | Miesto v kóde |
|---|---|---|---|---|---|
| information requirement = *čo, kedy, ako, pre koho* | ER (čo) × EV (kedy) × forma (ako) × ACT (pre koho) | **sedí** ako rozklad | 19650-1 3.3.2 | LOIN-01:35 | `typy/er.py` |
| OIR → AIR → PIR (kaskáda; DIS 2026: perspektívy stakeholderov, nie dokumenty) | `GOAL` jeden typ, `uroven` + `zdroj_ir`; `prispieva_k` nižšia → vyššia; `GOAL.uroven: projekt` v knižnici povolené (V19 repo) | **sedí** | 19650-1 5.2–5.5 (podľa LOIN-02); DIS 2026 (3) | LOIN-02:16–19; LOIN-09:68, :77 | `typy/goal.py`; validátor F14 (cieľ bez UC = varovanie) |
| EIR ↔ ER: 1 EIR ↔ n ER; EIR = ER dosadený na poverenie (aktér + míľnik) | `PROJ` (EIR inštancia) vyberá ER; knižnica ER nedosadzuje | **sedí** | 19650-1 3.3.6; 19650-2 5.2.1; 29481-1 úvod | LOIN-01:41, :68; LOIN-07:32; LOIN-09:19 | `typy/proj.py`; pásmo 4 „Pre koho a dokedy?“ = šev (`pasma.RAMCE`) |
| informačný štandard (19650-2 5.1.4, „metóda priraďovania LOIN“) | `STD` (pravidlá, slovníky, členenie), `GEO`, `DEF` | **sedí** (v norme text, v schémach nič — T) | 19650-2 5.1.4 | LOIN-07:53; LOIN-09:18 | `typy/std.py` (`RAMEC=""`, `PRIEREZOVE=True`) |
| AIR viazané na trigger events (prevádzka) | `EV impact` + `UC.spustacia_udalost` | **sedí** | 19650-3 príl. A.3 | LOIN-01:176 | `typy/ev.py` |
| akceptačné kritériá per požiadavka (19650-4) | `overenie` + `postup`; `akceptacia` nie je | **medzera** (vysoká priorita podľa LOIN-02 gap 3) | 19650-2 3.1.1.1, 5.2.1 c; 19650-4 kap. 7 | LOIN-02:49; LOIN-07:54–55 | `typy/iu_o.py` (`Polozka.overenie`), `typy/std.py` (`overenie`) |
| RACI (10.3) | generovaný pohľad IU × aktér — F4 | **medzera** (stredná) | 19650-1 10.3; 19650-2 5.4.2 | LOIN-02:52; LOIN-07:57 | — |
| TIDP polia na kontajneri | `IU-C` (`predchodca`, `nadvaznost`…) | **sedí** (dátumy až v inštancii) | 19650-2 5.4.4 | LOIN-02:53; LOIN-07:46 | `typy/iu_c.py` |

## 5. Osobitne: ako PAS 1958 a 19650-1 viažu IR hierarchiu na use case

Vault dáva tri veci, žiadna z nich nie je citovaná veta normy:

1. **LOIN-02:16–27** — reťaz `OIR / AIR / PIR (19650-1 5.2–5.5; PAS 1958 6.3) → účely, spúšťače, filtre → IDM = UC + business context + ER{IU + LOIN + constraints} → EIR (19650-2 5.2.1) → BEP → TIDP/MIDP → výmena → PIM/AIM`, s poznámkou „filter: aktér + míľnik (+ objekt) (PAS obr. 24)“.
2. **LOIN-01:31** (7817-1 5.2 pozn.) — „účely sa odvodzujú z OIR / PIR / AIR“.
3. **LOIN-09:69** — „jediné miesto, ktoré odôvodňuje konkrétnu IU: `IU ← task ← UC ← GOAL` → minimum podľa 19650-1 11.2, argument voči dodávateľovi“.

Z toho plynie: hierarchia IR sa na use case viaže **cez účel** — OIR/AIR/PIR hovoria, *prečo* organizácia informáciu chce, use case hovorí, *v akom scenári* ju získa. Naše hrany to pokrývajú:

| Hrana normy | Naša hrana | Pokryté |
|---|---|---|
| OIR → AIR → PIR (kaskáda) | `GOAL.prispieva_k:: [[GOAL-…]]` (nižšia → vyššia) | áno |
| IR → use case („účely sa odvodzujú z IR“) | `UC.podporuje_ciel:: [[GOAL-…]]` | áno |
| IR → deliverable **priamo** | — | **vo vaulte nie je doložená ani vyvrátená**; pojem *deliverable* vault ako pojem PAS/19650 nenesie |

V modeli je IR → deliverable dosiahnuteľné **tranzitívne**: `GOAL ← UC (podporuje_ciel) ← ER (uc) ← IU-C (obsahuje)`, a per úloha `IU-O.pre_task → UC#T → UC → GOAL` (LOIN-09:69). Podľa MODEL §2 (jeden nositeľ) by druhá, priama hrana bola duplikát — kým nie je doložená klauzula, ktorá ju vyžaduje.

**Návrh O7 (v DECISIONS „Otvorené“; číslo V22 patrí odvodeným údajom inšpektora):** priamu hranu IR → deliverable **nepridávať**. Ak ju plný text 19650-1 (5.x) alebo PAS 1958 (6.3) vyžiada (napr. „každý deliverable musí byť trasovateľný na PIR“), patrí na **`IU-C.dokladuje_ciel:: [[GOAL-…]]`** (kontajner dokladuje cieľ), nie na ER — ER je transakcia, nie dodávka. Do rozhodnutia to nesie inšpektor ako odvodený údaj (`dopad_zmeny` už ide cez `uc`, `obsahuje`), takže strata informácie nehrozí.

## 6. Čo z toho ide do práce

Zoradené podľa dopadu (podrobnosti a rozhodnutia v `docs/QUESTIONS.md`, horná sekcia):

1. **Plné texty noriem v repe nie sú** — každý riadok vyššie je z druhej ruky. Kým Samuel nedoplní `docs/normy/` (lokálne, necommitované), táto tabuľka sa nedá overiť (Q31).
2. **Akceptačné kritériá (19650-4)** — jediná medzera, ktorú vault sám označil vysokou prioritou a model ju stále nemá (LOIN-02 gap 3).
3. **Kardinality 29481-3 a 7817-3 sú prísnejšie než text Part 1** (uc 1:1, er 0:1, Purpose 1:1, ProvidingActor 1:1) — vault to rieši exportom (1 sub-UC = 1 idm, 1 Specification per ER × udalosť × poskytovateľ); generátor F4 to musí držať.
4. **`zavaznost` vs. `isMandatory`**, typológia A–I, `X_` väzby, `overuje`, `viaze_sa_na: proces` — naše rozšírenia bez normovej opory (LOIN-07 §15.3); v exporte idú cez `userDefinedProperty` alebo vypadnú.
5. **Míľnik ≠ udalosť**: 29481-3 udalosti nemá; do exportu ide fáza. Vedomý rozpor, netreba meniť.

## 7. Revízia 11. 9. 2026 — povinné riadky a čo s tým

Tabuľka v poradí, ktoré žiada `PROMPT-review` §2 (pojem · klauzula/LOIN · náš typ/pole · stav · miesto v kóde · čo s tým). Riadky nad rámec §1–§4 sú len tam, kde revízia priniesla nový dôkaz (suchý beh IDS, scenáre editora); klauzuly sú stále z vaultu, nie z noriem (§0).

| Pojem normy | Klauzula / LOIN | Náš typ / pole | Stav | Miesto v kóde | Čo s tým |
|---|---|---|---|---|---|
| PAS 1958 trigger event → use case | 6.1.3, obr. 23/24 · LOIN-01:52, :177; LOIN-02:90 | `UC.spustacia_udalost` (impact) → `UC`; `ER.spustacia_udalost` (delivery) | **sedí** (hrana); **medzera**: filter *objekt* z impact eventu | `typy/uc.py`, `typy/ev.py`; validátor C1/C2; `retazec.py` (`spusta`) | nič v schéme; filter objekt až pri PROJ (dosadenie), nie v knižnici |
| PAS 1958 delivery vs. utilization task | 6.2.1 · LOIN-01:78; LOIN-09:70 | `UC.ulohy[].typ`, `UC.typ_ulohy` = sumár poskytovateľov (V6) | **sedí** | `typy/uc.py`; validátor C-rady | nič |
| PAS 1958 impact events (tab. 2) | tab. 2 · **obsah tabuľky vo vaulte nie je** (LOIN-01:177 len pojem) | `EV.typ_udalosti: impact`, `EV.vyvolava` | **sedí** ako hrana, **neoveriteľné** ako katalóg | `typy/ev.py` | doplniť tab. 2 lokálne (Q31); dovtedy nič |
| PAS 1958 information requirement | pojem *vo vaulte nie je* (len *information specification* 6.3.2 a 19650-1 3.3.2) · LOIN-01:35 | rozklad ER (čo) × EV (kedy) × forma (ako) × ACT (pre koho) | **medzera v dôkaze**, nie v modeli | `typy/er.py` | čakať na plný text PAS |
| PAS 1958 deliverable | pojem *vo vaulte nie je* · LOIN-05:23, :50 | `IU-C` (kontajner) | **medzera v dôkaze** | `typy/iu_c.py` | O7 (hrana IR → deliverable) ostáva otvorené, nepridávať |
| OIR → AIR → PIR ↔ use case | 19650-1 5.2–5.5, PAS 6.3 · LOIN-02:16–27, LOIN-01:31, LOIN-09:69 | `GOAL.prispieva_k`, `UC.podporuje_ciel`; tranzitívne `IU ← task ← UC ← GOAL` | **sedí**; priama hrana IR → deliverable **nedoložená** (§5) | `retazec.py` (`ciele`), `inspektor.dopad_zmeny` | `podporuje_ciel` + `prispieva_k` stačia, kým klauzula nevyžiada priamu hranu (O7) |
| 29481-1 use case (3.3.2) | LOIN-01 (29481-1 3.3.2), LOIN-07:20 | `UC`; sub-UC = poznámka, 1 sub-UC = 1 `idm` | **sedí** | `typy/uc.py`; export F4 | export drží `uc` 1:1 per `idm` |
| 29481-1 exchange requirement (3.3.10) = UC × udalosť × príjemca | LOIN-01, LOIN-07:27; 29481-3 `er` 0:1 | `ER` (`uc` práve 1 — C3, `spustacia_udalost` ≥ 1 — C2, `prijemca`, `obsahuje` ≥ 1) | **sedí**; **nález S5**: nová ER zo šablóny tieto tri polia nepýta a stránka ich skrýva ako „nevyplnené" | `zapis.vytvor`, `app.html` (`vsetkyPolia`) | dialóg novej poznámky pýta aj polia s pravidlom C (validátor ich žiada), alebo stránka ukáže skryté pole, keď naň padá diagnostika (REVIEW §1.5) |
| 29481-1 precondition (5.5.1) | LOIN-07:31 (29481-3 má len `subEr`) | `ER.precondition` (iný ER), `ER.referencne_info` | **sedí** v modeli, **medzera v 29481-3** | `typy/er.py` | export: `precondition` → `subEr` alebo text; nič v schéme |
| 29481 task · informationUnit / subInformationUnit · actor · businessRule | LOIN-03 §8, LOIN-07:20–31 | `UC.ulohy`; `IU-C` ↔ `informationUnit`, `IU-O` ↔ `subInformationUnit`; `ACT` + roly; `DEF` + `UC.pravidlo` | **sedí** (task je medzera v norme, nie u nás) | `typy/*`, export F4 | nič |
| `idm` ↔ sub-UC 1:1 | LOIN-03 §8, LOIN-07:20 | `UC.nadradeny_uc` (strom UC) | **sedí** — export ešte nie je (F4) | — | F4: jeden `idm` na list UC |
| 7817-1 §5: LOIN určený účelom, míľnikom a aktérom | 7817-1 5.2–5.4 · LOIN-01:27–33 | `IU-O` ← `ER.obsahuje` (účel cez `ER.uc`, míľnik cez `ER.spustacia_udalost`, poskytovateľ cez `ER.poskytovatel_predvoleny` / `IU.poskytovatel`) | **sedí** per ER; **nejednoznačné** pri jednotke v dvoch výmenách (`IU-O-storey` v ER-0101 aj ER-0102 po S5) — LOIN je vtedy per (ER, IU), nie per IU; `ER.prepisy` to nesie | `retazec.retazce_pre` (dve pozície), `inspektor.povod_hodnoty(er_id)` | v UI je to už tak (prepínač stromov, Odkiaľ v kontexte výmeny); do NORMS-GAP dopísané ako pravidlo: **LOIN žije na dvojici (ER, IU), nie na IU** |
| 7817-3 `SpecificationPerObjectType` | LOIN-04:70–99 | `IU-O` | **sedí** | `typy/iu_o.py` (`export=`) | nič |
| 7817-3 geometrické aspekty (Annex B) | LOIN-04:94–99 | `IU-O.geometria` enumy §14 | **sedí doslovne**: ShapeAssembly, ShapeRepresentation, ShapeInfluence.*, Dimensionality, Appearance, ParametricBehaviour {NotRequested, Requested}, PositioningType — porovnané položka po položke s LOIN-04 (Annex B v repe nie je) | `typy/iu_o.py` `Geometria`, SCHEMA §14 | nič; riziko CD (namespace, nekonzistentný enum) ostáva |
| 7817-3 `AlphanumericalInformation/Property` | LOIN-04 §9 | `IU-O.alfanumerika[]` (`ifc.pset/nazov`, `datovy_typ`, `hodnoty`, `rozsah`) | **sedí** — medzeru zavrel `datovy_typ` (v1.4, V24); IDS `@dataType` sa už nehádá, číta sa z položky | `typy/iu_o.py` `Polozka.datovy_typ`, `validator/d_iu_o.py` D20 | uzavreté (Q35, odpoveď a); zhodu s IFC 4.3 šablónou overí F4 cez ifcopenshell (D4) |
| 7817-3 `Documentation/Document @type/@form/@content` | LOIN-04:91 | `IU-O.dokumentacia[].dok` → `IU-C` (`druh`, `forma.format`) | **sedí** (rozdelené: typ/forma na kontajneri) | `typy/iu_o.py`, `typy/iu_c.py` | export F4 skladá atribúty z IU-C |
| 7817-3 `InformationDeliveryMilestone` (@Date) | LOIN-04:63, :125 | `EV` delivery cez `ER.spustacia_udalost`; dátum až `PROJ` | **sedí** (dátum je dosadenie, V19) | `typy/ev.py`, `typy/proj.py` | nič |
| 7817-3 `Actor @affiliation`, `EMail` | LOIN-04:64 | `ACT` (strana → tím → funkcia); e-mail nie je | **medzera (suchý beh IDS)**: `ids:info/author` má vzor e-mailu, `ACT` kontakt nemá | `typy/act.py` | Q37: kontakt až v `PROJ` (dosadenie) — knižnica ho nenesie (V19) |
| IDS 1.0 applicability z `objekt + klasifikacia + filter` | SCHEMA §4, PLAN F4 | `IU-O.objekt`, `klasifikacia[]` bez `povinnost`, `filter[]` | **uzavreté (V25)**: klasifikácia s `povinnost` ide do `requirements` s `cardinality`, bez nej ostáva v applicability; priestor bez CCI je teraz nález, nie ticho | `dry_run_er0101_arch.py` (`classification_facet`), `validator/d_iu_o.py` D21 | rozhodnuté 12. 9. podľa IDS 1.0 (applicability = výber, requirements = tvrdenie); 7817-1 to nerozporuje, 29481-1 nerozhoduje |
| IDS requirements z položiek s `overenie: IDS` | SCHEMA §14b, PLAN F4 | attribute / property facet, `hodnoty` → enumeration, `vzor` → pattern, `rozsah` → bounds, `povinnost` → cardinality | **sedí** — 8 špecifikácií, 9 attribute + 6 property + 3 partOf, XSD 1.0 **prešlo** | `tests/fixtures/ids/ER-0101_ARCH.ids` | `vzor` s `^…$`: XSD pattern je ukotvený, kotvy treba odstrániť — Q38 (dialekt regexu) |
| IDS partOf pre členenie | SCHEMA §9, PLAN F4 | `STD-CL-01/03/04` (`plati: vzdy`, `zapnute::`) → partOf; `IU-O.clenenie` je vo vzore prázdne | **sedí**; bez `zapnute:: [[STD-CL-04]]` by chýbal partOf priestor → zóna | `dry_run_er0101_arch.py` | zadanie §2 „len `plati: vzdy`" je neúplné — zapnuté pravidlá patria do IDS |
| IDS `minOccurs/maxOccurs` z `pritomnost_v_modeli` | SCHEMA §7 | `IU-O.pritomnost_v_modeli` → `minOccurs` 1 / 0 / `maxOccurs` 0 | **sedí** | `dry_run_er0101_arch.py` | nič |
| IDS `ids:info/author`, `ifcVersion` | IDS 1.0 XSD | `ACT` (bez e-mailu), `ER.forma.verzia_schemy: IFC4X3_ADD2` | `ifcVersion` **sedí**; `author` **medzera** (viď `@affiliation`) | — | Q37 |
| STD pravidlo × poskytovateľ | SCHEMA §3 | `STD-CL-0x` nemajú `poskytovatel` — pri cieli (ER × poskytovateľ) nie je dané, do ktorého IDS pravidlo patrí | **medzera** | `dry_run_er0101_arch.py` (zaradenie podľa zhody entity) | Q39: pravidlo ide do IDS každého poskytovateľa, ktorého IU-O má rovnakú entitu (návrh), alebo `STD.poskytovatel` |
| `PredefinedType` — nositeľ | SCHEMA §4, §7 | `objekt.predefined_type` (prázdne) **aj** položka `alfanumerika[PredefinedType]` s výčtom | **duplicitný nositeľ** (MODEL §2) | `typy/iu_o.py` | Q40: entity facet nesie `predefinedType` len keď je práve jeden; výčet ostáva položkou |

### 7.1 Suchý beh IDS pre ER-0101 × ARCH (dôkaz)

`python tests/fixtures/ids/dry_run_er0101_arch.py` → `tests/fixtures/ids/ER-0101_ARCH.ids` (deterministický, 14 474 B), **validácia `xmlschema` proti oficiálnemu `ids.xsd` 1.0.0 prešla bez chýb** (prekontrolované 14. 9. po V27: objekty berie skript cez priradenia kontajnerov, výstup je bajtovo rovnaký). XSD sa sťahuje do `tests/fixtures/ids/.cache/` (necommituje sa, ako žiada QUESTIONS odpoveď 9). Obsah: 8 špecifikácií = 3 IU-O (space, storey, zone) + 5 STD (CL-01, CL-03, CL-04 zapnuté ER-om, CL-05, CL-06); STD-CL-02 vynechaný (abstraktná `IFCELEMENT`, V5 čaká na IFC schému). Mimo IDS (správne): 2 × IU-C, dokumentácia, geometria (`overenie: manual`). Bez IDS protistrany (zahodené): `zavaznost`, `rola`, `povaha`, `tolerancia`, `dolozene_v`, `definicia_ref` — posledné dve by šli aspoň do `instructions`. `objekt.uri` sa stráca (entity facet v IDS 1.0 nemá `@uri`).


## 8. PAS 1958 6.3.2 / 6.3.3 — chýbajúce spojivo medzi IDM a LOIN (kolo 4)

**Pôvod:** klauzuly cituje Samuel v zadaní kola 4 z plného textu PAS 1958:2026 vo svojom vaulte (`20_Resources/PAS 1958 2026 - Data and information standards landscape.md`). **V tomto repe plný text nie je** (`docs/vault/` má len sériu LOIN-00…09, `docs/normy/` je placeholder), takže ani tieto riadky sa tu nedajú overiť proti norme — sú to citácie z druhej ruky, presne ako zvyšok tohto dokumentu (§0).

| Klauzula | Čo hovorí | Náš nositeľ | Stav |
|---|---|---|---|
| **6.3.2.1 a** | výmena (ER) je **kolekcia informačných jednotiek** podľa 29481-1 | `ER.obsahuje` (po V27 kontajnery) + priradenia kontajnerov | **sedí** — C12 žiada ≥ 1 jednotku; C13 hlási objekt, ktorý nenesie žiadny kontajner |
| **6.3.2.1 b** | informačné jednotky **štruktúruje rámec LOIN** podľa 7817-1 | `IU-O.geometria / alfanumerika / dokumentacia`; `IU-C.obsahuje[].rozsah` | **sedí od V27** — dovtedy sa rozsah aspektov nedal povedať a dokumentačný kontajner „niesol" celý LOIN objektu |
| **6.3.2.1 c** | ER + predpoklady LOIN = informačné požiadavky | ER + IU-O + STD pravidlá (`plati: vzdy` / `zapnute`) | **sedí** |
| **6.3.2.1 d** | požiadavky sa **zoskupujú podľa účelu užitia** podľa 29481-3 | `ER.uc`, reťazec ako strom per účel (V23) | **sedí** |
| **6.3.2.1 e** | požiadavky filtrované pre výber dodávateľa = **EIR** | typ `PROJ` (mimo knižnice, V19) + pásmo „Pre koho a dokedy?" ako šev (U6) | **sedí** (neimplementované, vedome) |
| **6.3.2.1 f** | impact udalosť iniciuje účel užitia | `UC.spustacia_udalost` (len `impact`, C2) | **sedí** |
| **6.3.3 a** *unit constraints* | či jednotka bola dodaná | `pritomnost_v_modeli`, `povinnost`, `dokumentacia[].povinnost`, `klasifikacia[].povinnost`, `facet.cardinality` | **sedí, po V26 aj pomenované** (`trieda_obmedzenia: pritomnost`) → IDS `minOccurs/maxOccurs`, `cardinality` |
| **6.3.3 b** *data value constraints* | explicitné hodnoty, výčty, syntax, rozsahy a metadáta (dátový typ, veličina, jednotka) | `hodnoty`, `hodnoty_ref`, `vzor`, `rozsah`, `datovy_typ`, `tolerancia`, `jednotka`, `velicina` | **sedí, po V26 aj pomenované** (`trieda_obmedzenia: hodnota`) → facet, `xs:pattern`, `xs:enumeration`, bounds, `@dataType` |
| **6.1.3** | impact udalosť iniciuje projekt, delivery udalosť iniciuje úlohy | `EV.typ_udalosti`, C2, C8 | **sedí** (potvrdenie existujúceho modelu) |
| **6.2.1** | úlohy sa delia na dodanie a použitie | `ulohy[].typ`, sumár `typ_ulohy` (V6); v reťazci dve skupiny (U17) | **sedí** |
| **7.1.2 / 7.1.3** | informačné sety (modely, kontajnery) sú oddelené od objektov | rozdelenie IU-C / IU-O; priradenie ako spojenie dvoch osí (V27, LOIN-05 §11.1) | **sedí** — po V27 aj v UI (zrušená hranica 29481/7817, U18) |
| **6.3.3** *„obe triedy naviazané na konkrétnu jednotku"* | obmedzenie vždy patrí jednotke | položka je vnútri IU-O, priradenie vnútri IU-C | **sedí**; otvorené ostáva, či `rozsah` priradenia môže obmedziť aj *hodnotu* (dnes nie — zužuje len aspekty), viď QUESTIONS Q47 |

**Dôsledok:** dátový model je s PAS v súlade; zmenili sa dve veci v schéme (V26, V27) a zobrazenie (U17, U18). Žiadne tvrdenie z tejto tabuľky sa nesmie prepísať do SCHEMA ako „norma hovorí", kým plný text nie je overiteľný — SCHEMA cituje klauzulu a odkazuje sem.
