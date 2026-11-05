# AIM ETL: IFC -> Supabase

A Python pipeline that reads an IFC model and fills the Supabase schema (`objects` +
`rel_*` + classifications + GUID history) according to `../SCHEMA.md` and the conventions in
`../AGENTS.md`. Architecture and decisions: **D-031** in `../DECISIONS.md`.

> **Status (E2):** mapping tuned to the thesis model (`ASR.ifc`): import scope
> (D-034), floor consolidation (D-035), 18 SNIM categories, psets/classifications/GUID.
> `--dry-run` verified (681 assets, 5 floors, 89 spaces). A real load replaces
> `../supabase/seed.sql` (`--reset`). VZT.ifc, documents and ICDD export are further E-sprints.

## Structure
| File | Purpose |
|---|---|
| `extract.py` | opening the IFC + low-level helpers (ifcopenshell) |
| `scheme.py` | coding scheme: field-source resolver + SNIM definition (`object_ref`, D-033) |
| `manifest.py` | relationship manifest (D-051): `rel_type` spec verified against the IFC schema; `EDGE_TYPE_TO_REL_TYPE` routing; SQL for `relationship_types` |
| `transform.py` | IFC -> staged model (mapping per SCHEMA/§4) |
| `model.py` | intermediate dataclasses (staged rows) + `CoverageReport` |
| `db.py` | idempotent upsert into Postgres in FK order; edges -> generic `relationships` (D-051), except IFC relationships from the revision copy (D-183 K3) |
| `ids.py` | deterministic UUIDs for tables without a natural unique key |
| `config.py` | loading `DATABASE_URL` |
| `main.py` | CLI (`--file`, `--dry-run`, `--model`) |
| `model_publish.py` | IFC model revisions: safeguard, archive, compare-and-swap, live channel (D-086) |
| `documents.py` | documents from IFC: `Location` -> file in the `documents` bucket, closing the old set (D-104) |

## Prerequisites
- **Python 3.9+** (verified with 3.9 + `ifcopenshell 0.8.4`).
- `DATABASE_URL` in `../.env.local`: Supabase -> Project Settings -> Database ->
  Connection string (URI). Secret, gitignored.

## Installation and running
```bash
python -m venv etl/.venv && source etl/.venv/Scripts/activate   # Windows: etl/.venv/Scripts/activate
pip install -r etl/requirements.txt

# put the IFC file in etl/data/ (gitignored), then from the repo root:
python -m etl.main --file etl/data/model.ifc --dry-run   # preview, no write
python -m etl.main --file etl/data/model.ifc             # write to Supabase (upsert)
python -m etl.main --file etl/data/model.ifc --reset     # empty the AIM data, then load
```

> **Windows:** the console is `cp1250` -> run with `PYTHONUTF8=1` (otherwise it fails on diacritics).

### Project (D-189, D-190)
Every ETL tool (`etl.main`, `model_publish`, `revision_copy`, `revision_compare`, `derive`, `ids_check`,
`doc_upload`, `pdf_link`, `pdf_text`, `documents`) takes `--project <code>`, default env `AIM_PROJECT`, else `OCB`.
The code is `IfcProject.Name` of every file and the `object_ref` of the project node (`objects`,
`object_type = 'project'`); a file with another Name fails with a clear error. All rows are written into that
project, and closing stale rows, retiring objects, repointing, `close-legacy` and `--reset` never touch another
project.
- The first main-model load of a new code creates the project node from the file's IfcProject. A discipline model
  (`--federate`) needs the node; its IfcProject GlobalId becomes an `ifc_guid_aliases` row of the node (IFC defines
  IfcProject per exchange).
- Outside OCB (D-190): file names follow the CDE scheme (D-036) with type `DiMS` and the code first,
  `<code>_<stage>_<part>_<discipline>_DiMS_<number>_<description>.ifc`; node refs are `<code>:<ref>` (QR tags stay
  unique, the plain ref is `properties._ref`); revisions are archived by the model UUID,
  `ifc/archive/<information_containers.id>/vNNN.ifc.gz`. OCB keeps its names, refs and paths.
- Check before a load, read only: `python -m etl.main --file X.ifc --project OCB --model ASR --dry-run --check-db`
  lists what the load would add, change (including `project_id`) or close; exit code 2 when anything differs.
- A second project may use the same model codes, GUIDs and clash or IDS codes as another one once the D-189 cleanup
  migration `20261105120000` is applied. Every write names `project_id`; `model_revisions` needs `container_id` and
  the revision copy `model_revision_id` (no database default or lookup fills them).

### Relationship manifest (D-051)
Since F1, edges live in the generic `relationships` (discriminator `rel_type`); the list of types +
their IFC semantics lives in the manifest (`manifest.py`, verified against the IFC schema). Regenerating
SQL for a migration / checking:
```bash
python -m etl.manifest --check   # validate rel_type against the IFC schema
python -m etl.manifest --sql     # INSERT into relationship_types (into a migration)
```

### IFC pset definition manifest (D-061)
A static dictionary of standard psets (meaning/type/enum of properties) for LLM grounding,
generated from the `ifcopenshell` bSDD/psd templates ONLY for the project's classes:
```bash
python -m etl.pset_manifest --check            # validation + summary
python -m etl.pset_manifest --classes-from-db  # classes from objects.ifc_type
python -m etl.pset_manifest --sql              # INSERT into ifc_property_definitions (into a NEW migration)
```

### PDF text extraction (D-063)
Text of all PDFs from `docs.csv` per page -> `document_pages` (full text of document
content for the LLM tool `search_documents`). Run after the E3 document upload, where
the PDFs are local (`podklady/FINAL`, same contract as E4):
```bash
python -m etl.pdf_text --dry-run   # extraction + report, no write
python -m etl.pdf_text             # idempotent write (delete+insert per document)
```
Documents from IFC (D-104) are not in the manifest; their PDFs are in the `documents` bucket. The text of all
live documents (including lines with their position on the page, `document_pages.blocks`, D-123) is loaded by:
```bash
python -m etl.pdf_text --from-db --dry-run   # downloads the PDFs, report, no write
python -m etl.pdf_text --from-db             # write; --only <object_ref> = one document
```
For each document the report also lists pages without a text layer (`obrázok` = image: text as raster/CCITT mask, `krivky` = curves, `prázdna` = empty).
Pages `obrázok` and `krivky` are read by OCR (D-169, #279): Tesseract `ces+slk+eng`, lines in `blocks` with `src: "ocr"` and `conf`,
`search_documents` reports them as `source: "ocr"`. Pages with a text layer never go to OCR. On by default
(also in `etl.doc_upload`), `--no-ocr` turns it off, `--dry-run` does not run OCR and prints "Do OCR by išlo: N strán" ("Would go to OCR: N pages").
Tesseract with languages is required (without it the run continues without OCR and says so):
```bash
sudo apt-get install -y tesseract-ocr tesseract-ocr-ces tesseract-ocr-slk tesseract-ocr-eng   # Ubuntu, GitHub Actions
# Windows: UB Mannheim installer (github.com/UB-Mannheim/tesseract), languages Czech + Slovak, tesseract.exe on PATH
pip install -r etl/requirements.txt                                                            # pytesseract
python -m etl.pdf_text --from-db --dry-run    # number of pages for OCR
python -m etl.pdf_text --from-db              # write including OCR
```

The run also writes `document_pages.page_size` (page size in points) and `documents.file_sha256`
(sha256 of the PDF file, revision anchor for comments and the crop snapshot cache, D-158 step 3; after migration
`20261023140000`). Page rasters are not made: the host renders the crop snapshot on request.

Drawing lines (`document_pages.lines`, underlay calibration, D-133) are stored on every run; thinner drawings
(fire floor plans) get a lower thickness threshold (0.5 or 0.25 pt, `lines.min_w`). New PDFs from `etl.doc_upload`
are loaded right after upload (`--no-pdf-text` turns this off); documents already uploaded without lines are filled in by
`python -m etl.pdf_text --from-db` (or with `--only <object_ref>`).

One-off run after deploying the D-133 addition (#283), from the repo root:
```bash
pip install -r etl/requirements.txt           # PyMuPDF and psycopg
export DATABASE_URL='postgresql://...'        # the only required env (or a line in .env.local), Supabase -> Database -> URI
export PYTHONUTF8=1                           # Windows only
python -m etl.pdf_text --from-db --dry-run --only OCB_SO01_PBR_D-1-3-02_PODORYS-1NP   # check: column "čiar" (lines) > 0
python -m etl.pdf_text --from-db              # all live PDFs (write delete+insert per document, idempotent)
```
PDFs are downloaded from `documents.location` (public URLs in Storage), so `SUPABASE_SERVICE_ROLE_KEY` is not needed.

### Documents from IFC (D-104)
The model carries the documentation: each `IfcDocumentInformation` is a `document` with `object_ref` =
`Identification` (including folder parts without a file), the tree from
`IfcDocumentInformationRelationship` is `rel_document_information_relationship` (part ->
parent), `IfcDocumentReference` is `document_reference` (e.g. a page of the build-up schedule,
`object_ref` = `<document Identification>#page=N`). The document kind is a classification
(`IfcClassificationReference` via `IfcExternalReferenceRelationship`, ASR v77: information type
ISO 19650) and goes into `rel_external_reference_relationship` (document -> reference). The load translates `Location`
(`../Dokumentacia/<Identification>.pdf`) to the public URL of the file in the `documents` bucket, if a
file with the same name is there (`storage_type='supabase'`, needs `SUPABASE_URL`); the original value
stays in `properties._ifc_location`. Documents carry `properties._model`; a document that the model
stops issuing is closed by the `--model` run. The old E3 set and ETL documents from before D-104 (without
`_model`) are closed once by:
```bash
python -m etl.documents close-legacy --dry-run   # how many would be closed
python -m etl.documents close-legacy             # documents without _model + their links
```
In production both are run by the `reetl` workflow in the OCB repo (re-ETL of the current revision without a new
revision, `close_legacy_documents`).

An object upsert overwrites `properties` with what the model issues, except the host keys
(`HOST_PROPERTY_KEYS` in `db.py`, today `_georef` = drawing underlay calibration from PATCH
`/api/underlay`): those stay, re-ETL does not delete them (D-104 step 3).

### `--reset` (replacing the seed, E2)
Before the load, `--reset` empties the graph of **one project** (D-189): its edges, GUID aliases and nodes except the
project node; revisions, containers, classification and actors stay. Other projects are never deleted (no `TRUNCATE`).
It is not run in production (AGENTS.md). Without `--reset` it is a clean idempotent upsert (a re-run of the same model
duplicates nothing).

## Derived edges: `etl.derive` (D-080)

Post-processing over already loaded models: edges that are in no source IFC,
but can be derived. The first deriver `spatial_reference` assigns elements (VZT, furniture...) to
rooms by geometry as `rel_referenced_in_spatial_structure`:

```bash
# first without DB: summary, QA of overlapping spaces, CSV report
python -m etl.derive spatial_reference --models podklady/FINAL/ASR.ifc podklady/FINAL/VZT.ifc --dry-run --report out/spatial.csv
# write (idempotent; edges the run no longer derives are closed)
python -m etl.derive spatial_reference --models podklady/FINAL/ASR.ifc podklady/FINAL/VZT.ifc
```

Geometry is handled by ifcopenshell (`geom.tree` over BRep bodies): `inside` = element fully in the space
body, `partial` = element intersects the body. The IfcSpace body in the model decides: if VZT
in the suspended ceiling does not fall into a room, the space body in the model needs fixing.
The first model is the reference coordinate frame, the others are aligned via `IfcMapConversion`.
Options: `--include` (element classes), `--spatial` (space classes), `--inside-only`
(only elements fully inside, without `partial`). It runs **after** `etl.main`
of both models (elements and spaces must be in the DB, matching is by the active IFC GUID).

### Derivation rule register (D-089)
Which derivations run is in the DB (`derivation_rules`), not in the workflow. Each run is written to
`derivation_runs`.
```bash
python -m etl.derive rules                                        # status and last run
python -m etl.derive run --models ASR.ifc VZT.ifc --trigger auto  # after a new revision
python -m etl.derive run --models ASR.ifc VZT.ifc --rule element_in_spatial_zone
python -m etl.derive disable --rule element_in_spatial_zone       # closes its edges
python -m etl.derive enable --rule element_in_spatial_zone --mode manual
```
Geometric rules (`element_in_space`, `element_in_spatial_zone`) are computed in one
pass and the edges are split by target class; `element_in_zone` is the view
`v_zone_elements` (element in an IfcZone via spaces). `spatial_reference` stays as the direct
D-080 deriver (by default IfcSpace only).

## Checking the model against IDS: `etl.ids_check` (D-081)

IDS is produced by the requirements library (`assetin-library`), it is not copied here. The step verifies the model
with ifctester and writes the results (specification x element, pass/fail + reasons) to `ids_runs` /
`ids_results`; the AI reads them via `v_ids_summary` / `v_ids_latest`.

```bash
python -m etl.ids_check --ids ../assetin-library/tests/fixtures/ids/ER-0101_ARCH.ids \
    --model podklady/FINAL/ASR.ifc --label ASR --source "assetin-library@<commit>" --dry-run --report out/ids.csv
```

It runs **after** `etl.main` (elements are matched by the active IFC GUID). Each run is a new
record (the compliance history stays); the views show the last run. IDS for the ARCH exchange is
run on ASR, not on VZT: specifications with `minOccurs=1` would otherwise report that there is nothing in the model.

## Model revisions: `etl.model_publish` (D-086)

The IFC file is the master. Each published version of a model = an immutable copy
`ifc/archive/<model>/vNNN.ifc.gz` + a `model_revisions` row; the current one is also at
`ifc/<model>.ifc`. Env: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
optionally `LIVE_CHANNEL`. D-189: the model is the container of a project (`--project`); the advisory lock and the
compare-and-swap are per container, readers take the stored `archive_path`; outside OCB the archive is
`ifc/archive/<container uuid>/vNNN.ifc.gz` and the current key `ifc/<container uuid>.ifc` (D-190).

Order of one change (the same in the OCB repo's GitHub Actions):
```bash
python -m etl.model_publish publish --model ASR --file ASR_v73.ifc --base 72 \
    --changes zmeny.json --summary "..."        # safeguard -> archive -> revision (compare-and-swap)
python -m etl.main --file ASR_v73.ifc --model ASR              # re-ETL with the model source
python -m etl.derive spatial_reference --models ASR_v73.ifc VZT.ifc
python -m etl.model_publish announce --model ASR               # "new revision" to the viewer
```
- **Safeguard** (no IDS): the file opens, the schema stays, no GlobalId appears twice and
  every added/removed object (`IfcObjectDefinition`) is in the change list as `add` /
  `remove`. Fails -> code 2, nothing is written. `--dry-run` = safeguard only.
- **Conflict** (code 3): the current revision is no longer `--base` -> run the recipe over the new one.
- `revert --model ASR --to 71` = a new revision with the content of v71; `sync` = current key again
  from the archive; `status` = list of revisions.
- Change list (`zmeny.json`): `{"summary": "...", "changes": [{"guid", "ifc_class",
  "op": "add|remove|modify", "what", "before", "after"}]}`.

### Recipe in AIMviewer: VZT per BCF #14, #15, #17 (`scripts/vzt/`)
Most recipes live in OCB (`recepty/<MODEL>/vNNN-*.py`); this one is in AIMviewer so that
it can be repeated over another revision without changing code. The values are in `bcf_opravy.json`
with a status: `dolozene` (source in the model or a document) and `potvrdene` (Samuel) are
applied, `navrh` only with `--vratane-navrhov` (preview, do not publish), `chyba_hodnota`
never. After approval the status in the JSON changes to `potvrdene`, the code does not change. GlobalIds stay,
only Name/Description/PredefinedType, psets and materials change (safeguard: 0 added,
0 removed). #13 does not change the model (damper ports are connected, the bug was in the tool, #300).
```bash
curl -sS -o VZT_v010.ifc.gz "$SUPABASE_URL/storage/v1/object/public/ifc/archive/VZT/v010.ifc.gz"
gunzip VZT_v010.ifc.gz            # sha256 f2a4491540357d62ee0460a7f527bdd3fe6fa47c7d5749c21840a605f05be67f
python scripts/vzt/bcf_opravy.py --vstup VZT_v010.ifc --vystup VZT_v011.ifc --zmeny zmeny_v011.json
python scripts/vzt/kontrola.py --ifc VZT_v011.ifc            # IDS bcf_opravy.ids, damper ports, schema
python scripts/vzt/ifc_diff.py --pred VZT_v010.ifc --po VZT_v011.ifc --detail 20
python -m etl.model_publish publish --model VZT --file VZT_v011.ifc --base 10 \
    --changes zmeny_v011.json --recipe "Menezeris/AIMviewer:scripts/vzt/bcf_opravy.py@<commit>" --dry-run
```
Publishing is then the same command without `--dry-run` and then per the order above
(`etl.main --model VZT`, `etl.derive run --trigger auto`, `announce`). If a new VZT revision appears
in the meantime, `--base` ends in a conflict (code 3): the recipe is run again over it.

**IFC relationships from the revision copy (D-183 K3 step 3):** `rel_aggregates`, `rel_contained_in_spatial_structure`,
`rel_defines_by_type`, `rel_assigns_to_group`, `rel_associates_document` and `rel_associates_classification` are neither written
to nor closed in `relationships` by the graph ETL (`manifest.FROM_REVISION_COPY`, `db.writes_edge`); their views read
`ifc_rev_relationships` (`etl.revision_copy`). The transformation still assembles them (dry-run, tests), only an AIM layer
edge of these types is written (source is not `etl*`). Nodes, GUID history, classification references and other edge types stay.
Merged IFC types with the same type code (D-033) are written as a GUID alias (`ifc_guid_aliases`, source `IFC import:<model>`).
Old ETL edges of these types are closed by a separate step `supabase/migrations/20261031190000_end_etl_ifc_edges.sql`.

**`--model` in `etl.main`:** edges, GUID history and aliases get the model source (`etl:ASR`,
`IFC import:ASR`); what the run did not issue (deleted, moved, renamed element) is closed.
A new parent in `rel_aggregates` / `contained` / `defines_by_type` closes the old one before the
insert. **First pass** from data without a model name: load both ASR and VZT with `--model`, then once
`python -m etl.model_publish close-legacy`. Links of documents/actors to entities that ETL
does not emit (IfcZone, IfcSpatialZone, IfcGroup, IfcProject) are skipped and printed.

## Full revision copy - `etl.revision_copy` and `etl.revision_compare` (D-183 K2)

The revision container is the truth (D-183); the DB carries its full copy without geometry next to the AIM graph (`objects`,
`relationships` do not change). A generic rule, nothing is selected: every IfcRoot except relationships and sets
(`ifc_rev_objects`), every Relating x Related pair from every IfcRel* except IfcRelDefinesByProperties
(`ifc_rev_relationships`, key class, carrier, other side) and every pset, Qto and predefined set on the occurrence
and the type (`ifc_rev_property_sets`, key carrier, pset name). Every row carries `(model, revision)` and `content_hash`.

```bash
python -m etl.revision_copy --model VZT                  # current revision from the archive (Storage, verifies sha256)
python -m etl.revision_copy --model ASR --revision 79    # a specific revision; already done with the same sha256 = already_done
python -m etl.revision_copy --model VZT --archive-file v011.ifc.gz --dry-run   # extraction and counts only, no DB
python -m etl.revision_compare --model VZT --from 10 --to 11 [--placement]     # comparison on request, writes nothing
```

- Duplicate GlobalId or sha256 mismatch = the revision is not indexed. The write is one transaction: copy, completeness check
  (counts per class from the file = DB, every IfcRoot counted), `ifc_rev_imports.status = 'done'`, filling in the header
  and `IfcApplication` into `container_revisions`. Error = nothing is written, a `failed` row with the reason.
- Acceptance test: `select count(*) from ifc_rev_storey_elements('VZT', null, '2NP', 'Prívod%')` = 212 (also 3NP).
- Placement is not in the DB: `--placement` reads both archives (relative to the storey, port to host, tolerance 1 mm and
  0.001 rad, georeference and common offset once).
- Measured 30 Oct locally: VZT v11 1.8 s, ASR v79 2.5 s (extraction + write), both revisions together 20 MB with indexes;
  comparison of two VZT revisions in the DB 0.1 s, with placement from files ~9 s.

## Idempotency (D-031)
- `objects` upsert via `object_ref` (UNIQUE) -> `id` stays DB-generated (D-010).
- Edges / systems / GUID history -> deterministic UUIDs (`ids.py`), `ON CONFLICT (id)`.
- A re-run of the same model duplicates nothing. When data changes outside the Viewer's revalidation
  window see `revalidateTag("aim")` (D-030).

## `object_ref` from the scheme (E1, D-033)
`object_ref` is built from the **project coding scheme** (`scheme.py`), not from the IFC `Tag`.
SNIM: `Assembly Code` (TSP+PSP) + `Type Mark` (UOT) + `Mark` (INST) -> type `DD01.06`,
instance `DD01.06.03`. The category is set by the **`Assembly Code` prefix** (read across
psets). Fallback to `ifc_guid` only when the code is missing/not unique. `--dry-run` prints a
**coverage report** (coverage by SNIM code vs. fallback, per IFC class). Another project =
another `CodingScheme` in `scheme.py`, the code does not change.

## Import scope: policy (D-034)
What is an `asset` is **not hardcoded** in `transform.py`, but a `ScopePolicy` in `scheme.py`:
asset = **top-level** element (`get_aggregate` = space/None) minus voids
(`IfcFeatureElement`) and sub-components (nested curtain wall mullions/panels, roof layers,
stair flights); **exception** = nested `IfcDoor`/`IfcWindow` stay assets. An `asset_type`
is created **only for types referenced by an asset** (no `IfcSpaceType`/types of excluded
components). On ASR: **681 assets** out of 2706 `IfcElement`.

## Floor consolidation (D-035)
Auxiliary Revit levels (`1NP_SH_ZD`, `2NP_HH_STROP`, `Dojazd_výťahov`, ...) are NOT emitted
as `floor` nodes: they are remapped to the real floor (`^\d+NP$` / has spaces) by the
NP prefix of the name, otherwise by the nearest elevation. ASR: 18 storeys -> **5 floors** (`1NP` to `5NP`).

## SNIM categories (`scheme.py`)
18 categories: 8 from `SNIM - Hierarchia.pdf` (DD, SN, FS, PH, ST, PD, ZV, KV) + 10
added in E2 (OV, PL, LP, ZD, DZ, SD, IH, VT, SH, TV). The coverage report no longer reports
"TSP mimo schémy" ("TSP outside the scheme"). Most categories have type coding only (no `Mark`) -> the instance
goes to the GUID fallback (correct: no instance tag is forced).

## Unit tests
`pip install -r etl/requirements-dev.txt`, then from the repo root `python -m pytest etl/tests -q`.
The tests are purely local (no DB/Supabase): they cover manifest parsing and the load logic
via a stub cursor. Tests against a database (`test_model_publish.py`, `test_revision_copy.py`,
`test_multi_project_load.py`) need a local Postgres database with all migrations and the OCB project node in
`AIM_TEST_DATABASE_URL` (never production), otherwise they are skipped; each test creates its own project and
deletes it afterwards.
