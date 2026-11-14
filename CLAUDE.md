# AIM Platform - Claude Code

> **The project's conventions and instructions live in [`AGENTS.md`](AGENTS.md)**, the single source
> of truth shared by all tools. **Read `AGENTS.md` before work** and make every change of conventions
> there, not here.

This file is deliberately a thin pointer, so that the instructions of the tools do not drift apart.
Claude-specific notes (if there are any) belong here; project conventions go into `AGENTS.md`.

Key documents: [`AGENTS.md`](AGENTS.md) (conventions) · [`DECISIONS.md`](DECISIONS.md)
(decisions D-0xx) · [`SCHEMA.md`](SCHEMA.md) (schema) · [`ROADMAP.md`](ROADMAP.md) (plan) ·
[`docs/glossary.md`](docs/glossary.md) (domain terms).

## Standing permissions (auto-loaded, so every new session sees them at start)

- **Attaching repositories (Samuel, 11, 12 and 14 Nov, standing):** every orchestrator session, including each new
  one started at rotation by another session or from the Claude app, may always attach `Menezeris/AIMforked` and
  `Menezeris/AIMviewer` with push access via `add_repo`, as its first step, without asking again. Samuel's words
  (12 Nov): "Yes attach it and write somewhere permission that everytime nime orchestrator is created it can add this
  repo". Repeated on 14 Nov after a new orchestrator was blocked: "it should be already done that you can add repo
  yourself everytime in the new sessions ... make sure this situation doesnt happen again". This covers only attaching
  those two repos (no production writes, no secrets). Details and the rest of the rules: `AGENTS.md`, issue #60.
- **Working without Samuel (Samuel, 14 Nov, standing):** "Continue without me everytime when there nothing on and
  something could be that doesnt need my approval - and many approvals you can do yourself and decide for me, only the
  critical ones are for me". So the orchestrator never sits idle while non-critical work exists: it starts the next
  plan item itself and decides routine questions for him (PRs, reviews, merges that pass all gates in `AGENTS.md`,
  docs, tests, backups, restore tests and rehearsals by the step session, next-step plans). **Critical, always
  Samuel's yes typed in the orchestrator chat:** every production write (after backup, restore test, rehearsal and
  review), secrets, budget or plan changes, --reset or data loads, pg_cron, ARCHIVES_GRAPH_WRITES, deleting data or
  repositories. The orchestrator prepares those up to the last step and posts the exact sentence for him to send.
