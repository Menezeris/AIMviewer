# Orchestration of sessions from the connector (D-134)

A request from the connector (`feedback`, D-090) starts a cloud session through one of two routines. The model is
a property of the routine, hence two.

| Difficulty | Routine | Model | ID | Env on Vercel |
|---|---|---|---|---|
| HARD | AIM: Hard Issues | Opus | `trig_01HfMX6dt9uNSkd2zZ8HHPST` | `CLAUDE_ROUTINE_FIRE_URL`, `CLAUDE_ROUTINE_TOKEN` |
| STANDARD | AIM: Standard Issues | Sonnet | `trig_01PS9ewHPFXUPmz1btypLF1h` | `CLAUDE_ROUTINE_STANDARD_FIRE_URL`, `CLAUDE_ROUTINE_STANDARD_TOKEN` |

## Triage
Claude in the connector decides (`narocnost` + `narocnost_dovod` in `feedback`, also with `start_session`).
- **STANDARD:** clear and local - a reproducible bug, a small change, a test, a tool description.
- **HARD:** unclear task, architecture, cross-module, DB schema or migration, fork (ifc-lite), a new tool.
- When in doubt: unclear task -> HARD, otherwise STANDARD.
- Without the parameter or without a configured STANDARD routine everything goes to HARD (as before D-134).

## Escalation
A STANDARD session that finds the task is hard writes an issue comment "Escalation to HARD: <reason>"
and ends. The orchestrator starts HARD after an escalation or after 2 failures of STANDARD.

## Measurement
The comment with the session link carries a line `triedenie: STANDARD - <reason>` (hidden marker
`aim-mcp-triage`; `level` = the routine used, `requested` = Claude's proposal). The counts of STANDARD / HARD and
escalations are computed from the comments of issues labeled `mcp`. The queue comment ("Fronta: triedenie...")
is not counted.
