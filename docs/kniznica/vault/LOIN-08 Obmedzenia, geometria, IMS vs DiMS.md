---
name: LOIN-08 Obmedzenia
description: Hodnoty v LOIN, obmedzenia pre všetky tri zložky, GEO profily ako presety, rozsah objekt/kontajner/federácia — sekcia 16
status: v1.1 (2026-09-09)
cast_serie: "[[LOIN-00 Index]]"
origin: ai
verified:
---


# 16. Obmedzenia bez prekomplikovania: hodnoty v LOIN, geometria a dokumenty, IMS vs. DiMS

## 16.1 Korekcia 6.2a — hodnoty v LOIN sú v poriadku
- 7817-3 `Property/DataType/PossibleValues` je *súčasť* alfanumerickej zložky → výčet prípustných hodnôt (REI 30/60/90/180) je legitímny obsah LOIN riadku a priamo = IDS `xs:enumeration`.
- LOIN je **podklad pre neskoršiu verifikáciu** (7817-1 kap. 7; 19650-4 7.6). Ak sa niečo dá overiť IDS, patrí to sem.
- Pravidlo „nikdy konkrétna hodnota" sa **ruší**; nahrádza ho jediný voliteľný tag na hodnotovom obmedzení: `zdroj: informacny | technicky`. Informačný = pravidlo tvorby informácie (enum, formát, status ∈ {Existing, New}); technický = hodnota daná návrhom (REI 60 z požiarneho konceptu). Oboje overuje IDS rovnako; tag len drží trasovateľnosť. Nič viac.

## 16.2 Obmedzenia pre všetky tri zložky (jednotný tvar)
Každá zložka LOIN má `obmedzenia:` ako zoznam `{typ, hodnota, overenie}`:

| Zložka | Typy obmedzení | Overenie |
|---|---|---|
| **Alfanumerika** | prítomnosť · dátový typ · jednotka · enum/rozsah/pattern · odkaz na definíciu (`DEF`/`Property.Definition`) | IDS |
| **Geometria** | **profil** (G0–G3 = pomenovaný balík 7817-3 enumov: ShapeAssembly, ShapeRepresentation, ShapeInfluence…, Dimensionality, Appearance, ParametricBehaviour, Location) · voliteľný `Dictionary` (7817-3 `Detail/Dictionary`, napr. BIMForum LOD) · **účel, ktorý má splniť** (napr. „G3 = presnosť podľa vyhlášky 131/2024 pre DPS") · tolerancia/presnosť ako metadáta | rule-set model checkeru (typ reprezentácie, placeholder, otvory, zóny, materiál, umiestnenie); IDS nie |
| **Dokumentácia** | prítomnosť · formát + verzia (7817-3 `Format`) · pomenovanie · metadáta CDE (status/revízia) · ukotvenie (`viaze_sa_na`) · štruktúra (kapitoly podľa vyhlášky) · **obsah = manuál** | CDE/skript; `IfcRelAssociatesDocument`; obsah manuál |

**Konsenzus literatúry** (Abualdenien & Borrmann, ITcon 2022, kritický prehľad): LOD dominuje v praxi (58 % publikácií), ale existuje ≥7 nekompatibilných národných variantov (LOD/LoD/LOI/MDG/Level of Definition…); EN 17412/ISO 7817 to rieši rozkladom na nezávislé aspekty viazané na účel. Praktický dôsledok: **pomenované profily (G0–G3) ostávajú pre zmluvu, ale definujú sa ako balík 7817-3 aspektov per typ objektu a účel** — nie ako globálna stupnica. 7817-3 to umožňuje priamo cez `Detail/Dictionary`. (Nový návrh „LOINxml", jún 2026, ide rovnakým smerom — sledovať.)

## 16.3 IMS vs. DiMS — rozsah obmedzenia
Každé obmedzenie nesie **`rozsah`** (scope):

| `rozsah` | Čo obmedzuje | Príklady | Overenie |
|---|---|---|---|
| **objekt** | výskyt/typ vo vnútri DiMS | `Name` ~ `^VZT-\d{2}-\d{3}$`; vlastnosti; členenie ∈ IfcSpace | IDS (per súbor) |
| **kontajner (DiMS)** | jeden čiastkový model / dokument | konvencia ID kontajnera (projekt-pôvodca-objem-podlažie-typ-rola-číslo); formát IFC 4.3; max. veľkosť; zakázané entity (v ARS žiadne TZB); CRS v `IfcProject` | skript nad súborom; IDS prohibited |
| **federácia (IMS)** | *množina* DiMS, ktorá musí do seba zapadnúť | identické názvy a výšky podlaží; jeden CRS a základný bod; unikátne GUID naprieč; zóny/systémy pomenované rovnako vo všetkých DiMS; priestory len v ARCH; cross-file containment; kolízie | cross-file skript / ETL; clash tool; **nie IDS** |

**Naming je tri rôzne veci:** (1) ID kontajnera — `rozsah: kontajner`, zdroj = container breakdown v `STD-`; (2) `Name` objektu — `rozsah: objekt`, zdroj = `PROP`/`businessRule`; (3) zdieľané slovníky, ktoré musia byť identické naprieč DiMS (podlažia, zóny, systémy, klasifikácia, CRS) — `rozsah: federacia`, zdroj = `STD-`. Tvoja EIR to už delí (kap. 3.3 federácia/naming vs. 3.4 modelovacie pravidlá); model to len robí explicitným.

IMS je **pohľad, nie dodávka** (rozhodnutie 14.1) → obmedzenia `rozsah: federacia` sa overujú nad množinou DiMS pri akceptácii, nie na súbore. Autorujú sa v `STD-`; ER ich len aktivuje (`plati_pre_federaciu:: [[STD-…#podlazia]]`).

## 16.4 Otvorené
- [x] Profily G0–G3 → **rozhodnuté (2026-09-09): enumy sú pravda, profil je preset.** Zdroj pravdy na IU-O = 7817-3 aspekty (každý samostatne, `@placeholder`) + `poznamka {zahrna: [], nezahrna: [], text}`. `GEO-Gx` v `STD-` = pomenovaná predvoľba, ktorá aspekty predvyplní; IU-O `geometria_profil:: [[GEO-G2]]` + prepisy; explicitný aspekt poráža profil. Export: label + rozbalená tabuľka (záväzný je obsah, nie label). ~4 globálne presety, nie per typ objektu; ak >⅓ IU-O prepisuje, presety prekrojiť. Dôvod: 7817-1 6.2 vyžaduje nezávislé aspekty; manuálne overenie potrebuje presné kritérium (Abualdenien & Borrmann 2022 o zlyhaní LOD ako globálnej stupnice).
- [x] Federačné obmedzenia → **rozhodnuté: STD píše, ER zapína**; pravidlá s `plati: vzdy` platia automaticky, `na_vyziadanie` zapína ER.
- [ ] Tag `zdroj: informacny|technicky` — rozhodnúť pri vzore (voliteľný).

---