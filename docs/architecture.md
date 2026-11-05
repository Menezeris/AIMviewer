# Project overview and architecture notes

> Moved out of `AGENTS.md` verbatim (D-197, lean docs). Normative summary; exact DDL is in `SCHEMA.md`.

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
