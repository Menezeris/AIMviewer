# AIM Platform - Agent & Developer Context

> **This is the source of truth for the project's conventions.** Every AI and coding tool reads it.
> Tool-specific files (`CLAUDE.md`, `.github/copilot-instructions.md`,
> `.cursor/rules/*.mdc`, `GEMINI.md`) are **only thin pointers here**. Do not copy content into them,
> so that they do not drift apart. Change conventions **here**.

> **Language (D-194, Samuel 5 Nov 2026):** everything in the project is English: code, identifiers, comments,
> commits, PRs, docs, D-records, changelogs, plans, answers to Samuel and the texts the AI assistant sees.
> The only exception is the app's Slovak and Czech user interface (labels and messages the user sees).
> Legacy Slovak text is translated in phases (D-194); until a file is translated, new text in it is English.
> Domain terms: [`docs/glossary.md`](docs/glossary.md).

## Documentation map (D-017)

**Golden rule:** every fact lives in **one** place, the others link to it. When you write,
first find out which document it belongs to:

| Document | Answers | What you write there |
|---|---|---|
| **AGENTS.md** (this one) | "What are the rules, how do I work here?" | Normative summary (must/never). DDL detail -> link to SCHEMA. |
| **DECISIONS.md** | "Why is it like this?" | Append-only log `D-0xx` (rationale). Every feature = a record. |
| **SCHEMA.md** | "What exactly does the DB look like?" | The single truth about DDL, views and the IFC mapping (§5). |
| **ROADMAP.md** | "What is done and what is next?" | The **only** place for the live state and sprints. |
| **README.md** | "How do I run and deploy it?" | Human onboarding. |
| **etl/README.md** | ETL pipeline | Details of running and mapping the ETL. |
| **docs/kniznica/** | Requirements library (IDM -> LOIN -> EIR): model, schema, decisions V1-V30 | The library's MODEL, DECISIONS (V31+ after Samuel's word), SCHEMA, NORMS-GAP, QUESTIONS, VALIDATION-RULES; moved from assetin-library (D-186 step 7, V30), since 4 Nov also PLAN, DATA-MODEL, PROMPT-*, REVIEW-*, POLIA, vault/ (LOIN), normy/; assetin-library is archived. The corpus `library/korpus/` is frozen by the oracle (`KORPUS_COMMIT`), the Python engine is not run, schema changes go in TS and the corpus is updated by hand with a reason (`docs/kniznica/README.md`). The port to TS is D-186. |

### How to create and edit documents (applies to EVERY tool)

We do **not merge** documents into one big file. We keep **two layers**. The reason is the
economics of context: tools pull layer 1 into every prompt, so it must be short
(decided in D-017, addendum 2026-07-07):

- **Layer 1, always loaded, short (target `AGENTS.md` about 180 lines or less):** `AGENTS.md` =
  rules + thin tool pointers. Only "must/never" rules and links belong here.
- **Layer 2, on demand, deep:** `DECISIONS.md`, `SCHEMA.md`, `ROADMAP.md`. Read when
  needed; **never merged** into layer 1 (it would flood every prompt).

Rules for writing (agent and human):
1. **First decide the target document** from the table above; if the fact belongs to layer 2, put
   at most a one-sentence link into `AGENTS.md`, not a copy.
2. **New feature => first a `D-0xx` record in `DECISIONS.md`** (rationale), only then code.
   Without a decision the feature is not built.
3. **DB change => a new migration + an update of `SCHEMA.md`** (old migrations are not deleted).
4. **Change of state or priority => only `ROADMAP.md`** (section "Stav"); the state is not duplicated anywhere else.
5. **Do not create a new .md file** until it has **a different role and a different cadence** than the existing ones.
   Prefer extending an existing document.
6. **New tool (Cline, Aider, Windsurf, Zed...) => create only a thin pointer** to `AGENTS.md`
   at the path the tool reads (e.g. `.clinerules`, `GEMINI.md`, `.aider.conf`);
   **no duplicated content**. Existing pointers: `CLAUDE.md`,
   `.github/copilot-instructions.md`, `.cursor/rules/aim-platform.mdc`. Codex and Gemini read
   `AGENTS.md` natively.
7. **Conventions change only here in `AGENTS.md`**, not in the pointers.
8. **Re-check before a sprint:** before planning or implementing each sprint, check the
   current state (ROADMAP "Stav", git, DB) and what has changed; reconsider the order and
   scope of sprints and steps accordingly, and only then write the `D-0xx` detail and code.
9. **Align the documents after a sprint or commit (multi-tool):** after finishing a sprint and after
   a commit, always align the supporting documents: `ROADMAP.md` ("Stav" and changelog), `DECISIONS.md`
   (`D-0xx`), `SCHEMA.md` (if the DB was touched) and the **thin tool pointers** (`CLAUDE.md`,
   `.github/copilot-instructions.md`, `.cursor/rules/aim-platform.mdc`, possibly `GEMINI.md`),
   so that any other tool started on the repo has current, consistent context (the source of
   truth stays `AGENTS.md`, the pointers carry no duplicated content).

### Concurrent sessions (D-090)
> **Platform work (D-191, Samuel 5 Nov 2026):** Samuel, the orchestrator, step sessions and side sessions
> work by [`AIMforked/docs/platform/orchestration.md`](https://github.com/Menezeris/AIMforked/blob/main/docs/platform/orchestration.md)
> (step sessions started from handoff briefs, merge bundles, checks before merge per repo, orchestrator
> rotation). The rules below still hold where that file says nothing.

Several Claude sessions run at once (manual, automatic from the connector, fork). Each one:
- **before planning** looks at open PRs and `claude/*` branches of the last days (`git diff --stat
  origin/main...<branch>`); it does not do the same work twice, on the same files it lets the others know
  (a comment in the PR or issue, `send_message` if it has it) and puts new logic into its own module;
- **reserves a `D-0xx` number** with a comment in the register, issue #60, and only then uses it; if it has
  `send_message`, it asks the orchestrator (below) for it, who writes it into #60 itself;
- **the live viewer is not its own** (D-159): it does not call the connector's UI tools (show, style, section,
  camera, view_mode, open_*) to verify; their commands go to the test channel `<LIVE_CHANNEL>-test`, never the
  production channel; it verifies locally;
- **before a PR** merges `origin/main` into the branch; a conflict is resolved by the branch that reached `main` later;
- **never merges** a PR (AIMviewer, fork, OCB), not even with a standing approval from another session. When the PR
  is green and without conflict, it writes to the orchestrator (`send_message`: repo#number, head, what waits),
  otherwise it puts the comment "Ready to merge" into the PR. It also sends the state and questions for Samuel to him;
  to Samuel directly only a question it needs answered in its own session.

### PRs, CI and Vercel previews (D-187)
- **The check before merge is GitHub Actions CI** (`.github/workflows/ci.yml`: tsc, eslint on changed files
  without new errors, vitest, next build without secrets), not the Vercel preview. Green CI = the condition for "Ready to merge".
- **Push only after local checks** (`npx tsc --noEmit`, `npx vitest run`, `node scripts/ci/lint-changed.mjs origin/main`,
  for page changes also the build); fixes from a review round are pushed together, not one by one. Into the bundle (release branch of the fork) once per round of fixes.
- **Preview only on request:** Vercel builds `main` and commits with the tag `[preview]` in the message (`scripts/vercel-ignore.sh`);
  changes only in `docs/`, `*.md`, `supabase/pending/`, `supabase/tests/` are not built, not even on `main`. Fork: `main` always,
  `release/aim-*` only with `[preview]`, other branches never; `[preview]` goes only on the last push of the bundle that will be tried.

**The orchestrator** (since 20 Oct 2026; which session it is, the body of issue #60 says) alone merges,
on Samuel's word and in bundles (D-116: first the fork, then AIMviewer, then OCB), assigns
`D-0xx` numbers and holds the overall state for Samuel.

Below is the normative summary of conventions. **Exact DDL, columns and views are in `SCHEMA.md`**;
here are only the rules to keep to.

## What we are building
An Asset Information Model platform for managing information about buildings
over their whole life cycle (design -> construction -> operation).
Demo on an office building (an adapted diploma thesis).
Primary use case: AIM Viewer, a showcase of correctly linked data.

## Stack
- **Supabase**: Postgres database, API, auth, storage
- **Next.js** (App Router) + TypeScript + Tailwind + shadcn/ui: frontend
- **Vercel**: hosting (own domain via Websupport)
- **Python + ifcopenshell**: IFC parser / ETL pipeline (`etl/`)
- **ICDD export**: `lib/icdd/` (TypeScript, assembled by the browser, D-181)
- **IFClite (WASM) + Three.js**: client-side 3D render (geometry is never in the DB)
- **Dependency licences:** only MIT, Apache-2.0, BSD, ISC, MPL-2.0, LGPL (dynamically linked); no AGPL or GPL; name the licence of a new dependency in the PR (D-186, ISC Samuel 2 Nov)

## Key documents, always read before work
- `DECISIONS.md`: all architecture decisions with context (D-0xx)
- `SCHEMA.md`: the current database schema (§5 = IFC mapping and extensions)
- `ROADMAP.md`: phases, sprints and priorities
- `etl/README.md`: running the ETL pipeline

## Database conventions

### Source of truth (D-183)
- **The truth is the revision container** (IFC, PDF, DWG in the archive, sha256). An accepted container never changes; a file is
  changed only by an OCB recipe in a revision we explicitly requested (BCF topic). Model data are not changed by writing to the DB.
- **DB = a complete copy of the information of every revision, without geometry** (generic rule, `(model, revision)` and
  `content_hash` in every row); it is not changed by hand; for geometry we go to the file. Changes only by comparison on request.
- **AIM layer** = only what is not in the containers (D-129); every stored result carries the revisions it was made from
  (`{model: revision}`), a signature other than the current one = `stale`, never overwritten.
- Container and revision terms follow `IfcDocumentInformation` and `IfcOwnerHistory`, in English (SCHEMA §2.19).

### Nodes, the central table `objects` (D-018)
- All nodes are rows in `objects`, distinguished by `object_type`:
  site, building, floor, space, asset, asset_type, document, person, organization,
  system (IfcDistributionSystem, D-047/D-049), capture, capture_media (Reality Capture,
  D-073), project, zone, spatial_zone, group (IfcProject/IfcZone/IfcSpatialZone/IfcGroup, D-088),
  document_reference (IfcDocumentReference, part of a document, D-104);
  further IFC entities (processes, tasks...) are **additive values** (D-051)
- **A defunct object** (`objects.valid_until` is not NULL, D-088) is seen by neither the app nor the AI: every
  new list, count or search over `objects` filters `valid_until is null`
- `object_type` is validated by the ETL and the app (NOT a CHECK; adding a type is additive)
- **Goal: cover the whole IFC ontology** (entities and relationships). Entities are already generic through
  the open `object_type`; relationships through a generic meta-model (D-051). It is not a rebuild but
  additive filling of values and `rel_type`. IFC = semantics/ontology, not the STEP file (D-046).
- **IFC attributes (D-195, round 8):** the existing columns (`ifc_guid`, `ifc_type`, `predefined_type`, `name`,
  `object_ref UNIQUE`...) stay; a new column only for values that are searched. Every other IFC attribute of a
  node goes into `properties._attributes` by its IFC name; value entities without identity (IfcTaskTime,
  IfcPostalAddress...) nested with a `_class` key. A new IFC entity is a row, not a migration: its class is
  in the manifest `entity_types` (all of IFC 4.3, `is_node`, class tree, `entity_is_a`). Columns -> `SCHEMA.md §2.1`,
  `_attributes` -> §4, manifest -> §2.24.
- Type-specific columns -> a thin 1:1 extension table (`floors`, `documents`, `persons`),
  `id` as FK to `objects(id) ON DELETE CASCADE` (`SCHEMA.md §2.2`)
- `organization` = a plain `objects` row (name = company name), without an extension table

### Property sets, three layers (D-022)
- **Attributes** (from the schema) -> columns, the rest into `properties._attributes` (D-195), never as a pset
- **Standard psets** (buildingSMART) -> `properties[<name>]`, name `Pset_`/`Qto_`
- **Custom psets** -> `properties[<name>]`, any other name (no required prefix)
- **Reserved `_keys`** (`_contact`, `_org`...) = meta or captured data, NOT psets; psets never start with `_`

### Edges, the generic meta-model `relationships` (D-051, implemented in F1; revision of D-048)
> **State (D-051, F1):** the edge layer lives in **one generic `relationships`** table (discriminator
> `rel_type`, symmetric to `objects`) + **canonical views** per type (the same names as the original
> `rel_*` = compatibility without downtime) + **the manifest `relationship_types`** (generated from the IFC schema
> by `ifcopenshell`, `etl/manifest.py`). Reason: IFC's own meta-model = `objects`
> (IfcObjectDefinition) + `relationships` (IfcRelationship, objectified) + `properties`
> (IfcPropertyDefinition); B scales to all of IFC without a migration per relationship. **IFC-canonical
> identity, the direction `subject->object` and the `aim_` namespace stay**; they live in the manifest as data
> (direction, allowed `object_type`, namespace, export path, unique-active-parent). **N-arity =
> binary `from->to`** (N-ary = N rows; keeps D-031 idempotency). **The LLM and the whitelist query
> ONLY the canonical views** (not the base table) -> text-to-SQL ergonomics kept; **writes (ETL, seed)
> go to the base `relationships`** (views are not insertable). **Integrity** = a validation trigger
> from the manifest (not a polymorphic FK); `to_id` is polymorphic (objects / `classification_references`).
> Partitions postponed (conflict "the PK must contain the partition key" x `ON CONFLICT (id)`).
> **Deployed on Supabase prod** (2026-07-07, `acwoupricatirhlfkhvk`). Exact DDL -> `SCHEMA.md §2.5/§2.6`; the `rel_type` list below.
- Every `rel_type` = a concrete IFC `IfcRelationship` subtype, **named after it**,
  with the granularity IFC distinguishes:
  `rel_aggregates` (IfcRelAggregates), `rel_contained_in_spatial_structure`
  (IfcRelContainedInSpatialStructure), `rel_defines_by_type` (IfcRelDefinesByType),
  `rel_associates_document` (IfcRelAssociatesDocument), `rel_associates_classification`
  (IfcRelAssociatesClassification), `rel_assigns_to_actor` (IfcRelAssignsToActor),
  `rel_assigns_to_group` (IfcRelAssignsToGroup, systems, D-047),
  `rel_referenced_in_spatial_structure` (IfcRelReferencedInSpatialStructure, an element also in another
  space, non-exclusive; derived by `python -m etl.derive`, D-080),
  `rel_member_of` (IfcPersonAndOrganization, **a resource, not an IfcRel**; honestly outside the taxonomy),
  `rel_document_information_relationship` (IfcDocumentInformationRelationship, the documentation tree,
  a resource like `rel_member_of`, D-104),
  `rel_external_reference_relationship` (IfcExternalReferenceRelationship, classification of a document,
  e.g. the ISO 19650 information type; a resource, `to_id` -> `classification_references`, D-104)
- **Physically binary `from->to` + our meta columns, NOT objectified N-ary IFC entities**
  (we take the identity and granularity of IFC, not its serialization structure; an index over IFC
  semantics, not STEP in Postgres, D-046/D-048)
- Required columns: `id`, `valid_from`, `valid_until`, `source`
- Direction: `from_id` -> `to_id` (subject -> object); the convention stays uniform; which end
  is the IFC `Relating` one is in the mapping in SCHEMA.md §5
- **Namespace (D-048):** an edge **without a prefix = IFC-canonical** (serialized as `IfcRel*`);
  an edge for which IFC **has no concept** gets the prefix **`aim_`** (`aim_rel_*`, snake_case).
  The prefix also encodes the export: `rel_*` -> `IfcRel`, `aim_*` -> ICDD linkset/IFCX. Reserved for a
  real absence of an IFC concept (NOT a concept realized differently; that is why `rel_member_of`
  stays `rel_`). Today no `aim_*` edge exists; it is a forward convention.
- Exception: `rel_associates_classification.to_id` -> `classification_references`
- Spatial: `rel_aggregates` = decomposition of the structure (Site->Building->Floor->Space);
  `rel_contained_in_spatial_structure` = a physical element (asset) in a space or floor
- The full list of edges, columns and the IFC `Relating`/`Related` mapping -> `SCHEMA.md §2.5` and `§5`

### Type-occurrence (D-021)
- Type = `object_type='asset_type'`, NEVER in the spatial structure
  (`rel_aggregates` / `rel_contained_in_spatial_structure`)
- Link `rel_defines_by_type` (occurrence -> type), 1:N
- Inheritance with override: the type is shared, the occurrence overrides; effective values from `v_asset_effective`

### Actors (D-020, D-024), level B
- `person` (extension table `persons`) and `organization` (an objects row), link `rel_member_of`
- `rel_assigns_to_actor` goes from a person and from an organization
- Two roles: `rel_assigns_to_actor.role` (acting in a responsibility) vs `rel_member_of.role` (role in the company)
- C (organization hierarchy, structured addresses, intrinsic roles) = a planned additive extension

### Object identity (three layers, D-010)
- **Master UUID** (`objects.id`) = the primary identity, never changes
- **object_ref** = a human-readable stable tag (QR), unique; it is NOT a classification code
- **IFC GUID** = only an attribute; history in `ifc_guid_history`

### Classification (D-011, D-019, D-023)
- Never hardcode a specific classification system
- Two levels, reference data: `classification_systems` + `classification_references`
- Link `rel_associates_classification`, allowed on the type and the occurrence
- The effective classification of an occurrence = the **union** of its own and those inherited from the type (not an override)

## What not to do
- Never delete migrations; always add new ones
- Never fix a classification system in the schema
- Never use the IFC GUID as the primary key
- Do not create a separate table for each node type; use `objects` + an extension table
- Do not store type property sets on the occurrence; they belong to the type (inherited through a view)
- Do not put IFC attributes into psets; without a column they belong in `properties._attributes` (D-195)
- Do not throw away addresses or organization links from the source; store them in `_contact`/`_org` in `properties` (until C)
- Do not build features without a matching record in DECISIONS.md
- Do not introduce a new attribute, edge or enum without checking the IFC4.3 equivalent. If one exists,
  take the IFC name and values literally; if not, record it as a declared extension
  in SCHEMA.md §5 (IFC-first naming, D-046)
- **IFC 4.3 schema in the repo (D-195):** before every new attribute, entity, enum or relationship, look it
  up in `vendor/ifc4.3/docs/schemas` (entities `<layer>/<package>/Entities/<IfcClass>.md`, psets also
  `vendor/ifc4.3/reference_schemas/psd`). Fetch it once per session: `bash scripts/ifc-schema/fetch.sh`
  (pinned submodule, sparse, about 21 MB). Never modify these files (CC BY-ND 4.0, `vendor/IFC4.3-NOTICE.md`).
- Never store geometry or meshes in the DB; 3D rendering is an ephemeral client-side layer (IFClite, D-044)

## Spatial hierarchy
```
Site -> Building -> Floor -> Space -> Asset
```
Every level is a row in `objects` (it differs by `object_type`). Spatial links are IFC-canonical
(D-048): `rel_aggregates` between structures (Site->Building->Floor->Space),
`rel_contained_in_spatial_structure` for a physical element (asset) in a space or floor.

## Data access (D-026)
- Reads **exclusively server-side** through Supabase `service_role` (Server Components /
  route handlers). The DB stays unexposed. **RLS is enabled on all tables in `public` without policies** as defence in depth
  (2 Nov, migration `20261102180000`; the server goes through `service_role` with BYPASSRLS). A new table in a migration also gets
  `alter table ... enable row level security`.
- The anon key may go to the browser **only** for the Realtime live channel (D-079) and **only** while
  the roles `anon`/`authenticated` hold no privileges in `public` (migration `20261016120000`);
  a new table or RPC gives them no privileges. Data are never read through the anon key.
- ISR cache (`unstable_cache`, tag `aim`, revalidate 60 s, D-030); after an ETL load
  `revalidateTag("aim")`.
- **Project (D-189):** every query of a project-bound table or view names `project_id` (guard test
  `lib/project/project-scope.test.ts`); the request project comes from `lib/project/` (`currentProjectId()`),
  cached reads take it as an argument (`cachedProjectRead`), writes clear it with `revalidateProject`. No code
  assumes a model code (ASR, VZT) exists.

## RDF / ICDD
RDF is not an internal database, only an export format. The ICDD container (ISO 21597) is assembled by the browser from the host's plan
(`GET /api/icdd`, `lib/icdd/`, page `/icdd`); payload = revision containers with sha256, linkset = only the AIM layer with provenance and the IFC relationship; links from the IFC file
stay in it (D-181). Import back writes only element -> document links (preview, write behind `ICDD_IMPORT_ENABLED`); the other layers are export only. After an export, audit with `python -m etl.icdd_audit <container>.icdd` (exit != 0 on error).

## 3D Viewer, IFClite (D-044)
Geometry = **ephemeral in the browser** (IFClite WASM, client-side, the IFC file does not leave the tab).
**Postgres never touches geometry.** The link between the 3D scene and the data = **IFC GUID**
(`ifc_guid_history`, D-010). Federation of discipline models (ARCH + VZT) into one scene:
identity across models is held by the IFC GUID (expressId overlaps between files), the floor is
normalized to a common label (`1NP_VZT` -> `1NP`, D-049).

**Model egress (D-135):** the viewer and the IFC engine read the immutable revision archive (`ifc/archive/<MODEL>/vNNN.ifc.gz`),
not `ifc/<MODEL>.ifc`. Sessions and tests do not download production IFC: live verification on a small test model
(`AC20-FZK-Haus.ifc` from the fork's fixtures, locally), headers from the bucket only with `curl -I` or `-r 0-0`; a session does not open
`/ifc` of production or of a preview (the "How to try" link is for Samuel) and does not call the connector's `ifc_*` tools just to verify.

**Where an AIM function lives (D-091):** by default in AIMviewer; into the fork only display that must
be inside the viewer's panels (a badge, a record, a local toggle). Actions that change data are done by the host;
a button in the fork only opens them.

**Documents (D-104):** one set from IFC; an object's documents are found through relationships (type, group, zone,
spatial zone), not only directly, in the UI and in the tools; PDF browsing is developed in the viewer, not on `/drawing`.

**A new viewer function (D-087):** first a tool from `@ifc-lite/mcp` 1:1, the view only as an adapter in
`apps/viewer/src/aim/` of the fork, own code only where the original has nothing. Make fork PRs by the skill
`.claude/skills/aim-feature/SKILL.md` in the fork (local checks, bundle measurement, mutation
evidence and the label in the first push), so that CI passes the first time. Raising the bundle limit by up to 2 kB
of entry is pre-approved (`docs/FORK_MAINTENANCE.md` in the fork). Merge order: the fork, then AIMviewer.

**First what already exists (D-098):** before designing anything, search the fork's store
(`CameraCallbacks`, slices), the SDK, `@ifc-lite/mcp`, the embed protocol and the UI actions of the original. The fork only
thinly exposes an existing function through the bridge; AIMviewer does the computing. Do not invent new functions.
A fork PR only in `apps/viewer/src/aim/` (+ AIM evidence, skill) goes through the fast CI `aim-fast.yml` (about 10 min);
an upstream file in the same PR brings back the full CI, so keep AIM changes separate.

## ETL, running
Python 3.9+ (`py -3.9`), `PYTHONUTF8=1` on Windows (cp1250 console). Always from the repo root:
`python -m etl.main --file <ifc> [--dry-run|--reset|--federate] [--model ASR|VZT]`. Details in `etl/README.md`.
IFC models of the federation are published **only through `python -m etl.model_publish`** (revision + archive,
D-086), never by a direct upload to the bucket; re-ETL of a revision always with `--model`, never `--reset`.

## LLM interface, eval cadence (D-057)
A change of the LLM layer (tools, system prompt, model or provider) => before the commit run the evals
(`npm run eval` against a running dev server) and compare with the baseline; the result goes into the
ROADMAP changelog. Detail -> `DECISIONS.md` D-057.

A new RPC for the LLM = always read-only `stable` + `set search_path` + internal whitelists
(relation, op, columns), identifiers `format('%I')`, literals `format('%L')`; the pattern is
`search_everything`/`aggregate_objects` (D-059/D-060).

A missing tool or feedback from the connector = a GitHub issue (`feedback` with action request_tool / report, D-090);
the session that handles it follows the skill `.claude/skills/mcp-poziadavka/SKILL.md`.
Difficulty of a request (STANDARD Sonnet / HARD Opus routine, D-134) and escalation: `docs/orchestration.md`.

**Fit first, a new tool only after that (D-114).** Every extra tool makes the connector load longer
and makes the agent's choice harder. Before a new capability in the connector (also outside an issue from the connector):
1. search `MCP-TOOLS.md` (the inventory generated from the definitions) and list the 2-3 closest tools;
2. try in this order: a better description or instruction (the capability already exists), a new parameter or
   enum value (`action`, `mode`, `include`...), a field in the result of an existing tool;
3. a new tool only when none of these works. The D-0xx record has a section "Rejected extension: `<tool>` -
   why not", and a new line in `lib/mcp/tool-registry.json` (name -> decision) is approved by Samuel.
   The registry test lets through only the tools that are in it; there is no fixed cap on the count.
A change of a tool's description or parameters = refresh the inventory (`npx vitest run lib/mcp/tool-registry.test.ts -u`).
An error in the IFC model = a BCF topic in `model_tasks` (`bcf_topic`, `bcf_topic_list`, BCF API `/api/bcf`, D-099), not an issue;
a topic for Claude is handled in the OCB repo (skill `bcf-tema`, workflow `uloha`).
