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
| `main.py` | CLI (`--file`, `--dry-run`) |

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
cez stub kurzor.
