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

## Core rules (details in the linked docs)

- **One fact, one place.** Rules: this file. Why: `DECISIONS.md` (`D-0xx`). DDL: `SCHEMA.md`. State and next steps:
  `ROADMAP.md` (only there). Run and deploy: `README.md`. ETL: `etl/README.md`. Map and writing rules:
  [`docs/agent-process.md`](docs/agent-process.md).
- **New feature = a `D-0xx` record first, then code.** DB change = a new migration + an update of `SCHEMA.md`.
  Do not create a new .md file unless its role and cadence differ from the existing ones.
- **Tool files** (`CLAUDE.md`, `.github/copilot-instructions.md`, `.cursor/rules/*.mdc`, `GEMINI.md`) are thin
  pointers here, with no copied content.
- **Concurrent sessions (D-090):** before planning look at open PRs and `claude/*` branches; reserve a `D-0xx`
  number in issue #60; never merge a PR (the orchestrator merges on Samuel's word); never use the live viewer
  UI tools to verify. Platform work follows `AIMforked/docs/platform/orchestration.md` (D-191).
  Details: [`docs/agent-process.md`](docs/agent-process.md).
- **PRs (D-187):** merge `origin/main` into the branch first; push only after `npx tsc --noEmit`,
  `npx vitest run`, `node scripts/ci/lint-changed.mjs origin/main`; the gate is green GitHub Actions CI.
- **Database:** nodes in `objects`, edges in `relationships`, IFC-first naming. Conventions:
  [`docs/conventions-db.md`](docs/conventions-db.md). Spatial hierarchy: Site -> Building -> Floor -> Space -> Asset.
- **Every writer names itself (D-196):** writes to the graph are logged in `audit.log` with the person and the source.
  App code writes through `getSupabaseAdmin()` (headers from `lib/audit/context.ts`, `withAuditContext` per route),
  ETL through `etl/audit.py` (`PGAPPNAME`, `set_session`, one `write_run` per load), the fork through the AIM API.
  Never write the graph around them (no other DB client, no disabled triggers). Details: `SCHEMA.md` §2.25.
- **Stack, data access, viewer, ETL, LLM and eval cadence:** [`docs/architecture.md`](docs/architecture.md).
- **Licences:** only MIT, Apache-2.0, BSD, ISC, MPL-2.0, LGPL (dynamic); no AGPL or GPL (D-186).

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

