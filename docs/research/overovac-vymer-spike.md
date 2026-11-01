# Overovač výmer voči geometrii: návrh a spike na IfcSpace

**Druh:** výskum a spike (nie produkčný kód) · **Dátum:** 2026-11-01 · **Vetva:** `claude/research-property-provenance`
(draft PR #382) · **Nadväzuje na:** [`vlastnosti-povod-a-overenie.md`](vlastnosti-povod-a-overenie.md) (prvá analýza),
Samuelovo zadanie "overovač výmer voči geometrii" z 1. 11. 2026 (hĺbkový výskum: schéma IFC4.3, revit-ifc, ifc-lite,
IfcOpenShell/Bonsai, ifc-gherkin-rules) · **D-číslo:** D-185 (pridelil orchestrátor; záznam v `DECISIONS.md`, NÁVRH).

Zdroje dát: DB `acwoupricatirhlfkhvk` (len SELECT nad kópiou revízie `ifc_rev_*`, ASR v79) a motor cez existujúci
`ifc_measure` nad archívom revízie (D-135). Produkčný IFC sa nesťahoval, nič sa nezapisovalo. API extrúzií sa skúšalo
len na verejných a ručne zostavených testovacích súboroch.

Značky: **[overené]** = zmerané alebo prečítané v kóde v tejto session; **[zo zadania]** = tvrdenie z hĺbkového
výskumu, tu neoverované; **[hypotéza]**; **[nenájdené]**.

---

## 1. Zhrnutie

1. **Jadro overovača existuje** [overené]: `GeometryProcessor.extractExtrusionDefinitions(bytes, ids?)` je v
   `@ifc-lite/geometry` 7.8.1 (verzia, ktorú AIMviewer používa). Vracia slučky profilu (`signed_area`, `perimeter`,
   úsečky a oblúky), `Depth`, smer, `world_from_source` a `nominal_quantities` (`profile_area`, `projected_height`,
   `nominal_volume`) bez tesselácie. Na ručne zostavenom IFC4 (miestnosť v tvare L, mm) dalo presne 88 m2,
   40 m, 3,95 m, spodok z = 4,85 v IFC svete a 347,6 m3.
2. **API je prísne a nie univerzálne** [overené]: profil s medzerou vráti `status: unsupported` s dôvodom (verejný
   `building-architecture.ifc`: "profile loop has a gap after segment 6") a miestnosti ako `Brep` (AC20-FZK-Haus) nevráti
   vôbec. Overovač teda potrebuje náhradnú cestu (mesh) a sivý stav.
3. **ASR v79, 83 IfcSpace, výsledky receptov** (tabuľka v kap. 3):
   - `Height` = výška vlastného telesa pri 83/83; na 2NP až 4NP zároveň vrch dosky pod a spodok dosky nad.
   - `ElevationWithFlooring` = spodok telesa + `FinishFloorHeight` pri všetkých miestnostiach s FFH.
   - Každá hodnota `FinishCeilingHeight` (41 miestností) zodpovedá výške existujúceho podhľadu nad čistou podlahou
     (napr. 2NP 8,05 / 8,00 / 7,60 nad 5,00).
   - `GrossVolume` = `GrossFloorArea` x `Height` do 0,01 % pri 82/83 a = `Qto_BodyGeometryValidation.GrossVolume`
     pri 83/83.
4. **NetVolume, spresnená hypotéza** [overené číslom]: `NetVolume = GrossVolume - GrossFloorArea x (FinishFloorHeight
   + 12,5 mm, ak má miestnosť podhľad)` sedí **do 5 dm3 pri 51 z 83** miestností. Odčítava sa teda objem podlahoviny a
   dosky podhľadu (`Qto_CoveringBaseQuantities.Width` = 12,5) vnútri telesa miestnosti. Je to v súlade s definíciou
   schémy ("excluding the volume of construction elements inside the space"). Hypotéza zo zadania (od čistej podlahy
   mínus stĺpy) je tým spresnená: stĺpy nie sú potrebné na vysvetlenie, podhľad áno. Zvyšných 32 miestností má
   odchýlku od -0,97 do +5,8 m3 z dôvodov, ktoré sa dajú pomenovať (kap. 3.3); presný recept je prienik telies krytín
   s telesom miestnosti.
5. **Nálezy pre BCF** (overovač by ich chytil hneď):
   - dve totožné dosky SD02.03.0002 a SD02.03.0003 (8,80 až 9,05 m, pôdorys 660,065 m2, objem 165,016 m3);
   - technické miestnosti 1.05, 1.07, 2.14, 3.14, 4.01 bez `FinishFloorHeight`, hoci `ElevationWithFlooring` (-11,9 a
     -16,7 mm, 4988,1, 9188,1, 13388,1) a `NetVolume` ukazujú podlahu hrubú okolo 288 mm;
   - 16 miestností (1.04, 1.05, 1.08, 1.10, 1.12, 1.13, 1.14, 2.01, 2.02, 2.08, 2.11, 2.19, 3.02, 3.08, 3.11, 3.18) a doska SD02.03.0004 majú neuzavretý mesh (objem z meshu nejde, extrúzia áno).
6. **Akceptačné kritériá spiku pre 2.01:** Height, FinishFloorHeight a FinishCeilingHeight sedia na mm, GrossVolume na
   0,003 %. NetVolume má zvyšok -0,853 m3 (0,1 %), ktorý vysvetľuje len prienik krytín v pôdoryse. Kotvy (GUID a výšky
   plôch) sú v tabuľke 3.4. Úplný spike s `extractExtrusionDefinitions` priamo na ASR v79 tu nebežal, lebo by vyžadoval
   lokálny produkčný súbor (D-135); beží v motore (kap. 5, krok 1).

---

## 2. Overenie tvrdení zo zadania

| Tvrdenie zo zadania | Stav | Poznámka |
|---|---|---|
| `extractExtrusionDefinitions` je v ifc-lite od geometry 7.6.0, AIMviewer má 7.8.1 | **overené** | `dist/index.js` a `ifc-lite-bridge.js` v 7.8.1; typy v `rust/wasm-bindings/src/api/extrusion_definitions.rs` (fork Menezeris/ifc-lite `b6394f2`) |
| Výstup: slučky so `signed_area` a `perimeter`, `Depth`, `world_from_source`, `nominal_quantities`, `source_modified` | **overené** | plus `status` (complete / unsupported s dôvodom), `diagnostics`, `model_sha256`, `length_unit_scale`; jednotky zdroja = jednotky súboru, matice stĺpcovo |
| Bez tesselácie | **overené** (v kóde: "No mesh is decoded on this path") | rýchlosť na ASR neoverená |
| `MethodOfMeasurement` má byť `BaseQuantities` (QTY001) | zo zadania | AC20-FZK-Haus (ArchiCAD 20) má `'ARCHICAD BIM Base Quantities'`, takže autorské nástroje to nedodržiavajú; v ASR to nevieme (ETL ho nečíta, kap. 2.3 prvej analýzy) |
| Revit: `FinishCeilingHeight` nemá kalkulátor, je z parametra | zo zadania | ASR: všetky hodnoty FCH zodpovedajú výškam podhľadov, takže parameter je tu vyplnený dôsledne; overovač ich má merať, nie predpokladať |
| Revit: `GrossVolume` = najväčšia slučka x dĺžka extrúzie | **čiastočne vyvrátené** | platí pri 82/83; 2.20 Schodiskový priestor má GV 74,169 = mesh, ale GFA x H = 77,854 (-4,97 %), teleso teda nie je jednoduchá extrúzia plochy GFA |
| 2.01: Height 3950, FFH 150, FCH 3050, EWF 5000, GV 912,27 sedia | **overené** | kap. 3.4 |
| 2.01 mesh nie je uzavretý | **overené** | aj ďalších 15 miestností |
| NetVolume = GFA x (H - FFH) mínus 1 až 2 m3 | **spresnené** | kap. 1 bod 4 a kap. 3.3 |
| Miestnosť nemá vzťah k podlahám a podhľadom | zo zadania | prevzaté; priradenie musí byť geometrické |

---

## 3. Spike na ASR v79

### 3.1 Postup

- DB: `Qto_SpaceBaseQuantities`, `Qto_BodyGeometryValidation` a atribút `ElevationWithFlooring` všetkých 83 IfcSpace
  (`ifc_rev_property_sets`, `ifc_rev_objects`).
- Motor: `ifc_measure items` pre všetkých 83 miestností, 17 dosiek SD/DZ a 28 podhľadov + podlahovinu PD03.30.01
  (spodok, vrch, pôdorys, objem meshu, uzavretosť).
- Bez polohy v pôdoryse: tooly vracajú len rozmery obálky a výšky, `get_viewer_state bounds` v tejto session nejde
  (bez viewera, D-159). Priradenie dosky a podhľadu k miestnosti je preto **podľa výšky**, nie podľa prekryvu v
  pôdoryse; to je hlavné obmedzenie spiku.

### 3.2 Výsledky receptov (83 miestností)

| Recept | Výsledok | Poznámka |
|---|---|---|
| `Height` = vrch - spodok vlastného telesa | **83/83 zelená** | 1NP 4,90 (-0,30 až 4,60), 2NP 3,95 (4,85 až 8,80), 3NP 3,95 (9,05 až 13,00), 4NP 3,30 (13,25 až 16,55); šachty 4,20 a 5,80 |
| `Height` = spodok dosky nad - vrch dosky pod | 2NP až 4NP sedí podľa výšok (SD02.03.0001 vrch 4,85; SD02.03.0002 spodok 8,80; SD02.03.0004 13,00 až 13,25; SD02.02.0001 spodok 16,55) | 1NP: pod spodkom -0,30 nie je žiadna IfcSlab (DZ01.01.0002 má vrch -0,80), "doska pod" je iný prvok (napr. základová doska ako IfcFooting); šachty (2.15: 4,60 až 8,80) prechádzajú doskou, podľa definície by nemali Height |
| `ElevationWithFlooring` = spodok telesa + FFH | **všetky s FFH zelená** | 1NP -0,30 + 0,30 = 0; 2NP 4,85 + 0,15 = 5,00; 3NP 9,20; 4NP 13,40; šachty 1.24 až 1.26: -0,30 + 0,14 = -0,16 |
| `FinishCeilingHeight` = spodok podhľadu - čistá podlaha | **41/41 hodnôt má zodpovedajúci podhľad vo výške** | 1NP: 3,85 a 2,60; 2NP: 8,05 (3050), 8,00 (3000, PH01.10.0012 = presne pôdorys 2.13), 7,60 (2600); 3NP: 12,25 / 12,20 / 11,80. Prekryv v pôdoryse neoverený |
| `GrossFloorArea` = pôdorys telesa | 83/83 do 0,01 % | 2.01: 230,947 vs. 230,9544 |
| `NetFloorArea` | sivá pri 13 miestnostiach (WC, chodby) | NFA menšia ako pôdorys telesa (1.16: 2,893 vs. 3,057); odpočet nie je dierou v telese, metóda neznáma |
| `GrossVolume` = GFA x Height | 82/83 do 0,01 % | 2.20 -4,97 % (teleso nie je prizma) |
| `GrossVolume` = `Qto_BodyGeometryValidation.GrossVolume` | 83/83 rovnaké | kontrola exportnej konzistencie, nie receptu |
| `GrossVolume` = objem meshu | 67/83 (16 neuzavretých) | |
| Krížová kontrola `Height >= FFH + FCH` | 41/41 | medzistropie (H - FFH - FCH) 750 až 2000 mm |

### 3.3 NetVolume

Model `NV = GV - GFA x (FFH + 0,0125 m pri podhľade)`:

| Trieda | Počet | Miestnosti |
|---|---|---|
| presne (do 5 dm3) | **51** | všetky šachty, sklady, serverovne, WC bezbariérové, 2.12 a 3.12 (bez podhľadu: len FFH), 2.13/3.13 (podhľad 23,185 m2 = celý pôdorys) |
| do 0,5 m3, menej odpočítané | 17 | WC, chodby, kuchynky, zasadačky: podhľad alebo podlahovina nepokrýva celý pôdorys (napr. inštalačná predstena) |
| nad 0,5 m3, menej odpočítané | 9 | 1.01 až 1.03, 2.01, 2.02, 3.01, 3.02 (-0,55 až -0,97 m3): podlahovina PD03.30.01 má 452,29 m2 pre 2.01 + 2.02 (2 x 230,95 = 461,9), čiže nepokrýva cca 4,8 m2 na miestnosť (stĺpy) |
| nad 0,5 m3, viac odpočítané | 6 | 1.05, 1.07, 2.14, 3.14, 4.01 (bez FFH v Qto, hoci podlaha existuje; (GV - NV) / GFA = 0,29 / 0,28 / 0,14 m) a schodiská 2.20, 3.20, 4.06 (rameno schodiska vnútri telesa) |

Záver: NetVolume je **objem telesa mínus prieniky s krytinami (FLOORING, CEILING) a iným prvkom vnútri** (schodisko),
nie stĺpy ani steny (tie sú mimo telesa). Recept preto potrebuje prienik objemov, prizmaticky: 2D orez pôdorysov
(profil miestnosti x profil krytiny) x prekryv v Z. Žltá je správna farba, keď recept sedí podľa definície schémy, ale
hodnota zo súboru vznikla inou metódou (napr. Revit odpočítal len časť).

### 3.4 Miestnosť 2.01 (Openspace - Západ, `3sVKD79KnE69QhEA8lMbzt`): vzorec s dosadenými číslami a kotvy

| Veličina | Vzorec | Dosadené | Súbor | Stav |
|---|---|---|---|---|
| Height | spodok(SD02.03.0002) - vrch(SD02.03.0001) | 8,800 - 4,850 = 3,950 m | 3950 mm | zelená |
| FinishFloorHeight | vrch(PD03.30.01) - vrch(SD02.03.0001) | 5,000 - 4,850 = 0,150 m | 150 mm | zelená |
| ElevationWithFlooring | vrch(PD03.30.01) | 5,000 m | 5000 mm | zelená |
| FinishCeilingHeight | spodok(PH01.10.0010) - vrch(PD03.30.01) | 8,050 - 5,000 = 3,050 m | 3050 mm | zelená |
| GrossFloorArea | pôdorys telesa 2.01 | 230,947 m2 | 230,9544 | zelená (0,003 %) |
| GrossVolume | GFA x Height (mesh neuzavretý) | 230,947 x 3,95 = 912,24 m3 | 912,2699 | zelená (0,003 %) |
| NetVolume | GV - V(PD03.30.01 prienik 2.01) - V(PH01.10.0010 prienik 2.01) | 912,27 - 230,95 x 0,1625 = 874,74 (model bez prieniku) | 875,5929 | žltá: -0,853 m3 (0,1 %), presne až s prienikom v pôdoryse |
| odvodená: objem nad podhľadom | pôdorys x (spodok(SD02.03.0002) - vrch(PH01.10.0010)) | 230,95 x (8,800 - 8,063) = 170,2 m3 | (nie je v súbore) | len zobrazenie |

Kotvy pre kóty: plochy z = 4,850 (vrch SD02.03.0001), 5,000 (vrch PD03.30.01), 8,050 a 8,063 (PH01.10.0010), 8,800
(spodok SD02.03.0002). Kóta = zvislá úsečka v ťažisku pôdorysu miestnosti medzi dvoma plochami; existujúci `MEASURE_SHOW`
(D-124) ju nakreslí.

---

## 4. Pripomienky k architektúre zo zadania

1. **Prečo nie len extrúzia:** extrúzia je prvý *analytický* prípad: hodnota je presná zo zdrojových parametrov, bez
   tesselácie. Ďalšie analytické tvary sa pridajú ako resolvery s rovnakým výstupom (hodnota + kotva):
   `IfcSweptDiskSolid` (potrubie: objem pi x r2 x L, plášť 2 x pi x r x L; ifc-lite má aj `SweptDiskDescriptions`),
   `IfcRevolvedAreaSolid` (Pappova veta), `IfcExtrudedAreaSolidTapered`, `IfcBooleanClippingResult` s polpriestormi
   (zrezané steny). Pre zvyšok (Brep, CSG s otvormi, mapované reprezentácie) ide výpočet cez **uzavretý mesh** motora:
   objem divergenciou, plocha súčtom trojuholníkov, s toleranciou tesselácie. Recept dostane
   `body_source: analytic:<trieda> | mesh` a pri meshi `closed`; **sivá je len pri neuzavretom meshi bez analytického
   zdroja**.
2. **Výber podhľadu (rozhodnuté 1. 11. podľa textu schémy):** viac výšok podhľadu v pôdoryse miestnosti nie je medián, ale
   nález. Schéma (IFC4 ADD2 TC1 aj IFC4.3, `Qto_SpaceBaseQuantities.xml`): FinishCeilingHeight "to be provided only if the
   space has a suspended ceiling with constant height". Hodnota v súbore pri N výškach = červená, BCF pre OCB (odstrániť
   hodnotu alebo rozdeliť miestnosť na `IfcSpace` PARTIAL); bez hodnoty = zelená. Pravidlo je v `lib/verify/quantity-methods.ts`
   (`NON_CONSTANT_RULE`).
3. **NetVolume (otvorená otázka 2):** hodnotiť podľa definície schémy (teleso mínus prieniky konštrukcií vnútri),
   prizmaticky; zelená do tolerancie, žltá, keď sa hodnota zhoduje s modelom "len plné vrstvy" (kap. 3.3), červená
   inak. CSG jadro ifc-lite netreba, kým sú telesá extrúzie (otvorená otázka 3).
4. **Tolerancie:** dĺžky 5 mm a plochy/objemy 0,5 % sú v súlade s nameraným (zelené prípady sú do 0,01 %); pri objeme
   pridať absolútnu toleranciu (napr. 0,05 m3), aby malé šachty nespadli do červenej pre tisíciny.
5. **Perzistencia:** `verification_runs` / `verification_results` so signatúrou `(model, revision)` sú v súlade s
   D-183 bod 11. Výsledok nesie vypočítanú hodnotu a kotvy; podľa D-183 bod 6 ("geometria ani odtlačok v DB") treba
   Samuelovo výslovné áno, že vypočítaná hodnota a výšky kotiev nie sú zakázaný odtlačok (prvá analýza, otázka 1).
6. **Krížové kontroly bez geometrie** (H >= FFH + FCH, GV = GFA x H, EWF = elevácia + FFH) idú v SQL nad kópiou revízie
   za milisekundy a dajú prvú vrstvu fajočiek ešte pred motorom.

---

## 5. Ďalšie kroky

1. **Spike v motore na ASR v79** (lokálne nejde, D-135): v `lib/engine` zavolať `extractExtrusionDefinitions` nad
   načítaným archívom pre 83 IfcSpace, IfcSlab a IfcCovering; recepty Height, FFH, FCH a NetVolume s prienikom
   pôdorysov (2D orez profilov) a výstup tabuľka (miestnosť, súbor, vypočítané, rozdiel, stav, vstupné GUID, kotvy).
   Skript tejto session (`prototyp/spike-extrusion-spaces.mjs`) je vzor čítania výstupu.
2. Potvrdiť pôdorysný prekryv pre FCH (dnes len podľa výšky) a prienik krytín pre NetVolume; cieľ: 2.01 NetVolume
   zelená alebo žltá s vysvetlením číslom.
3. D-záznam (číslo od orchestrátora), potom dátový model receptov a výsledkov, migrácia, UI fajočky a detail s kótami,
   BCF.
4. BCF témy z nálezov kap. 1 bod 5 až po Samuelovom súhlase (duplicitná doska je pravdepodobne chyba modelu).

## 6. Súbory spiku

- `prototyp/spike-extrusion-spaces.mjs`: `extractExtrusionDefinitions` pre IfcSpace vedľa base quantities zo súboru,
  bez závislostí okrem `@ifc-lite/geometry` 7.8.1 (cesta cez `NODE_PATH`).
- `prototyp/data/mini-space-extrusion.ifc`: ručne zostavený IFC4 (mm), miestnosť 2.01 zjednodušene v tvare L s Qto.
- Verejné testovacie modely (z forku Menezeris/ifc-lite, nie v repe): `apps/viewer/public/_fixtures/AC20-FZK-Haus.ifc`
  (Brep miestnosti, 0 extrúzií), `apps/viewer/public/samples/building-architecture.ifc` (profil s medzerou, unsupported).

## 7. Spike v `lib/engine` (D-185, nezapojený do toolov)

- **`lib/engine/space-verify.ts`:** `extractBodies(bytes, ids)` = `extractExtrusionDefinitions` -> zvislé hranoly v IFC
  svete (m, jednotky súboru prevedie `world_from_source`), oblúky vzorkované, šikmé extrúzie a CSG operandy označené
  `unsupported`. Presná 2D geometria bez knižnice: ear clipping, Sutherland-Hodgman orez konvexným trojuholníkom,
  prienik pôdorysov s dierami inklúziou-exklúziou. `verifySpace(space, {slabs, coverings})` vráti pre každú veličinu
  recept (`space.height.own@1`, `space.height.slabs@1`, `space.ffh.covering@1`, `space.fch.covering@1`,
  `space.area.profile@1`, `space.perimeter.profile@1`, `space.volume.prism@1`, `space.netvolume.coverings@1`), stav
  (green / yellow / red / grey), hodnotu zo súboru a vypočítanú, vzorec s dosadenými číslami a kotvy (GUID, rola, z).
  Výber prvkov a tolerancie berie z registra `lib/verify/quantity-methods.ts` (dosky aspoň 50 % pôdorysu a dotyk do 5 mm,
  podlahovina aspoň 50 %, podhľad aspoň 10 %; viac výšok = pravidlo konštantnosti, červený nález pri hodnote v súbore); NetVolume podľa schémy (prieniky krytín prizmaticky),
  žltá pri zhode s metódou "krytiny po celej ploche". Tolerancie = predbežné predvoľby D-185.
- **Testy `lib/engine/space-verify.test.ts` (9, prechádzajú; pridané: pravidlo konštantnosti, metóda/definícia/tolerancia pri každom výsledku):** prienik L-tvaru, diery, obvod; zelené recepty so vzorcom a
  kotvami; červená FCH, sivý nekonštantný podhľad; žltý a červený NetVolume; sivá bez telesa; integrácia so skutočným
  WASM `extractExtrusionDefinitions` na fixture `__fixtures__/mini-space-verify.ts` (mm, z 4,85 až 8,80, 88 m2).
  Mutácie (bez znamienok dier, podhľad od spodku telesa namiesto podlahy) testy zhodia. tsc a eslint bez nálezov.
- **Tolerancia NetVolume (rozhodnuté 1. 11.):** 0,5 % z objemu miestnosti nerozlíšilo metódu podľa schémy od Revit metódy
  pri tenkých krytinách (fixture: 333,5 vs. 333,3 m3, obe zelené). Samuel: tolerancia viazaná na odčítaný objem, najviac
  1 % z GV - NV (`NET_VOLUME_TOLERANCE` v registri); fixture: +- 0,1435 m3, Revit metóda je žltá. Testy: 10.
- **Čo spike nespravil:** beh na ASR v79. Motor číta archív revízie len na serveri a lokálne sa produkčný súbor
  nesťahuje (D-135); spustenie vyžaduje zapojenie do toolu (napr. `ifc_measure quantity=...` alebo samostatný beh
  overenia) a nasadenie; Samuel 1. 11.: zatiaľ nie. Očakávanie podľa kap. 3: 2.01 Height, FFH, FCH zelená,
  NetVolume zelená alebo žltá podľa prekryvu PD03.30.01 a PH01.10.0010.
