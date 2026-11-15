#!/usr/bin/env python3
"""Context guard (D-197 rotation rule, orchestration.md sections 8 and 10).

Runs as a Claude Code hook (PostToolUse and UserPromptSubmit). It reads the
session's own transcript, takes the context size of the last main-thread model
call (input + cache read + cache write tokens) and, above the limits below,
injects a reminder into the model's context and shows it to the user.

Why a hook: on 15 Nov the orchestrator rotated at ~409k instead of ~300k
because the rule "check get_session after each PR" depends on the model
remembering it; long stretches without a PR (incident work, subagent reports)
never triggered the check. A hook fires on every tool call, so it cannot be
forgotten.

Never blocks anything and never fails the tool call: every error exits 0.
"""
import json
import os
import sys
import tempfile

WARN = int(os.environ.get("AIM_CONTEXT_WARN", "250000"))
ROTATE = int(os.environ.get("AIM_CONTEXT_ROTATE", "300000"))
REPEAT_STEP = 20000  # repeat the reminder after this much further growth
TAIL_BYTES = 4 * 1024 * 1024


def last_context_tokens(path):
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        f.seek(max(0, size - TAIL_BYTES))
        lines = f.read().splitlines()
    for raw in reversed(lines):
        if b'"assistant"' not in raw or b'"usage"' not in raw:
            continue
        try:
            d = json.loads(raw)
        except ValueError:
            continue
        if d.get("type") != "assistant" or d.get("isSidechain"):
            continue
        u = (d.get("message") or {}).get("usage") or {}
        total = (u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0) + (
            u.get("cache_creation_input_tokens") or 0
        )
        if total:
            return total
    return None


def main():
    data = json.load(sys.stdin)
    if data.get("agent_id"):  # subagent tool calls: their context is not ours
        return
    event = data.get("hook_event_name", "PostToolUse")
    path = data.get("transcript_path")
    if not path or not os.path.exists(path):
        return
    tokens = last_context_tokens(path)
    if not tokens or tokens < WARN:
        return

    level = "rotate" if tokens >= ROTATE else "warn"
    state_file = os.path.join(
        tempfile.gettempdir(), "aim-context-guard-%s.json" % data.get("session_id", "x")
    )
    try:
        with open(state_file) as f:
            state = json.load(f)
    except (OSError, ValueError):
        state = {}
    last_level, last_tokens = state.get("level"), state.get("tokens", 0)
    if last_level == level and tokens - last_tokens < REPEAT_STEP and event != "UserPromptSubmit":
        return
    with open(state_file, "w") as f:
        json.dump({"level": level, "tokens": tokens}, f)

    k = tokens // 1000
    if level == "rotate":
        text = (
            "CONTEXT GUARD: this session's context is about %dk tokens, over the %dk rotation limit "
            "(D-197, AIMforked docs/platform/orchestration.md sections 8 and 10). Rotate now: start no "
            "new work, finish or park only the step in hand, then write the handoff (orchestrator: "
            "handoff comment on AIMviewer #60 and start the successor; step session: handoff to the "
            "orchestrator). Waiting for subagents, CI or a merge bundle is not a reason to postpone: "
            "the successor can receive forwarded reports. Production writes stay with the gates."
            % (k, ROTATE // 1000)
        )
    else:
        text = (
            "CONTEXT GUARD: context is about %dk tokens; rotation is due at %dk (D-197). Do not start "
            "large new work in this session; draft the handoff now so rotation is quick."
            % (k, ROTATE // 1000)
        )
    print(
        json.dumps(
            {
                "systemMessage": text,
                "hookSpecificOutput": {"hookEventName": event, "additionalContext": text},
            }
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:  # never break the session
        pass
    sys.exit(0)
