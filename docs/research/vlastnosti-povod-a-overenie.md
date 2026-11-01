# Pôvod a overenie vlastností: čo vie IFC a čo dokáže AIMviewer

**Druh:** výskumná správa (analýza a návrh, nie produkčný kód) · **Dátum:** 2026-11-01 ·
**Zadanie:** Samuel cez orchestrátora · **Nadväzuje na:** D-112 (`ifc_measure`), D-124 (kóta, rámec meshu),
D-140 (výška podhľadu z geometrie), D-142 (`include=quantities`), D-155 (plochy a osi prvku), D-181 (ICDD),
D-183 (zdroj pravdy, podpis vstupu) · **Prototyp:** [`prototyp/povod-overenie.mjs`](prototyp/povod-overenie.mjs)

> Samuel: "Pridať funkciu, že každá vlastnosť v rámci databázy aimviewera bude mať jasne stanovené, odkiaľ
> pochádza a na základe čoho, a že keď na ňu kliknem, napr. objem nad podhľadom, tak sa mi geometricky ukáže
> vizuálne; keď kliknem na výšku, tak výšky sa mi zobrazia. Tým tie hodnoty reálne overíme voči geometrii a
> bude sa im dať veriť. Obdobne by sa mohla dať počítať plocha aj ľubovoľne, napríklad na debnenie ako nejaká
> dočasná vlastnosť atď."

Všetky čísla v správe sú z dnešných dát: DB `acwoupricatirhlfkhvk` (len SELECT nad kópiou revízie
`ifc_rev_*`, ASR v79 a VZT v11) a motor cez existujúce tooly (`ifc_measure`, `ifc_get`), ktoré čítajú archív
revízie (D-135). Žiadny produkčný IFC sa nesťahoval, nič sa nezapisovalo.

---

## 0. Zhrnutie na jednu obrazovku

- **IFC vie povedať "čo" a "kto", ale nie "z čoho a ako presne".** Qto má meno sady a veličiny so
  štandardnou slovnou definíciou (napr. `NetSideArea`), voliteľne `MethodOfMeasurement` na sade a `Formula`
  na veličine (IFC4+), jednotku a `OwnerHistory` (aplikácia, autor). **Väzbu hodnoty na konkrétnu geometriu
  (ktorá reprezentácia, ktoré plochy telesa) schéma nemá vôbec.** `IfcShapeAspect` vie pomenovať časť tvaru,
  ale veličina naň odkazovať nevie.
- **Naše súbory (Revit 2027 / IFC4X3_ADD2, ReferenceView):** Qto sú na takmer všetkých prvkoch, navyše
  `Qto_BodyGeometryValidation` (IFC4.3 sada práve na kontrolu geometrie) na 2 720 prvkoch ASR a 1 073 VZT.
  `MethodOfMeasurement`, `Formula`, jednotku pri veličine ani `Description` dnes **nečíta ani ETL, ani motor**,
  takže nevieme, či ich Revit vypĺňa (prvý lacný krok, kap. 2.3).
- **Geometria motora sedí so súborom presne tam, kde je definícia jednoznačná** (objem stien, dosiek, stĺpov,
  podhľadov, pôdorys miestností: odchýlka do 0,1 %). **Kde je definícia nejasná, vychádza "nezhoda", ktorá je
  v skutočnosti iný význam** (miestnosť 1.01: `NetVolume` 685,1 m3, mesh 731,2 m3 = `GrossVolume`; doska
  SD02.03.0001: `GrossVolume` 173,25 v `Qto_SlabBaseQuantities`, ale 165,35 v `Qto_BodyGeometryValidation`).
  Presne toto je Samuelova pointa: hodnote sa dá veriť, až keď je známa metóda.
- **Návrh:** (1) register metód veličín v repe (pre každú `Qto.Veličina`: metóda nad meshom, reprezentácia,
  tolerancia, dôkaz), (2) pôvod každej hodnoty v troch druhoch (`file` / `derived` / `computed`), (3)
  `ifc_measure` s overením konkrétnej veličiny a dôkazom pre viewer, (4) dočasné veličiny (debnenie, objem nad
  podhľadom) ako pravidlá počítané motorom na požiadanie, **neukladané** do DB (D-183 bod 6), (5) vo vieweri
  kóta (už existuje, D-124) a vodorovné výplne (renderer ich už má), neskôr zvýraznenie ľubovoľných plôch
  (zmena renderera forku).
- **Prototyp** (bez závislostí): overenie Qto steny podľa významu (Height, NetSideArea, NetFootPrintArea,
  NetVolume = zhoda) a plocha debnenia dosky s otvorom a podperami (27,25 m2 presne podľa ručného výpočtu;
  zmena pravidla "priečka je podpera" dá 26,95 m2, preto pravidlo patrí do pôvodu).
- **Rozhodnutia pre Samuela** sú v kap. 7 (ukladať výsledky overenia?, pravidlá debnenia, tolerancie, zmena
  renderera, rozšírenie ETL). Číslo D si nevymýšľam, navrhujem orchestrátorovi prideliť jedno pre "pôvod a
  overenie vlastností" (posledné v `main` je D-184).

---

## 1. Čo vie IFC ako schéma

### 1.1 Výmery (IfcElementQuantity, IfcPhysicalQuantity)

| Prvok schémy | Čo hovorí o pôvode a výpočte | Poznámka |
|---|---|---|
| `IfcElementQuantity.Name` (`Qto_WallBaseQuantities`...) | Ktorá štandardná sada; definície veličín sú v dokumentácii IFC (text) | Štandardná sada = známy význam mena, nie metóda výpočtu |
| `IfcElementQuantity.MethodOfMeasurement` (IfcLabel, voliteľné) | Voľný text, "podľa akého pravidla merania" (napr. národný predpis, "BaseQuantities") | Nie je kódovaný, nie je väzba na geometriu |
| `IfcPhysicalSimpleQuantity.Formula` (IFC4+, IfcLabel, voliteľné) | Voľný text vzorca, ktorým bola hodnota vypočítaná | Nie je to vyhodnotiteľný výraz, len popis |
| `IfcPhysicalQuantity.Description`, `Unit` (voliteľná) | Opis a prípadne vlastná jednotka; inak platí `IfcUnitAssignment` projektu | V našich súboroch dĺžky v mm, plochy m2, objemy m3 v jednej sade |
| `IfcPhysicalComplexQuantity` (`Discrimination`, `Quality`, `Usage`) | Zložená veličina (napr. podľa vrstiev materiálu) | Nevidel som v našich dátach |
| `Qto_BodyGeometryValidation` (IFC4.3) | GrossSurfaceArea, NetSurfaceArea, GrossVolume, NetVolume (a SurfaceGenusEquivalent) **telesa Body** na overenie geometrie | Jediné miesto, kde schéma výslovne viaže výmeru na reprezentáciu (Body) |

Definície štandardných veličín sú slovné a geometricky dosť presné, napr. `Qto_WallBaseQuantities.NetSideArea`
je plocha steny pri pohľade kolmo na os steny s odpočítaním otvorov, `GrossSideArea` bez odpočtu. Ale súbor
nehovorí, či nástroj definíciu dodržal (Revit napr. dáva `Qto_WallBaseQuantities` aj na `IfcSlab`, pozri 1.4).

### 1.2 Vlastnosti a ich väzby

- `IfcPropertySet` / `IfcElementQuantity` sa viaže na prvok cez `IfcRelDefinesByProperties`, na typ cez
  `HasPropertySets` typu. Výskyt vs. typ je jediný štrukturálny "pôvod" (D-142 ho už vracia ako `source`).
- `IfcOwnerHistory` (na každej sade aj vzťahu, keďže sú `IfcRoot`): `OwningApplication`, `OwningUser`,
  `ChangeAction`, `CreationDate`, `LastModifiedDate`. Hovorí "kto a čím", nie "z čoho". V našich súboroch je
  podľa D-183 nespoľahlivý (`ChangeAction` VZT v11: 40 z 55 nových prvkov NOCHANGE).
- `IfcPropertyDependencyRelationship` (`DependingProperty`, `DependantProperty`, `Expression` IfcText):
  závislosť jednej vlastnosti od inej s textovým výrazom. Najbližšie k "odvodená z" v schéme, ale len medzi
  vlastnosťami, nie od geometrie, a autorské nástroje ju prakticky nepoužívajú.
- `IfcConstraint` / `IfcObjective` / `IfcMetric` cez `IfcResourceConstraintRelationship`: požiadavka na
  hodnotu (benchmark, `ValueSource`, `ReferencePath` = cesta k atribútu). Je to strana "zadania", nie pôvodu;
  v praxi ju nahrádza IDS (u nás D-081/D-162).
- `IfcApproval` cez `IfcResourceApprovalRelationship`: schválenie zdroja (aj vlastnosti). Teoreticky by
  "overené voči geometrii" mohlo byť `IfcApproval`, ale do prijatého kontajnera nepíšeme (D-183 bod 2).
- `IfcExternalReference` (`IfcLibraryReference`, `IfcClassificationReference`, `IfcDocumentReference`): odkaz
  na knižnicu alebo predpis. bSDD má pri vlastnosti pole `MethodOfMeasurement`, takže norma merania sa dá
  pomenovať cez bSDD, nie vypočítať.
- `IfcAppliedValue` (`ArithmeticOperator`, `Components`): strom hodnôt pre náklady (5D), s
  `IfcCostItem.CostQuantities` (výmery pre položku rozpočtu) a `IfcRelAssignsToControl` (prvky k položke).
  Toto je jediné miesto v IFC, kde je "výkaz výmer s pravidlom" (rozpočtová položka = súčet veličín prvkov);
  pravidlo je však opäť text, nie výpočet nad geometriou.
- `IfcDerivedUnit` / `IfcUnitAssignment`: jednotky, nie pôvod. Pre nás dôležité, lebo jedna sada mieša mm a m2.

### 1.3 Väzba výmery na geometriu

- Reprezentácie produktu majú identifikátory (`Body`, `Axis`, `FootPrint`, `Box`, `Surface`, `Clearance`...).
  Definície Qto implicitne predpokladajú, z čoho sa meria (dĺžka steny z `Axis`, objem z `Body`), ale
  **veličina na reprezentáciu neodkazuje**.
- `IfcShapeAspect` (`ShapeRepresentations`, `Name`, `ProductDefinitional`, `PartOfProductDefinitionShape`)
  vie pomenovať časť tvaru (napr. zárubňa, líce), ale `IfcPhysicalQuantity` naň odkaz nemá. Na väzbu "plocha
  = tieto plochy telesa" v IFC nie je konštrukt.
- Otvory: `IfcRelVoidsElement` / `IfcOpeningElement` určujú, čo je Net a Gross; či nástroj otvory odpočítal,
  súbor nehovorí (len hodnota).

### 1.4 IFC5 / IFCX

IFCX skladá vrstvy (JSON) nad tými istými identitami; každá vrstva má hlavičku (autor, čas, verzia) a hodnota
atribútu je výsledok kompozície vrstiev. Pôvod hodnoty je teda "ktorá vrstva ju dodala", čo je presne náš
rozdiel súbor vs. AIM vrstva (D-129, D-183 bod 12). Metódu výpočtu ani väzbu na geometriu IFCX tiež nemá.
Formát je alfa a D-183 ho zamietol ako pravdu (variant C); AIM vrstva sa raz dá exportovať ako IFCX vrstva
(vypočítané veličiny ako samostatná vrstva "aim::computed").

### 1.5 Čo reálne vypĺňajú naše autorské nástroje (DB, kópia revízie)

Hlavička: ASR v79 a VZT v11 sú `IFC4X3_ADD2`, Revit 2027 / 27.0.20.10, ASR `ViewDefinition [ReferenceView]`,
VZT po exporte cez ifc-lite bez MVD (nález z D-183 bod 4).

| Model | Sady IfcElementQuantity | Mená | Najčastejšie |
|---|---|---|---|
| ASR v79 | 5 540 | 18 | `Qto_BodyGeometryValidation` 2 720, `Qto_MemberBaseQuantities` 1 378, `Qto_PlateBaseQuantities` 524, `Qto_CoveringBaseQuantities` 206, `Qto_WallBaseQuantities` 177, `Qto_SpaceBaseQuantities` 83 |
| VZT v11 | 1 671 | 4 | `Qto_BodyGeometryValidation` 1 073, `Qto_DuctSegmentBaseQuantities` 526, `Qto_DuctFittingBaseQuantities` 62, `Qto_AirTerminalBaseQuantities` 10 |

- `Qto_BodyGeometryValidation` je na 100 % stien (168), dosiek (29), stĺpov (52), krytín (206), dverí (97),
  miestností (83) a na 524 z 526 potrubí. Pre overenie je to dar: Revit sám deklaruje objem a povrch telesa.
- **Quirky Revitu:** `Qto_WallBaseQuantities` aj na `IfcSlab` (9 z 177 sád); stena SN02.03.0011 je
  `PredefinedType = SHEAR` (žb jadro) s `Pset_WallCommon.LoadBearing = false`; rovnaké meno veličiny s iným
  významom v dvoch sadách (doska SD02.03.0001: `Qto_SlabBaseQuantities.GrossVolume` 173,25 m3 = bez odpočtu
  otvorov, `Qto_BodyGeometryValidation.GrossVolume` 165,35 m3 = teleso s otvormi).
- Súbor už nesie pset `AIMviewer_Provenance` (`RevitReference`) z nášho post-processingu, teda pôvod sa do
  súboru raz už písal receptom.

---

## 2. AIM dnes: kde sú vlastnosti a čo vieme o ich pôvode

### 2.1 Kde hodnoty žijú

| Miesto | Čo nesie | Pôvod, ktorý vieme |
|---|---|---|
| `ifc_rev_property_sets` (D-183 K2) | Každá sada výskytu aj typu, `pset_class` (`IfcPropertySet` / `IfcElementQuantity`), `properties {meno: hodnota}`, kľúč `(model, revision, global_id, pset_name)`, `content_hash` | model, revízia, sha256 archívu (`ifc_rev_imports`), nositeľ (prvok/typ), meno sady |
| `objects.properties` (graf AIM, D-022) | Psety bez Qto (D-142), s dedením cez `v_asset_effective` | len "z ETL", bez revízie (prechod na kópiu je K3/K4) |
| `get_object include=quantities` (D-142) | Qto a psety z motora, `source` = `occurrence` / `type` | aktuálna revízia motora (`revision` vo výsledku) |
| `ifc_measure` (D-112, D-124, D-155) | Rozmery obálky, povrch, pôdorys, objem z meshu, `vs_qto` (nezhoda nad 5 %), kóty, plochy po osiach | `source` = headless tesselácia, `revision` motora, verzia balíka |
| `aggregate_objects` (D-060) | Súčty nad `objects.properties` | ako graf AIM |
| Väzby `rel_*` | `source` (`ifc:ASR v79`, `derive:spatial_reference`, `pdf_link (E4)`...), `valid_from`, `derivation_runs` | najlepší pôvod, aký dnes máme (pravidlo + beh + revízie) |
| `set_section relative_to=ceiling` (D-140) | Výška podhľadu z geometrie, `source` = `geometry` / `qto`, `warning` pri nezhode nad 2 cm | jediný tool, ktorý už dnes hovorí "táto hodnota je z geometrie, Qto sa líši" |

### 2.2 Čo nevieme

1. **Metódu** výmery zo súboru (`MethodOfMeasurement`, `Formula`): ETL (`etl/revision_copy.py`,
   `pset_properties`) berie len `{Name: hodnota}`, `Description`, `Unit` veličiny, triedu veličiny
   (`IfcQuantityLength` / `Area` / `Volume`) ani metódu sady neukladá; motor (`ifc_get`) ich tiež nevracia.
2. **Jednotku** hodnoty v DB: číslo je v jednotkách súboru (D-142 "Otvorené"); jednotka sa ukladá len pri
   `IfcPropertySingleValue` s vlastnou `Unit`. Pri Qto je `Height: 3950` (mm) vedľa `NetSideArea: 9.2825` (m2).
3. **Overenie** voči geometrii: `ifc_measure` porovnáva len objem a "pôdorys", a to s chybou: hľadá
   `NetFootprintArea`, ale IFC meno je `NetFootPrintArea` (veľké P), a nepozná `NetArea` dosiek a krytín, takže
   pri stenách, doskách a podhľadoch je `vs_qto.area = null` (overené dnes na 9 prvkoch ASR). Pri miestnosti
   porovnáva mesh s `NetVolume`, hoci mesh je `GrossVolume` (falošná "nezhoda", kap. 3.1).
4. **Odvodené veličiny** (objem nad podhľadom, debnenie) neexistujú; nie je ani miesto, kde by mal byť ich recept.
5. **Platnosť po úprave receptom OCB:** recept mení geometriu (D-183 bod 3), ale Qto v súbore sa nepreráta
   automaticky. Po našej revízii môže Qto klamať a nikto to nezistí. Overenie voči geometrii je presne kontrola,
   ktorá to chytí (kandidát do poistky D-086 / D-183 bod 4).

### 2.3 Najlacnejší chýbajúci krok

ETL kópie revízie doplní ku každej `IfcElementQuantity` metadáta: `MethodOfMeasurement`, `Description` sady
a ku každej veličine triedu, `Unit` (vlastnú alebo z `IfcUnitAssignment`), `Formula`, `Description`. Napr. ako
nový stĺpec `ifc_rev_property_sets.meta` jsonb (mimo `content_hash`, aby sa nezmenila verzia hashu, alebo
s `HASH_VERSION = 2`; rozhodnutie v kap. 7). Až potom vieme povedať, či Revit metódu vypĺňa.

---

## 3. Overenie na našich modeloch (motor, dnes)

### 3.1 Qto zo súboru vs. geometria motora (`ifc_measure items`, ASR v79, VZT v11)

| Prvok | Veličina zo súboru | Súbor | Geometria motora | Výsledok |
|---|---|---|---|---|
| SN02.03.0011 stena 150 | `Qto_WallBaseQuantities.NetVolume` | 1,392 m3 | 1,392 m3 | zhoda |
| SN02.03.0011 | `Height` | 3950 mm | obálka z 3,95 m | zhoda (jednotka!) |
| SN02.03.0011 | `NetSideArea` | 9,2825 m2 | povrch 20,455 = 2 x 9,2825 + čelá 1,89 | zhoda podľa významu (jedna strana) |
| SN02.02.0017 stena 250 | `NetVolume` | 9,188 m3 | 9,188 m3 | zhoda |
| SD02.03.0001 strop nad 1NP | `Qto_SlabBaseQuantities.NetVolume` / `NetArea` | 165,354 m3 / 661,415 m2 | 165,354 m3 / pôdorys 661,415 m2 | zhoda (otvory odpočítané v meshi) |
| SD02.03.0001 | `Qto_SlabBaseQuantities.GrossVolume` | 173,25 m3 | (mesh je Net) | iný význam: Gross = bez otvorov 693 m2 x 0,25 |
| PH01.10.0002 podhľad | `Qto_CoveringBaseQuantities.NetArea` | 138 m2 | pôdorys 138 m2 | zhoda (dnešný tool ju neporovná) |
| SL02.01.0020 stĺp | `NetVolume` | 0,988 m3 | 0,987 m3 | zhoda |
| Miestnosť 1.01 Lobby | `NetFloorArea` | 149,231 m2 | 149,231 m2 | zhoda |
| Miestnosť 1.01 | `NetVolume` | 685,147 m3 | 731,233 m3 | "nezhoda" 6,7 %, ale mesh = `GrossVolume` 731,232; metóda Net nie je známa (nie je to ani plocha x (výška - FinishFloorHeight) = 686,5) |
| Miestnosť 1.04 | objem | 33,857 m3 | mesh nie je uzavretý | neoveriteľné |
| Potrubie VZT 0_ihv65O54jQYlk5UC0bS8 | `Length` / `OuterSurfaceArea` | 1298,9 mm / 0,6529 m2 | 1,299 m / povrch 0,692 = 0,6529 + 2 čelá po 0,0201 | zhoda podľa významu (bez čiel) |

**Záver:** objem a pôdorys sedia na 0,1 %, pretože Revit ráta Qto z toho istého telesa, ktoré exportuje.
Zhoda teda dokazuje **konzistenciu exportu**, nie správnosť návrhu. Skutočná hodnota overenia je inde:
odhalí (a) iný význam rovnakého mena (Gross/Net, sady), (b) zlú jednotku, (c) neuzavreté teleso, (d) Qto,
ktoré po úprave modelu (náš recept, ručná úprava, iný exportér) nezodpovedá geometrii, (e) prvky bez Qto.

### 3.2 Výška a "objem nad podhľadom"

- `ifc_measure a=SD02.03.0001 b=PH01.10.0002`: medzera 0,738 m (spodok dosky z = 4,60, vrch podhľadu
  z = 3,862), `closest_points` = hotová kóta pre viewer (D-124).
- Podhľad PH01.10.0002 má pôdorys 6,625 x 21 m (138 m2), čo zodpovedá miestnosti 1.02 Retail 1
  (6,743 x 21,249 m, 141,343 m2); zaradenie podhľadu k miestnosti treba overiť (dnes ho nič nenesie).
- `Qto_SpaceBaseQuantities.FinishCeilingHeight` 1.02 = 3850 mm a spodok podhľadu z = 3,85 nad hotovou
  podlahou z = 0,00 (spodok IfcSpace -0,30 + `FinishFloorHeight` 300 mm): **zhoda**, overiteľná dvoma kótami.
- **Objem nad podhľadom** dvoma metódami: geometria = pôdorys podhľadu x svetlá výška = 138 x 0,738 =
  **101,8 m3**; z Qto miestnosti = 141,343 x (4,9 - 0,3 - 3,85) = **106,0 m3** (rozdiel 4 %: hrúbka podhľadu
  12,5 mm a menší pôdorys podhľadu). Ani jedna nie je "zlá"; sú to dve metódy a hodnota bez metódy je
  nedôveryhodná.

### 3.3 Debnenie stropu nad 1NP odhadom z Qto (bez geometrie kontaktu)

Spodok SD02.03.0001 661,415 m2; na 1NP je 16 stĺpov (prierez spolu 4,00 m2) a steny do stropu (výška
4900 mm): SHEAR 16 ks (pôdorys 21,95 m2), SOLIDWALL 6 ks (7,74 m2), PARTITIONING 24 ks (9,88 m2). Čelá
dosky = obvod 108 m x 0,25 = 27 m2 plus boky otvorov (otvory spolu 31,585 m2, obvod neznámy).

| Pravidlo podpier | Spodné debnenie |
|---|---|
| len stĺpy a SHEAR steny | 661,415 - 25,95 = 635,5 m2 |
| + SOLIDWALL | 627,7 m2 |
| + priečky (nesprávne, murujú sa po betonáži) | 617,8 m2 |

Je to len odhad: predpokladá, že celý vrch steny sa dotýka dosky, a nepozná steny pod okrajom. Presnú
hodnotu dá až geometria (kap. 5, prototyp). A pravidlo podľa `LoadBearing` by na našom modeli zlyhalo
(žb jadro má `LoadBearing = false`).

---

## 4. Návrh: pôvod a overenie vlastnosti

### 4.1 Tri druhy pôvodu (dátový model)

Každá hodnota, ktorú AIM ukáže (panel, tool, zoznam), nesie objekt `provenance`:

```jsonc
// zo súboru (dnes 90 % hodnôt)
{ "kind": "file",
  "container": { "model": "ASR", "revision": 79, "sha256": "..." },        // D-183 bod 1
  "carrier": { "global_id": "0Ah_rJY9fDmfBwNrU7T88L", "via": "occurrence" }, // alebo "type"
  "set": { "name": "Qto_WallBaseQuantities", "class": "IfcElementQuantity",
           "method_of_measurement": null, "owning_application": "Revit 2027" },
  "quantity": { "name": "NetSideArea", "class": "IfcQuantityArea", "unit": "m2", "formula": null },
  "definition": "ifc_property_definitions: Qto_WallBaseQuantities.NetSideArea" }

// odvodené AIM vrstvou (pravidlo nad grafom, D-089)
{ "kind": "derived", "rule": "element_in_space@v3", "run_id": "...",
  "inputs": { "ASR": 79, "VZT": 11 } }

// vypočítané motorom nad geometriou
{ "kind": "computed",
  "method": { "id": "wall.side_area.v1", "text": "plochy s normálou +y osi steny", "representation": "Body" },
  "inputs": [{ "model": "ASR", "revision": 79, "global_ids": ["..."] }],
  "engine": { "package": "@ifc-lite/geometry", "version": "7.8.1" },
  "tolerance": { "rel": 0.005, "abs_m": 0.001 },
  "evidence": { "segments": [...], "fills": [...], "faces": [...] } }   // čo ukáže viewer
```

- `file` sa **neukladá nanovo**: všetko je v kópii revízie (`ifc_rev_property_sets` + chýbajúce `meta`
  z kap. 2.3) a skladá sa pri čítaní. `definition` je väzba na existujúcu tabuľku `ifc_property_definitions`.
- `derived` už existuje pri väzbách (`source`, `derivation_runs`); pre vlastnosti AIM vrstvy (D-129) rovnaký tvar.
- `computed` je nový. **Metóda je kód v repe s verziou** (register, nie text v DB), aby sa dala spustiť znova
  nad tou istou revíziou a dať to isté číslo (Samuel v D-183: "nesmie sa stať, že... vyjde inak").

### 4.2 Register metód veličín

Súbor v repe (napr. `lib/engine/quantity-methods.ts`, testovaný ako `tool-registry.json`, D-114): pre každú
štandardnú veličinu, ktorú vieme overiť:

| Veličina | Metóda nad meshom (Body, IFC svet) | Dôkaz vo vieweri |
|---|---|---|
| `*.NetVolume` (Wall, Slab, Column, Member, Covering, BodyGeometryValidation) | objem uzavretého meshu | izolovaný prvok, príznak `closed` |
| `Qto_SpaceBaseQuantities.GrossVolume` | objem meshu IfcSpace (Net nepoznáme bez metódy) | izolovaná miestnosť |
| `*.Height`, `Qto_SpaceBaseQuantities.Height` | obálka z (spodok po vrch) | kóta z (D-124, existuje) |
| `Qto_SpaceBaseQuantities.FinishCeilingHeight` | spodok IfcCovering CEILING nad miestnosťou - hotová podlaha (D-140) | dve kóty |
| `Qto_WallBaseQuantities.Length` / `Width` | os x / hrúbka +y/-y v osiach prvku (D-155) | kóta |
| `Qto_WallBaseQuantities.NetSideArea` | plochy s normálou +y osi steny (jedno líce) | zvýraznené líce |
| `*.NetFootPrintArea`, `Qto_SlabBaseQuantities.NetArea`, `Qto_CoveringBaseQuantities.NetArea`, `NetFloorArea` | plochy s normálou -z / priemet +z | vodorovná výplň (renderer ju má) |
| `Qto_DuctSegmentBaseQuantities.Length` / `OuterSurfaceArea` | os segmentu / povrch bez čiel (normála rovnobežná s osou) | kóta, zvýraznený plášť |
| `Qto_DoorBaseQuantities.Width/Height` | obálka v osiach prvku; svetlý otvor = D-118 `clear_opening` | kóty |

Každý riadok: `id@verzia`, reprezentácia, jednotka výstupu, tolerancia, text definície IFC a známe quirky
(napr. Revit `Qto_WallBaseQuantities` na `IfcSlab` = metóda dosky). Veličina bez riadku je "bez metódy, len
zo súboru" a tak sa aj zobrazí.

### 4.3 Porovnanie a stav

`status` = `match` (do tolerancie) | `deviation` (hodnota a %) | `definition_mismatch` (známy iný význam, napr.
Net vs. mesh Gross) | `unverifiable` (otvorený mesh, chýba geometria, veličina bez metódy) | `unit_unknown`.
Tolerancia podľa triedy veličiny, nie plošných 5 % ako dnes: dĺžky 1 mm, plochy a objemy 0,5 % (kap. 7).

### 4.4 Kde to žije v tooloch (D-114: rozšíriť, nie nový tool)

- `get_object include=quantities` (D-142): ku každej hodnote `provenance` (kind `file`, sada, nositeľ, metóda
  a jednotka po doplnení ETL).
- `ifc_measure` dostane `quantity` (napr. `"Qto_WallBaseQuantities.NetSideArea"` alebo `"all"`) s `a` alebo
  `items`: vráti hodnotu zo súboru, z geometrie, `status`, `provenance.computed` a `evidence`; `show=true`
  pošle dôkaz do viewera. Pri tom opraviť dnešné `qtoOf` (mená `NetFootPrintArea`, `NetArea`, Net vs. Gross
  pri IfcSpace).
- Dočasné veličiny ako hodnota enumu v tom istom toole (`derive = formwork | plenum_volume | ...`), kap. 5.
- Zavrhnuté rozšírenie: nový tool `verify_property`: robí to isté nad tými istými meshmi ako `ifc_measure`.

### 4.5 Vizualizácia vo vieweri

| Čo treba ukázať | Čo už existuje | Čo doplniť |
|---|---|---|
| Výška, dĺžka, hrúbka, svetlá výška | `MEASURE_SHOW` (D-124) cez upstream Measure, 12 úsekov | nič, len host pošle segmenty z `evidence` |
| Plocha vodorovnej plochy (pôdorys, spodok dosky, podhľad, debnenie spodku) | renderer forku `uploadAnnotationFills3D` (polygón s dierami v danej výške, farba RGBA; dnes ho používa `AimRoomFill3d`, D-125) | nová správa mosta v `aim/` (napr. `EVIDENCE_SHOW { fills, segments }`), fork len kreslí (D-098) |
| Objem telesa | izolácia / X-ray prvku (`style_in_3d`), príznak uzavretosti | voliteľne obrysové hrany cez SVG vrstvu ako `AimRouteLayer` |
| Objem nad podhľadom | rez (`set_section box`), dve výplne (vrch podhľadu, spodok dosky) a kóta | to isté ako vyššie; "duch" hranolu by chcel všeobecný overlay |
| Plocha šikmej alebo zvislej plochy (líce steny, plášť potrubia, boky debnenia) | renderer farbí len **celé prvky** (Lens, výber); výplne sú len vodorovné | **nový overlay ľubovoľných trojuholníkov** v rendereri (upstream balík, plné CI forku, ako D-120 bod 2) |
| Klik na riadok vlastnosti | panel vlastností forku (`QuantitySetCard.tsx`, upstream súbor), AIM záložky `AimInspectorTabs.tsx` | AIM záložka "Pôvod a overenie" v `aim/` (nie zásah do upstream karty): riadok -> host -> `ifc_measure quantity` -> `EVIDENCE_SHOW` |

Dôkaz posiela host **ako body a polygóny v IFC svete**, nie ako indexy trojuholníkov: viewer tesseluje vo WASM
inou cestou ako headless motor a indexy by nesedeli; prevod IFC svet -> render rámec už rieši D-124.
Výpočet robí host (motor nad archívom revízie, D-183 bod 11 a 13), viewer len kreslí. Výpočet vo vieweri by bol
rýchlejší, ale druhá implementácia s iným výsledkom je presne to, čo D-183 zakazuje ("beh vo vieweri je náhľad").

---

## 5. Dočasné vlastnosti (debnenie, objem nad podhľadom...)

### 5.1 Definícia

Dočasná vlastnosť = **pravidlo** (kód v registri, verzia) + **parametre** + **vstupné prvky** (výber,
filter, podlažie). Príklady:

- `formwork.slab.v1`: spodné plochy dosky (normála -z) mínus kontakt s hornými plochami podpier (vo výške
  spodku dosky +- 2 mm), plus čelá a boky otvorov (zvislé plochy). Parametre: čo je podpera (triedy,
  `PredefinedType`, materiál, nie `LoadBearing`, kap. 1.5), či rátať čelá, minimálny otvor, ktorý sa
  odpočítava (bežná výkazová prax má prah, napr. otvory do určitej plochy sa neodpočítavajú; to je rozhodnutie).
- `formwork.wall.v1`: obe líca steny mínus kontakt so stenami a doskami, mínus otvory nad prahom.
- `plenum_volume.v1`: priestor medzi vrchom podhľadu a spodkom dosky nad ním v pôdoryse podhľadu (alebo
  miestnosti): zvislé lúče ako v D-137 (`route-line.ts` už hľadá najvyšší povrch pod bodom) alebo extrúzia
  polygónu podhľadu po spodok dosky mínus prieniky (trámy, VZT). Odvodená veličina **z dvoch prvkov**, takže
  pôvod má dva vstupy.

### 5.2 Kde počítať

Na serveri v motore (ako `ifc_measure`, `clash`): má archív revízie a sha256, BVH clash enginu na hľadanie
kandidátov kontaktu (`createClashEngine`, clearance), meshe s posunom rámca (D-124) a cache tesselácie
(ASR studené ~4 až 7 s, potom ms). Kontakt plôch v produkcii presnou 2D booleovskou operáciou nad koplanárnymi
plochami (napr. clipper, polygóny po zlúčení koplanárnych trojuholníkov), nie vzorkovaním (prototyp ukazuje
prečo, kap. 5.5).

### 5.3 Ukladanie

Predvolene **neukladať**: výsledok je funkcia `(pravidlo@verzia, parametre, revízie)` a dá sa kedykoľvek
prepočítať; v DB nie je geometria ani jej odtlačok (D-183 bod 6). V pamäti motora cache kľúčovaná týmto
štvorcom. Keď používateľ výsledok potrebuje zachovať (výkaz, odovzdanie), uloží sa **ako beh** so
signatúrou vstupu (`model_revisions`, `stale`, `based_on`, presne ako IDS a clash, D-183 bod 11), nie ako
vlastnosť prvku. Ak má hodnota prejsť do modelu (napr. pset pre rozpočet), ide to **len receptom OCB** cez BCF
tému (D-183 bod 3), ako nová revízia s vlastným psetom a `MethodOfMeasurement` = id pravidla.

### 5.4 Zobrazenie

Ako v 4.5: zoznam prvkov s hodnotou (`open_list` stĺpec "z geometrie", súčet), vo vieweri vodorovné výplne
(spodok debnenia zelenou, kontakty červenou), kóty a pri čelách overlay plôch (po zmene renderera).

### 5.5 Prototyp (výsledky)

`node docs/research/prototyp/povod-overenie.mjs` (bez závislostí, syntetická geometria v osiach IFC):

1. **Overenie Qto steny podľa významu** (rozmery a hodnoty ako SN02.03.0011): `Height` 3950 mm, `NetSideArea`
   9,2825 m2 (2 trojuholníky líca = dôkaz), `NetFootPrintArea` 0,3525 m2, `NetVolume` 1,392375 m3: všetko
   zhoda; `Width` bez metódy (prototyp ju nemá, v produkcii D-155 `face_a/face_b`).
2. **Debnenie dosky** 6 x 4 x 0,25 m s otvorom 1 x 1 m, pod ňou nosná stena 6 x 0,25, stĺp 0,5 x 0,5, priečka
   a parapet (nedotýka sa): spodok 23,0, kontakt 1,75, spodné debnenie 21,25, čelá a boky otvoru 6,0, **spolu
   27,25 m2 = ručný výpočet**. S priečkou ako podperou 26,95 m2: **iné pravidlo = iné číslo**, preto je
   pravidlo súčasťou pôvodu.
3. **Presnosť vzorkovania** (mriežka h): pri hranách zarovnaných s mriežkou kontakt 2,16 m2 (h = 0,1),
   1,75 (0,05), 1,83 (0,02), 1,75 (0,01). Chyba je rádovo obvod kontaktu x h a závisí od náhody zarovnania,
   teda na výkaz nestačí: produkcia potrebuje presnú 2D booleovskú operáciu.
4. Vzor záznamu `provenance.computed` (pravidlo, parametre, vstupy s revíziou, verzia motora, presnosť).

---

## 6. Riziká

- **Kruhové overenie:** Revit ráta Qto z toho istého telesa, ktoré exportuje; zhoda nedokazuje správnosť
  návrhu, len konzistenciu. Treba to povedať v UI ("súbor a jeho geometria sa zhodujú"), nie "hodnota je pravda".
- **Tesselácia:** oblé plochy (kruhové potrubie, oblúky) sú facetované; objem a povrch meshu sú menšie ako
  analytické. Na potrubiach VZT dnes do 1 %, pri malých priemeroch a hrubej tesselácii viac. Tolerancia
  podľa tvaru, nie jedna.
- **Otvory a booleovské operácie:** mesh ifc-lite otvory odpočítava (doska: mesh = Net), ale keď boolean
  zlyhá, mesh je Gross bez varovania. Net/Gross sa teda overuje aj voči `IfcRelVoidsElement` (počet otvorov,
  ich objem z `Qto_OpeningElementBaseQuantities`).
- **Neuzavreté telesá:** časť miestností (1.04) má otvorený mesh, objem je neoveriteľný; povrch áno.
- **Jednotky:** v jednej sade mm aj m2; DB jednotky Qto nenesie. Bez doplnenia ETL hrozí porovnanie 3950 s 3,95.
- **Rovnaké meno, iný význam:** `GrossVolume` v dvoch sadách, `Qto_WallBaseQuantities` na doske, Net bez
  metódy pri IfcSpace. Register metód musí byť po (sada, veličina, trieda), nie po mene veličiny.
- **Nespoľahlivé psety ako parametre pravidiel:** `LoadBearing = false` na žb jadre; pravidlá debnenia nemôžu
  stáť na jednom psete.
- **Koplanárny kontakt:** spodok dosky a vrch steny v rovnakej výške (4,600) sa trafia len s toleranciou; pri
  posune o milimetre (Revit spoje) kontakt zmizne. Tolerancia je parameter pravidla a súčasť pôvodu.
- **Výkon:** tesselácia ASR studená 4 až 7 s (D-112), meranie potom ms; booleovské operácie nad 661 m2 doskou
  a desiatkami podpier sú v ms až stovkách ms s BVH. Celý model naraz (debnenie všetkých dosiek) treba
  stránkovať po podlažiach ako clash.
- **D-183 bod 6** (geometria ani odtlačok v DB): uložený vypočítaný objem je na hrane "odtlačku". Preto
  predvolene neukladať a uložiť len výslovne ako beh (kap. 7, otázka 1).
- **Fork:** overlay ľubovoľných plôch je zmena upstream balíka `renderer` (plné CI, odchýlka pri synchronizácii);
  MVP sa jej vyhne (kóty a vodorovné výplne).

---

## 7. Odporúčané kroky a rozhodnutia pre Samuela

### 7.1 MVP (bez zmeny renderera, bez nových tabuliek okrem `meta`)

1. **ETL metadáta Qto** (kap. 2.3): `MethodOfMeasurement`, triedy, jednotky, `Formula`, `Description` do
   kópie revízie; zistiť, čo Revit vypĺňa. Malá aditívna migrácia.
2. **Register metód** pre veličiny z tabuľky 4.2 s testami na mini modeloch (`__fixtures__/mini-geometry.ts`).
3. **`ifc_measure quantity`**: overenie konkrétnej veličiny, `status`, `provenance`, `evidence`; oprava `qtoOf`.
   `get_object include=quantities` s `provenance.file`.
4. **Viewer:** `show=true` pošle kóty (existujúce `MEASURE_SHOW`) a vodorovné výplne (nová správa mosta nad
   existujúcim `uploadAnnotationFills3D`); AIM záložka "Pôvod a overenie" s klikom na riadok.
5. **Prvá dočasná veličina:** `plenum_volume` (objem nad podhľadom) a `formwork.slab` (spodok + čelá), na
   požiadanie, neukladané.

### 7.2 Ďalej

- Uložené behy overenia a dočasných veličín so signatúrou a `stale` (po rozhodnutí 1).
- Overenie Qto ako krok poistky po recepte OCB (Qto v našej revízii musí sedieť s geometriou, inak varovanie).
- Overlay ľubovoľných plôch v rendereri (líca, plášte, boky debnenia).
- Výkaz výmer po pravidlách (stĺpec "z geometrie" v `open_list`, export), neskôr export do ICDD (D-181) ako
  väzba výsledku na revízie kontajnerov alebo IFCX vrstva.
- Prípadné využitie `@ifc-lite/provenance` (fork, výskumný balík s hashmi uzlov vrátane `geometry-mesh`) na
  podpis vstupov výpočtu bez ukladania geometrie; treba posúdiť voči D-183 bod 6.

### 7.3 Rozhodnutia, ktoré potrebujú Samuela

1. **Ukladať výsledky overenia a dočasných veličín?** Návrh: predvolene nie (prepočet na požiadanie, cache
   v motore); výslovne uložiť ako beh so signatúrou ako IDS/clash. Je uložená vypočítaná hodnota v súlade s
   D-183 bod 6, alebo je to zakázaný odtlačok?
2. **Rozšírenie kópie revízie o metadáta Qto:** nový stĺpec mimo hashu, alebo `HASH_VERSION = 2`
   (pregenerovanie kópií)?
3. **Pravidlá debnenia:** čo je podpera (triedy, `PredefinedType`, materiál; nie `LoadBearing`), rátať čelá a
   boky otvorov, prah odpočtu otvorov, styk s trámami a stenami nad doskou. Ktorý predpis merania (národná
   prax alebo vlastný) je referencia?
4. **Tolerancie:** dĺžky 1 mm, plochy a objemy 0,5 %, oblé tvary voľnejšie? Dnes plošne 5 %.
5. **Renderer forku:** schváliť zmenu upstream balíka na overlay ľubovoľných plôch (ako D-120 bod 2), alebo
   ostať pri kótach a vodorovných výplniach?
6. **Smie dočasná veličina prejsť do modelu** receptom OCB ako pset (nová revízia), a pod akým menom
   (napr. `AIM_Quantities` s `MethodOfMeasurement` = id pravidla)?
7. **Číslo rozhodnutia:** pre "pôvod a overenie vlastností" navrhujem orchestrátorovi prideliť ďalšie voľné D
   (posledné v `main` je D-184); záznam vznikne až po odpovediach 1 až 5.
