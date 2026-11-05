"""Registry of derivation rules (D-089): which rules run, between what and when.

The rules are data in `derivation_rules` (enabled, auto/manual mode, classes, roles, edge source).
`run` runs the selected rules over the federation models, closes the edges of the disabled ones and writes every run
to `derivation_runs`. Geometric rules share one computation (one BVH tree) and the edges are
split by target class, so each rule writes under its own source.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Optional, Sequence

from ..project import OCB_ID
from . import DerivedEdge


@dataclass
class Rule:
    id: str
    name: str
    kind: str                       # 'geometry' | 'via_space'
    rel_type: Optional[str]
    source: Optional[str]
    source_classes: list[str]
    target_classes: list[str]
    roles: list[str]
    enabled: bool
    mode: str                       # 'auto' | 'manual'


@dataclass
class RuleResult:
    rule_id: str
    status: str                     # 'ok' | 'dry_run' | 'disabled'
    written: int = 0
    closed: int = 0
    unresolved: int = 0
    details: dict[str, Any] = field(default_factory=dict)


_RULE_COLUMNS = ("id, name, kind, rel_type, source, source_classes, target_classes, roles, "
                 "enabled, mode")


def load_rules(cur) -> list[Rule]:
    rows = cur.execute(f"select {_RULE_COLUMNS} from derivation_rules order by id").fetchall()
    return [Rule(*r) for r in rows]


def select_rules(rules: Sequence[Rule], rule_ids: Optional[Sequence[str]], trigger: str
                 ) -> tuple[list[Rule], list[Rule]]:
    """(to compute, to close). Without `rule_ids`: those enabled in auto mode (with `trigger=auto`) or
    all enabled (`manual`); disabled rules are always cleaned up (their edges are closed)."""
    if rule_ids:
        unknown = set(rule_ids) - {r.id for r in rules}
        if unknown:
            raise SystemExit(f"Neznáme pravidlo: {', '.join(sorted(unknown))}")
        chosen = [r for r in rules if r.id in rule_ids]
    else:
        chosen = list(rules)
    to_run = [r for r in chosen if r.enabled and (rule_ids or trigger == "manual" or r.mode == "auto")]
    to_close = [r for r in chosen if not r.enabled and r.source]
    return to_run, to_close


def partition_edges(edges: Sequence[DerivedEdge], rules: Sequence[Rule],
                    classes: dict[str, Any]) -> dict[str, list[DerivedEdge]]:
    """Splits the edges of the shared geometric computation by rule.

    `classes` = GUID -> IFC entity (`is_a(cls)` is enough); an edge belongs to a rule when its element is
    one of the source classes, its target one of the target classes and the role is among the rule's roles."""
    out: dict[str, list[DerivedEdge]] = {r.id: [] for r in rules}
    for e in edges:
        src, dst = classes.get(e.from_guid), classes.get(e.to_guid)
        if src is None or dst is None:
            continue
        for r in rules:
            if (e.role in r.roles
                    and any(dst.is_a(c) for c in r.target_classes)
                    and any(src.is_a(c) for c in r.source_classes)):
                out[r.id].append(e)
    return out


def current_revisions(cur, project_id: str = OCB_ID) -> dict[str, int]:
    """Current revisions of the project's models (D-086, D-189) for the run record; empty without the table."""
    exists = cur.execute("select to_regclass('model_revisions') is not null").fetchone()[0]
    if not exists:
        return {}
    rows = cur.execute("select model, revision from model_revisions where is_current and project_id = %s",
                       (project_id,)).fetchall()
    return {m: r for m, r in rows}


def close_rule_edges(cur, rule: Rule, project_id: str = OCB_ID) -> int:
    if not rule.source:
        return 0
    return len(cur.execute(
        "update relationships set valid_until = now() "
        "where source = %s and project_id = %s and valid_until is null returning id",
        (rule.source, project_id),
    ).fetchall())


def record_run(cur, res: RuleResult, trigger: str, models: dict[str, int], project_id: str = OCB_ID) -> None:
    cur.execute(
        "insert into derivation_runs (rule_id, status, trigger, models, written, closed, "
        "unresolved, details, finished_at, project_id) values (%s, %s, %s, %s, %s, %s, %s, %s, now(), %s)",
        (res.rule_id, res.status, trigger, json.dumps(models), res.written, res.closed,
         res.unresolved, json.dumps(res.details, ensure_ascii=False), project_id),
    )


def set_enabled(cur, rule_id: str, enabled: bool, mode: Optional[str] = None) -> Rule:
    row = cur.execute(
        f"update derivation_rules set enabled = %s, mode = coalesce(%s, mode), updated_at = now() "
        f"where id = %s returning {_RULE_COLUMNS}",
        (enabled, mode, rule_id),
    ).fetchone()
    if row is None:
        raise SystemExit(f"Neznáme pravidlo: {rule_id}")
    return Rule(*row)


def last_runs(cur) -> dict[str, tuple]:
    rows = cur.execute(
        "select distinct on (rule_id) rule_id, status, trigger, finished_at, written, closed, models "
        "from derivation_runs order by rule_id, started_at desc"
    ).fetchall()
    return {r[0]: r[1:] for r in rows}
