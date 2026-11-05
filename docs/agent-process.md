# Working rules: documents, sessions, PRs

> Moved out of `AGENTS.md` verbatim (D-197, lean docs). `AGENTS.md` keeps only the core rules and links here.

## Documentation map (D-017)

**Golden rule:** every fact lives in **one** place, the others link to it. When you write,
first find out which document it belongs to:

| Document | Answers | What you write there |
|---|---|---|
| **AGENTS.md** (this one) | "What are the rules, how do I work here?" | Normative summary (must/never). DDL detail -> link to SCHEMA. |
| **decisions/** | "Why is it like this?" | One file `D-nnn.md` per record (rationale) and one index row in `decisions/README.md`; `DECISIONS.md` is only a pointer. Every feature = a record. |
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
2. **New feature => first a `D-0xx` record in `decisions/`** (rationale; new record = `decisions/D-nnn.md` + one index row in `decisions/README.md`, never append to `DECISIONS.md`), only then code.
   Without a decision the feature is not built.
3. **DB change => a new migration + an update of `SCHEMA.md`** (old migrations are not deleted).
4. **Change of state or priority => only `ROADMAP.md`** (section "State"); the state is not duplicated anywhere else.
5. **Do not create a new .md file** until it has **a different role and a different cadence** than the existing ones.
   Prefer extending an existing document.
6. **New tool (Cline, Aider, Windsurf, Zed...) => create only a thin pointer** to `AGENTS.md`
   at the path the tool reads (e.g. `.clinerules`, `GEMINI.md`, `.aider.conf`);
   **no duplicated content**. Existing pointers: `CLAUDE.md`,
   `.github/copilot-instructions.md`, `.cursor/rules/aim-platform.mdc`. Codex and Gemini read
   `AGENTS.md` natively.
7. **Conventions change only here in `AGENTS.md`**, not in the pointers.
8. **Re-check before a sprint:** before planning or implementing each sprint, check the
   current state (ROADMAP "State", git, DB) and what has changed; reconsider the order and
   scope of sprints and steps accordingly, and only then write the `D-0xx` detail and code.
9. **Align the documents after a sprint or commit (multi-tool):** after finishing a sprint and after
   a commit, always align the supporting documents: `ROADMAP.md` ("State" and changelog), `decisions/`
   (`D-nnn.md`), `SCHEMA.md` (if the DB was touched) and the **thin tool pointers** (`CLAUDE.md`,
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

