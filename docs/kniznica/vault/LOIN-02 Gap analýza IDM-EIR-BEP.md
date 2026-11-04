---
name: LOIN-02 Gap analýza
description: Normatívny reťazec IDM→EIR→BEP/MIDP, čo vault pokrýva, 19 chýbajúcich prvkov, minimálny model, schémový základ a UCM — sekcia 7
status: v1.1 (2026-09-09)
cast_serie: "[[LOIN-00 Index]]"
origin: ai
verified:
---


# 7. Gap analýza: IDM (vrátane LOIN) → EIR → BEP / MIDP

## 7.1 Normatívny reťazec (čo musí systém pokryť)

```
OIR / AIR / PIR  (19650-1 5.2–5.5; PAS 1958 6.3 info specification)
      │  účely, spúšťače, filtre
      ▼
IDM  = UC + business context + ER{IU + LOIN + constraints}   (29481-1/-3, 7817-1)
      │  filter: aktér + milník (+ objekt)                   (PAS obr. 24)
      ▼
EIR  (19650-2 5.2.1) = pre každý požiadavok:
      a) požiadavka (z OIR/AIR/PIR)      b) LOIN
      c) akceptačné kritériá             d) podporné informácie
      e) dátumy voči milníkom / KDP
      + informační standard (5.1.4) + metódy a postupy (5.1.5)
      + referenčné info a zdieľané zdroje (5.1.6) + CDE (5.1.7) + protokol (5.1.8)
      ▼
(pre-)BEP (5.3.2 / 5.4.1): stratégia dodávania, federačná stratégia,
      matica zodpovednosti (high-level → podrobná 5.4.2), SW/HW, zmeny štandardu
      ▼
TIDP (5.4.4) per kontajner: názov, predchodcovia/nadväznosti, LOIN,
      odhad prácnosti, autor, míľniky  →  MIDP (5.4.5) = zlúčenie + dátumy
      ▼
výmena informácií (19650-4 kap. 7: CDE, conformance, continuity,
      communication, consistency, completeness-vs-LOIN, other)
      ▼
akceptácia → PIM → AIM (19650-2 5.7–5.8; 19650-3)
```

## 7.2 Čo vault pokrýva dobre
7817-1 · 19650-1/2/3/4/5/6 · 29481-1/2/3 · PAS 1958 · CEN/TR 18093 · IDS 1.0 (+ limity) · IFC 4.3 poznámky (Space, Zone, Storey, DocumentReference, Classification, Constraint/Objective/Metric, DistributionSystem…) · ISO 81346-1/-12 (RDS) · DSS + CZ zákon 330/2025 · SK stavebný zákon 25/2025 · reálna anonymizovaná EIR + BIM protokol šablóna (Príloha A.1 / A.2 s RACI, MIDP, TIDP) · DIKW/verifikácia-validácia · cross-file containment / ICDD · oficiálny vzor IDM (príloha B 29481-1) · UCM use cases.

## 7.3 Chýbajúce alebo slabo pokryté prvky

| # | Chýba / slabé | Zdroj | Dôsledok pre model | Priorita |
|---|---|---|---|---|
| 1 | **Ciele (objectives) nad use cases** | 19650-2 5.3.2 b; tvoja EIR kap. 2.1 "Ciele" → 2.2 "Účely"; inbox "ako merať úspešnosť cieľov BIM" | pole `podporuje_ciel:: [[GOAL-…]]` na UC; GOAL nesie KPI | vysoká |
| 2 | **Projektový informační standard ako entita** | 19650-2 5.1.4 (vrátane "metoda přiřazování LOIN"); CEN/TR 17654 príl. D | `STD-` poznámka: klasifikačný systém, naming/ID kontajnerov, jednotky, CRS, status/revision kódy, meracie definície `DEF-`; EIR kap. 3 = výstup | vysoká |
| 3 | **Akceptačné kritériá per požiadavka** (≠ LOIN, ≠ constraint) | 19650-2 3.1.1.1 "doklady požadované pro prokázání", 5.2.1 c; 19650-4 kap. 7 | IU pole `akceptacia` = {kritérium podľa 19650-4 (7.1–7.7), dôkaz, kto overuje} | vysoká |
| 4 | **Slovník vlastností / dátové šablóny** | 7817-1 6.3.1 (ISO 23387), PAS 7.1.7–7.1.8, DSS datový slovník, bSDD, CAFM-Connect | `PROP-` poznámka (názov, dátový typ, jednotka, enum, URI do bSDD/DSS); IU alfanumerika odkazuje na PROP, nie voľný text; ISO 23387/23386 nie sú vo vaulte | vysoká |
| 5 | **Referenčné informácie a zdieľané zdroje** | 19650-2 5.1.6, 5.2.2; PAS 6.3.4; 29481-1 preconditions | ER/UC pole `referencne_info:: […]`; = vstupy delivery úloh; TIDP predchodcovia | stredná |
| 6 | **Matica zodpovednosti (RACI)** | 19650-1 10.3; 19650-2 5.3.2 d, 5.4.2, príl. A; tvoja A.2.c | aktér na IU/kontajneri musí niesť rolu R/A/C/I + 19650-4 provider/receiver/reviewer; RACI = generovaný pohľad IU × aktér | stredná |
| 7 | **TIDP polia na kontajneri** | 19650-2 5.4.4 | vrstva B: `predchodca`, `nadvaznost`, `odhad_pracnosti`, `autor_tim`, `milnik`; dátumy až v inštancii (MIDP) | stredná |
| 8 | **Federačná stratégia + container breakdown** | 19650-1 10.4, príl. A; 19650-2 5.3.2 c, 5.5.3; tvoja A.1.b | `CBS-` (container breakdown) ako súčasť STD alebo BEP: priečinky, priradenie úlohovým tímom, max. veľkosť, bezpečnostné oddelenie | stredná |
| 9 | **Register míľnikov / udalostí** | 19650-2 5.1.2–5.1.3 (KDP); 19650-3 príl. A (trigger events); PAS impact/delivery events; ISO 22263 ↔ SK/CZ stupne PD | `EV-` register; mapovacia tabuľka fáz je prerekvizita pre UC | stredná |
| 10 | **Typ vs. výskyt; klasifikácia vs. identifikácia** | 7817-1 6.3.2; 81346; IDS applicability; inbox otázka | IU pole `uroven: typ \| vyskyt`; `identifikacia` (RDS/kód) oddelene od `klasifikacia` | stredná |
| 11 | **Overenie: nástroj + metóda** | inbox: "akou funkciou v akom nástroji plníme a ako overíme"; IDS limity; RASE (Nisbet) pre textové/regulačné požiadavky | IU pole `overenie: {metoda: IDS\|pravidlo\|manual, nastroj, pravidlo_id}`; constraint typ podľa PAS (prítomnosť/hodnota) + RASE (R/A/S/E) pre predpisy | stredná |
| 12 | **Forma výmeny / schéma** | PAS aspekt d "exchange method"; 19650-4 A.1–A.2; 29481-1 EVD | ER pole `forma:: {formát, verzia schémy, IDS/MVD}` | nízka–stredná |
| 13 | **CEN/TR 17654 (EIR/BEP guideline)** | nie je vo vaulte | šablóny EIR/BEP/IDP + odporúčaný info standard — priamo náš cieľ; obstarať | vysoká (zdroj) |
| 14 | **CEN/TR 17741 (IDM guidance), UK BIM Framework Guidance Part D (information requirements) a Part F (IDP)** | nie sú vo vaulte (sú len Guidance 0–3) | doplniť ako zdroje pre OIR→AIR→PIR→EIR kaskádu a IDP | stredná (zdroj) |
| 15 | **ISO 12911 (framework for specification of BIM implementation)** | nie je vo vaulte; PAS ho cituje pre use cases a criteria | zdroj pre štruktúru "BIM guide" = GOAL/UC | nízka |
| 16 | **Akademické precedensy editora** | Liu/Hagedorn/König 2023 (LOIN+ICDD ontológia pre kontajnerové EIR); Akbas et al. 2025 ITcon (LOIN+IDS); MDPI 2025 (tabuľkové IR → IDS); Mellenthin Filardo 2023/24 (XML IR import do ArchiCAD); LDAC 2024 ontology network | prečítať pred zamrazením názvov polí — najmä LOIN ontológiu (názvy tried pre 5 geometrických aspektov) a IDS mapping | vysoká (pred v1 schémou) |
| 17 | **Benchmark nástrojov** | BIMQ (AEC3): LOIN-based knižnica → katalógy → projekty, export IDS + property templates do Revit/ArchiCAD/Allplan + PDF do EIR/BEP; Plannerly (BEP/IDS); dRofus (room & equipment requirements — priamo pasportizácia priestorov); Glider; dotBEP | definovať odlišnosť: otvorený MD/git, IDM-first (use case ako koreň), kontajnerová/dokumentačná vrstva, CZ/SK legislatíva, ICDD ako výstup | stredná |
| 18 | **Bezpečnosť (19650-5)** | vo vaulte, ale v modeli len `zverejnenie` | klasifikácia citlivosti na kontajneri (STD) | nízka |
| 19 | **Spätná väzba / lessons learned** | 19650-2 5.8.2; PAS 6.3.6.2.1 (specification response) | proces: projektová inštancia → návrhy zmien do knižnice (git PR) | nízka |

## 7.4 Upravený minimálny model v1 (po gap analýze)

```
GOAL-  ciele organizácie / aktíva (+ KPI)                ← nové (#1)
UC-   use case (aim/scope, aktéri-roly, fázy → ER, podporuje_ciel)
ER-   exchange requirement (zoznam IU, precondition, referencne_info, forma)
IU-   informačná jednotka (typ objekt|kontajner|dokument, uroven typ|vyskyt,
      LOIN polia, PROP odkazy, constraint, akceptacia, overenie, väzby)
PROP- vlastnosť (dátový typ, jednotka, enum, URI bSDD/DSS)   ← nové (#4)
DEF-  meracia/hodnotová definícia (podmnožina PROP alebo samostatne)
STD-  informačný štandard (klasifikácia, ID/naming, jednotky, CRS,
      status/revision kódy, container breakdown)             ← nové (#2, #8)
EV-   míľniky / udalosti + mapovanie fáz ISO 22263 ↔ SK/CZ     ← nové (#9)
```
Generované pohľady (nie entity): **EIR** (ER × aktér × EV + STD + akceptácia), **RACI** (IU × aktér), **TIDP/MIDP** (kontajnerové IU + dátumy), **IDS** (IU alfanumerika × PROP), **ICDD** (kontajnerové IU + väzby).

Odložené: BPMN/interaction mapy, impact-event katalóg, bezpečnostná klasifikácia, KPI meranie, feedback workflow.

## 7.6 Schémový základ, udalosti, UCM (doplnené)

- **ISO 29481-3 = schémový základ** (PAS 1958 obr. 15: spája use case 6.2.2, business context 6.2.3, information criteria 6.3.2, information constraints 6.3.3). Vo vaulte: `ČSN EN ISO 29481-3 2023 - Schéma dat a kód.md` + inštancia z prílohy B 29481-1. Pokrýva kostru UC→BCM→ER→IU/constraint, nie LOIN, kontajnery, akceptáciu, ciele.
- **ISO/DIS 7817-3 "Data model and schema"** je v enquiry fáze (DIS): UML + XSD pre LOIN, **v súlade s ISO 23387 (dátové šablóny)**. → vrstva PROP musí byť tvarovaná podľa 23387 (data template / property / group), inak nebude kompatibilná s 7817-3. DIS obstarať cez ÚNMZ/ÚNMS ako návrh. ISO/DIS 19650-1:2026 (7.2.2) LOIN explicitne viaže na 7817-1.
- **Udalosti (PAS 6.1.3, 6.3 f, obr. 21/23/24):** impact event je *mimo* IDM a **iniciuje use case(s)**; zároveň definuje filter *objekt* (subject of impact event). Delivery event iniciuje *delivery tasks* v business contexte (zoskupené do work stages). Míľnik je *prerekvizita/filter*; v 29481-3 existuje ako `standardProjectPhase → associatedEr`. Väzba impact→delivery event (PAS tab. 2, 19650-3 A.3) je organizačná (risk mgmt), nie IDM. → `EV-` register mimo idmXML: `typ: impact | delivery | milnik`; UC `iniciovany:: [[EV-impact]]`; aktivita v BC `spustena:: [[EV-delivery]]`; ER `milnik:: [[EV-milnik]]` cez mapovanie fáz; EV-impact `vyvolava:: [[EV-delivery]]`.
- **bSI UCM:** PAS ho cituje iba ako zdroj príkladov use cases (ref. [6]). Je to kolaboračná/publikačná platforma na IDM metodike (UC → ER, BPMN, súbory), nie schéma; export do idmXML nepotvrdený. Rola u nás: seed knižnice + kompatibilná štruktúra polí (už zapracované v 1.3a) + prípadná publikácia cez bS chapter.

---

## 7.5 Odporúčané poradie
1. Prečítať Liu 2023 + Akbas 2025 (názvy polí LOIN/IDS) a obstarať CEN/TR 17654 + ISO/DIS 7817-3.
2. Zamraziť polia IU + PROP + STD (v1).
3. Vzory: GOAL-01, EV register, UC-0100/0101, ER-0101, 5× IU, 2× DEF, 3× PROP.
4. Dataview pohľady: EIR, RACI, TIDP.
5. Až potom UC-0201 (nájmy) ako utilization test.

---