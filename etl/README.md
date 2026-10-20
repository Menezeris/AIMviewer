# AIM ETL — IFC → Supabase

Python pipeline, ktorá načíta IFC model a naplní Supabase schému (`objects` +
`rel_*` + klasifikácie + GUID história) podľa `../SCHEMA.md` a konvencií v
`../AGENTS.md`. Architektúra a rozhodnutia: **D-031** v `../DECISIONS.md`.

> **Stav (E2):** mapovanie doladené na model diplomky (`ASR.ifc`) — rozsah importu
> (D-034), konsolidácia podlaží (D-035), 18 SNIM kategórií, psety/klasifikácie/GUID.
> `--dry-run` overený (681 assetov, 5 podlaží, 89 priestorov). Reálny load nahrádza
> `../supabase/seed.sql` (`--reset`). VZT.ifc, dokumenty a ICDD export sú ďalšie E-sprinty.

## Štruktúra
| Súbor | Účel |
|---|---|
| `extract.py` | otvorenie IFC + nízkoúrovňové helpery (ifcopenshell) |
| `scheme.py` | kódovacia schéma — field-source resolver + SNIM definícia (`object_ref`, D-033) |
| `manifest.py` | manifest vzťahov (D-051) — `rel_type` spec overený proti IFC schéme; `EDGE_TYPE_TO_REL_TYPE` routing; SQL pre `relationship_types` |
| `transform.py` | IFC → staged model (mapovanie podľa SCHEMA/§4) |
| `model.py` | medziľahlé dataclassy (staged riadky) + `CoverageReport` |
| `db.py` | idempotentný upsert do Postgresu v poradí FK; hrany → generická `relationships` (D-051) |
| `ids.py` | deterministické UUID pre tabuľky bez prirodzeného unique |
| `config.py` | načítanie `DATABASE_URL` |
| `main.py` | CLI (`--file`, `--dry-run`, `--model`) |
| `model_publish.py` | revízie IFC modelov: poistka, archív, compare-and-swap, živý kanál (D-086) |
| `documents.py` | dokumenty z IFC: `Location` → súbor v buckete `documents`, ukončenie starej sady (D-104) |

## Predpoklady
- **Python 3.9+** (overené s 3.9 + `ifcopenshell 0.8.4`).
- `DATABASE_URL` v `../.env.local` — Supabase → Project Settings → Database →
  Connection string (URI). Tajné, gitignored.

## Inštalácia a spustenie
```bash
python -m venv etl/.venv && source etl/.venv/Scripts/activate   # Windows: etl/.venv/Scripts/activate
pip install -r etl/requirements.txt

# IFC súbor daj do etl/data/ (gitignored), potom z koreňa repa:
python -m etl.main --file etl/data/model.ifc --dry-run   # náhľad, bez zápisu
python -m etl.main --file etl/data/model.ifc             # zápis do Supabase (upsert)
python -m etl.main --file etl/data/model.ifc --reset     # vyprázdni AIM dáta, potom load
```

> **Windows:** konzola je `cp1250` → spúšťaj s `PYTHONUTF8=1` (inak padne na diakritike).

### Manifest vzťahov (D-051)
Hrany od F1 žijú v generickej `relationships` (diskriminátor `rel_type`); zoznam typov +
ich IFC sémantika žije v manifeste (`manifest.py`, overený proti IFC schéme). Regenerácia
SQL pre migráciu / kontrola:
```bash
python -m etl.manifest --check   # validácia rel_type proti IFC schéme
python -m etl.manifest --sql     # INSERT do relationship_types (do migrácie)
```

### Manifest IFC pset definícií (D-061)
Statický slovník štandardných psetov (význam/typ/enum properties) pre LLM grounding —
generuje sa z bSDD/psd šablón `ifcopenshell` LEN pre triedy projektu:
```bash
python -m etl.pset_manifest --check            # validácia + súhrn
python -m etl.pset_manifest --classes-from-db  # triedy z objects.ifc_type
python -m etl.pset_manifest --sql              # INSERT do ifc_property_definitions (do NOVEJ migrácie)
```

### Extrakcia textu PDF (D-063)
Text všetkých PDF z `docs.csv` per strana → `document_pages` (fulltext v obsahu
dokumentov pre LLM tool `search_documents`). Spúšťaj po E3 uploade dokumentov, tam kde
sú PDF lokálne (`podklady/FINAL`, rovnaký kontrakt ako E4):
```bash
python -m etl.pdf_text --dry-run   # extrakcia + report, bez zápisu
python -m etl.pdf_text             # idempotentný zápis (delete+insert per dokument)
```
Dokumenty z IFC (D-104) v manifeste nie sú; ich PDF ležia v buckete `documents`. Text všetkých
živých dokumentov (aj riadky s polohou na strane, `document_pages.blocks`, D-123) načíta:
```bash
python -m etl.pdf_text --from-db --dry-run   # stiahne PDF, report, bez zápisu
python -m etl.pdf_text --from-db             # zápis; --only <object_ref> = jeden dokument
```

### Dokumenty z IFC (D-104)
Dokumentáciu nesie model: každý `IfcDocumentInformation` je `document` s `object_ref` =
`Identification` (aj priečinkové časti bez súboru), strom z
`IfcDocumentInformationRelationship` je `rel_document_information_relationship` (časť →
nadradený), `IfcDocumentReference` je `document_reference` (napr. strana výpisu skladieb,
`object_ref` = `<Identification dokumentu>#page=N`). Druh dokumentu je klasifikácia
(`IfcClassificationReference` cez `IfcExternalReferenceRelationship`, ASR v77: typ informácie
ISO 19650) a ide do `rel_external_reference_relationship` (dokument → referencia). Load preloží `Location`
(`../Dokumentacia/<Identification>.pdf`) na verejnú URL súboru v buckete `documents`, ak tam
súbor s rovnakým menom je (`storage_type='supabase'`, treba `SUPABASE_URL`); pôvodná hodnota
ostane v `properties._ifc_location`. Dokumenty nesú `properties._model`; dokument, ktorý model
prestane vydávať, `--model` beh ukončí. Starú sadu E3 a dokumenty ETL pred D-104 (bez
`_model`) jednorazovo ukončí:
```bash
python -m etl.documents close-legacy --dry-run   # koľko by sa ukončilo
python -m etl.documents close-legacy             # dokumenty bez _model + ich väzby
```
Na produkcii oboje spúšťa workflow `reetl` v repe OCB (re-ETL aktuálnej revízie bez novej
revízie, `close_legacy_documents`).

Upsert objektu prepíše `properties` tým, čo vydá model, okrem kľúčov hostiteľa
(`HOST_PROPERTY_KEYS` v `db.py`, dnes `_georef` = kalibrácia podkladu výkresu z PATCH
`/api/underlay`): tie ostanú, re-ETL ich nezmaže (D-104 krok 3).

### `--reset` (nahradenie seedu, E2)
`--reset` pred loadom `TRUNCATE ... CASCADE` vyprázdni AIM dáta (riadky, nie schému) —
použité raz pri výmene ručného seedu za reálne ETL dáta. Seed je reprodukovateľný
z `../supabase/seed.sql`, takže je to vratné. Bez `--reset` ide čistý idempotentný
upsert (re-run rovnakého modelu nič neduplikuje).

## Odvodené hrany — `etl.derive` (D-080)

Post-processing nad už naloadenými modelmi: hrany, ktoré v žiadnom zdrojovom IFC nie sú,
ale dajú sa odvodiť. Prvý odvodzovač `spatial_reference` zaradí prvky (VZT, nábytok…) do
miestností geometriou ako `rel_referenced_in_spatial_structure`:

```bash
# najprv bez DB: zhrnutie, QA prekrývajúcich sa priestorov, CSV report
python -m etl.derive spatial_reference --models podklady/FINAL/ASR.ifc podklady/FINAL/VZT.ifc --dry-run --report out/spatial.csv
# zápis (idempotentný; hrany, ktoré beh už neodvodí, sa uzavrú)
python -m etl.derive spatial_reference --models podklady/FINAL/ASR.ifc podklady/FINAL/VZT.ifc
```

Geometriu rieši ifcopenshell (`geom.tree` nad BRep telesami): `inside` = prvok celý v tele
priestoru, `partial` = prvok telo pretína. Rozhoduje telo IfcSpace v modeli — ak VZT
v podhľade nepadne do miestnosti, treba opraviť telo priestoru v modeli.
Prvý model je referenčný súradnicový rámec, ostatné sa zarovnajú cez `IfcMapConversion`.
Voľby: `--include` (triedy prvkov), `--spatial` (triedy priestorov), `--inside-only`
(len prvky celé vnútri, bez `partial`). Spúšťa sa **po** `etl.main`
oboch modelov (prvky aj priestory musia byť v DB, páruje sa cez aktívny IFC GUID).

### Register pravidiel odvodení (D-089)
Ktoré odvodenia bežia, je v DB (`derivation_rules`), nie vo workflowe. Každý beh sa zapíše do
`derivation_runs`.
```bash
python -m etl.derive rules                                        # stav a posledný beh
python -m etl.derive run --models ASR.ifc VZT.ifc --trigger auto  # po novej revízii
python -m etl.derive run --models ASR.ifc VZT.ifc --rule element_in_spatial_zone
python -m etl.derive disable --rule element_in_spatial_zone       # uzavrie jeho hrany
python -m etl.derive enable --rule element_in_spatial_zone --mode manual
```
Geometrické pravidlá (`element_in_space`, `element_in_spatial_zone`) sa počítajú jedným
prechodom a hrany sa rozdelia podľa cieľovej triedy; `element_in_zone` je pohľad
`v_zone_elements` (prvok v IfcZone cez priestory). `spatial_reference` ostáva ako priamy
odvodzovač D-080 (predvolene len IfcSpace).

## Kontrola modelu voči IDS — `etl.ids_check` (D-081)

IDS vyrába knižnica požiadaviek (`assetin-library`), sem sa nekopíruje. Krok overí model
ifctesterom a výsledky (špecifikácia × prvok, pass/fail + dôvody) zapíše do `ids_runs` /
`ids_results`; AI ich číta cez `v_ids_summary` / `v_ids_latest`.

```bash
python -m etl.ids_check --ids ../assetin-library/tests/fixtures/ids/ER-0101_ARCH.ids \
    --model podklady/FINAL/ASR.ifc --label ASR --source "assetin-library@<commit>" --dry-run --report out/ids.csv
```

Spúšťa sa **po** `etl.main` (prvky sa párujú cez aktívny IFC GUID). Každý beh je nový
záznam (história plnenia ostáva); pohľady ukazujú posledný beh. IDS pre ARCH výmenu sa
púšťa na ASR, nie na VZT — špecifikácie s `minOccurs=1` by inak hlásili, že v modeli nič nie je.

## Revízie modelov — `etl.model_publish` (D-086)

IFC súbor je master. Každá zverejnená verzia modelu = nemenná kópia
`ifc/archive/<model>/vNNN.ifc.gz` + riadok `model_revisions`; aktuálna je aj na
`ifc/<model>.ifc`. Env: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
voliteľne `LIVE_CHANNEL`.

Poradie jednej zmeny (rovnaké v GitHub Actions repa OCB):
```bash
python -m etl.model_publish publish --model ASR --file ASR_v73.ifc --base 72 \
    --changes zmeny.json --summary "..."        # poistka → archív → revízia (compare-and-swap)
python -m etl.main --file ASR_v73.ifc --model ASR              # re-ETL so zdrojom modelu
python -m etl.derive spatial_reference --models ASR_v73.ifc VZT.ifc
python -m etl.model_publish announce --model ASR               # "nová revízia" do viewera
```
- **Poistka** (bez IDS): súbor sa otvorí, schéma ostáva, žiadny GlobalId nie je dvakrát a
  každý pridaný/odobratý objekt (`IfcObjectDefinition`) je v zozname zmien ako `add` /
  `remove`. Neprejde → kód 2, nič sa nezapíše. `--dry-run` = len poistka.
- **Konflikt** (kód 3): aktuálna revízia už nie je `--base` → recept spustiť nad novou.
- `revert --model ASR --to 71` = nová revízia s obsahom v71; `sync` = aktuálny kľúč znova
  z archívu; `status` = zoznam revízií.
- Zoznam zmien (`zmeny.json`): `{"summary": "...", "changes": [{"guid", "ifc_class",
  "op": "add|remove|modify", "what", "before", "after"}]}`.

**`--model` v `etl.main`:** hrany a GUID história dostanú zdroj modelu (`etl:ASR`,
`IFC import:ASR`); čo beh nevydal (zmazaný, presunutý, premenovaný prvok), sa uzavrie.
Nový rodič pri `rel_aggregates` / `contained` / `defines_by_type` uzavrie starého pred
insertom. **Prvý prechod** z dát bez mena modelu: načítať ASR aj VZT s `--model`, potom raz
`python -m etl.model_publish close-legacy`. Väzby dokumentov/aktorov na entity, ktoré ETL
neemituje (IfcZone, IfcSpatialZone, IfcGroup, IfcProject), sa vynechajú a vypíšu.

## Idempotencia (D-031)
- `objects` upsert cez `object_ref` (UNIQUE) → `id` ostáva DB-generované (D-010).
- Hrany / systémy / GUID história → deterministické UUID (`ids.py`), `ON CONFLICT (id)`.
- Re-run rovnakého modelu nič neduplikuje. Pri zmene dát mimo revalidačného okna
  Viewera viď `revalidateTag("aim")` (D-030).

## `object_ref` zo schémy (E1, D-033)
`object_ref` sa skladá z **kódovacej schémy projektu** (`scheme.py`), nie z IFC `Tag`.
SNIM: `Assembly Code` (TSP+PSP) + `Type Mark` (UOT) + `Mark` (INST) → type `DD01.06`,
inštancia `DD01.06.03`. Kategóriu určuje **prefix `Assembly Code`** (čítané naprieč
psetmi). Fallback na `ifc_guid` len keď kód chýba/nie je unikátny. `--dry-run` vypíše
**coverage report** (pokrytie SNIM kódom vs. fallback, po IFC triedach). Iný projekt =
iná `CodingScheme` v `scheme.py`, kód sa nemení.

## Rozsah importu — policy (D-034)
Čo je `asset` **nie je hardcoded** v `transform.py`, ale `ScopePolicy` v `scheme.py`:
asset = **top-level** prvok (`get_aggregate` = priestor/None) mínus voidy
(`IfcFeatureElement`) a sub-komponenty (vnorené stĺpiky/panely fasády, vrstvy strechy,
ramená schodov); **výnimka** = vnorené `IfcDoor`/`IfcWindow` ostávajú asset. `asset_type`
sa tvorí **len pre typy referencované assetom** (žiadny `IfcSpaceType`/typy vyradených
komponentov). Na ASR: **681 assetov** z 2706 `IfcElement`.

## Konsolidácia podlaží (D-035)
Pomocné Revit úrovne (`1NP_SH_ZD`, `2NP_HH_STROP`, `Dojazd_výťahov`, …) sa NEemitujú
ako `floor` uzly — premapujú sa na reálne podlažie (`^\d+NP$` / má priestory) podľa
NP-prefixu názvu, inak najbližšej elevácie. ASR: 18 storeys → **5 podlaží** (`1NP`–`5NP`).

## SNIM kategórie (`scheme.py`)
18 kategórií: 8 z `SNIM - Hierarchia.pdf` (DD, SN, FS, PH, ST, PD, ZV, KV) + 10
doplnených v E2 (OV, PL, LP, ZD, DZ, SD, IH, VT, SH, TV). Coverage report už nehlási
„TSP mimo schémy". Väčšina kategórií má len typové kódovanie (bez `Mark`) → inštancia
ide na GUID fallback (správne — netlačí sa inštančný tag).

## Unit testy
`pip install -r etl/requirements-dev.txt`, potom z koreňa repa `python -m pytest etl/tests -q`.
Testy sú čisto lokálne (bez DB/Supabase) — pokrývajú parsovanie manifestu a load-logiku
cez stub kurzor. Testy zápisu revízií (`test_model_publish.py`) potrebujú prázdnu Postgres
databázu v `AIM_TEST_DATABASE_URL` (migrácia sa aplikuje do vlastnej schémy testu), inak sa
preskočia.
