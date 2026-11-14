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
