"""Read-only comparison of a staged model with the database (`etl.main --dry-run --check-db`, D-189).

Answers "what would this load change?" without writing: the same source rewrites as the load (`scope_sources`,
`documents.mark_model`, `documents.resolve_locations`), then row by row against `objects` (with project_id),
`floors`, `spaces`, `documents`, `relationships`, `ifc_guid_history` and `ifc_guid_aliases`, plus the rows the
load would close (`close_stale`). The connection is read only (`default_transaction_read_only`).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Optional

import psycopg

from . import documents, ids
from . import project as project_mod
from .db import (
    COPY_REL_TYPES, EDGE_TYPE_TO_REL_TYPE, HOST_PROPERTY_KEYS, edge_source, emitted_ids, existing_alias,
    guid_source, scope_sources, writes_edge,
)
from .model import StagedModel

_OBJECT_COLUMNS = ("object_type", "name", "ifc_guid", "ifc_type", "predefined_type", "user_defined_type")


@dataclass
class Diff:
    project_id: Optional[str] = None
    added: dict[str, list[str]] = field(default_factory=dict)
    changed: dict[str, list[str]] = field(default_factory=dict)
    closed: dict[str, list[str]] = field(default_factory=dict)

    def add(self, kind: str, table: str, what: str) -> None:
        getattr(self, kind).setdefault(table, []).append(what)

    @property
    def total(self) -> int:
        return sum(len(v) for d in (self.added, self.changed, self.closed) for v in d.values())

    def report(self, sample: int = 10) -> str:
        lines = [f"check-db: project {self.project_id or '(new)'}, differences {self.total}"]
        for kind in ("added", "changed", "closed"):
            for table, items in sorted(getattr(self, kind).items()):
                lines.append(f"  {kind:7} {table:18} {len(items):6}  " + "; ".join(items[:sample]))
        return "\n".join(lines)


def _norm(value: Any) -> Any:
    """JSON-normalized value (tuples, floats and nested dicts compare like the stored jsonb)."""
    return json.loads(json.dumps(value, sort_keys=True, default=str)) if value is not None else None


def _str(v: Any) -> Optional[str]:
    return None if v is None else str(v)


def compare(cur, model: StagedModel, code: str, scope: Optional[str] = None,
            storage_base: Optional[str] = None) -> Diff:
    """Differences between the database and what `load_model(..., scope, project_code=code)` would write."""
    diff = Diff()
    if scope:
        scope_sources(model, scope)
        documents.mark_model(model, scope)
    documents.resolve_locations(model, documents.bucket_names(cur), storage_base)
    project_id = project_mod.resolve(cur, code)
    diff.project_id = project_id   # None = the load creates the project node (listed with the objects)

    refs = [o.object_ref for o in model.objects]
    rows = cur.execute(
        "select object_ref, id, project_id, valid_until, properties, " + ", ".join(_OBJECT_COLUMNS)
        + " from objects where object_ref = any(%s)", (refs,),
    ).fetchall()
    db_objects = {r[0]: r for r in rows}
    obj_ids: dict[str, str] = {r[0]: str(r[1]) for r in rows}
    for o in model.objects:
        r = db_objects.get(o.object_ref)
        if r is None:
            diff.add("added", "objects", o.object_ref)
            continue
        _, oid, pid, valid_until, props = r[:5]
        expected_pid = None if o.object_type in project_mod.GLOBAL_OBJECT_TYPES else (
            str(oid) if o.object_type == "project" else project_id)
        bad = [c for c, v in zip(_OBJECT_COLUMNS, r[5:]) if v != getattr(o, c)]
        if _str(pid) != expected_pid:
            bad.append("project_id")
        if valid_until is not None:
            bad.append("valid_until")
        kept = {k: v for k, v in (props or {}).items() if k not in HOST_PROPERTY_KEYS}
        have, want = _norm(kept), _norm(o.properties or {})
        if have != want:
            keys = sorted(k for k in set(have) | set(want) if have.get(k) != want.get(k))
            bad.append("properties " + ",".join(f"{k}: {have.get(k)!r}->{want.get(k)!r}" if k.startswith("_")
                                                 else k for k in keys))
        if bad:
            diff.add("changed", "objects", f"{o.object_ref} ({', '.join(bad)})")

    _compare_appendices(cur, model, obj_ids, diff)
    _compare_edges(cur, model, obj_ids, project_id, diff)
    alias_ids = _compare_guids(cur, model, obj_ids, project_id, diff)
    if scope and project_id:
        _compare_stale(cur, model, scope, project_id, diff, alias_ids)
    return diff


def _compare_appendices(cur, model: StagedModel, obj_ids: dict[str, str], diff: Diff) -> None:
    ids_ = list(obj_ids.values())
    floors = dict(cur.execute("select id::text, elevation from floors where id::text = any(%s)", (ids_,)).fetchall())
    spaces = dict(cur.execute("select id::text, long_name from spaces where id::text = any(%s)", (ids_,)).fetchall())
    doc_cols = ("identification", "description", "location", "purpose", "revision", "document_owner", "status",
                "storage_type", "electronic_format")
    docs = {r[0]: r[1:] for r in cur.execute(
        "select id::text, " + ", ".join(doc_cols) + ", referenced_document_id::text from documents "
        "where id::text = any(%s)", (ids_,)).fetchall()}
    for o in model.objects:
        oid = obj_ids.get(o.object_ref)
        if oid is None:
            continue
        if o.elevation is not None and (oid not in floors or floors[oid] is None
                                        or abs(float(floors[oid]) - float(o.elevation)) > 1e-9):
            diff.add("changed" if oid in floors else "added", "floors", o.object_ref)
        if o.long_name is not None and spaces.get(oid, object()) != o.long_name:
            diff.add("changed" if oid in spaces else "added", "spaces", o.object_ref)
        if o.document is not None:
            d = o.document
            want = tuple(getattr(d, c) for c in doc_cols) + (
                obj_ids.get(d.referenced_document_ref) if d.referenced_document_ref else None,)
            have = docs.get(oid)
            if have is None:
                diff.add("added", "documents", o.object_ref)
            elif tuple(have) != want:
                cols = [c for c, a, b in zip(doc_cols + ("referenced_document_id",), have, want) if a != b]
                diff.add("changed", "documents", f"{o.object_ref} ({', '.join(cols)})")


def _compare_edges(cur, model: StagedModel, obj_ids: dict[str, str], project_id: Optional[str],
                   diff: Diff) -> None:
    missing = {ref for e in model.edges if writes_edge(e.edge_type, e.source)
               for ref in (e.from_ref, e.to_ref) if ref not in obj_ids}
    if missing:
        for ref, oid in cur.execute(
                "select object_ref, id::text from objects where object_ref = any(%s) "
                "and (project_id = %s or project_id is null)", (list(missing), project_id)).fetchall():
            obj_ids[ref] = oid
    wanted: dict[str, tuple] = {}
    for e in model.edges:
        if writes_edge(e.edge_type, e.source):
            wanted[ids.edge_id(e.from_ref, e.to_ref, e.edge_type)] = (
                EDGE_TYPE_TO_REL_TYPE[e.edge_type], obj_ids.get(e.from_ref), obj_ids.get(e.to_ref), e.role,
                e.valid_until, e.source, f"{e.edge_type} {e.from_ref}->{e.to_ref}")
    have = {r[0]: r[1:] for r in cur.execute(
        "select id::text, rel_type, from_id::text, to_id::text, role, valid_until, source, project_id::text "
        "from relationships where id::text = any(%s)", (list(wanted),)).fetchall()}
    for eid, (rel_type, f, t, role, vu, source, label) in wanted.items():
        h = have.get(eid)
        if h is None:
            diff.add("added", "relationships", label)
            continue
        bad = [n for n, a, b in (("rel_type", h[0], rel_type), ("from_id", h[1], f), ("to_id", h[2], t),
                                 ("role", h[3], role), ("source", h[5], source)) if a != b]
        if (h[4] is None) != (vu is None):
            bad.append("valid_until")
        if project_id and h[6] not in (project_id, None):
            bad.append("project_id")
        if bad:
            diff.add("changed", "relationships", f"{label} ({', '.join(bad)})")


def _compare_guids(cur, model: StagedModel, obj_ids: dict[str, str], project_id: Optional[str],
                   diff: Diff) -> list[str]:
    want = {ids.guid_history_id(g.object_ref, g.ifc_guid): g for g in model.guid_history}
    have = {r[0]: r[1:] for r in cur.execute(
        "select id::text, object_id::text, ifc_guid, valid_until, source from ifc_guid_history "
        "where id::text = any(%s)", (list(want),)).fetchall()}
    for hid, g in want.items():
        h = have.get(hid)
        if h is None:
            diff.add("added", "ifc_guid_history", f"{g.object_ref} {g.ifc_guid}")
        elif (h[2] is None) != (g.valid_until is None) or h[3] != g.source or h[0] != obj_ids.get(g.object_ref):
            diff.add("changed", "ifc_guid_history", f"{g.object_ref} {g.ifc_guid}")
    active: list[str] = []
    for a in model.guid_aliases:
        object_id = obj_ids.get(a.object_ref) or (project_id if a.object_ref == model.project_code else None)
        kept = existing_alias(cur, project_id, a.ifc_guid, object_id, a.reason) if object_id and project_id else None
        if kept is not None:
            active.append(kept)
            continue
        active.append(ids.guid_alias_id(a.object_ref, a.ifc_guid))
        h = cur.execute("select object_id::text, reason, valid_until, source, project_id::text "
                        "from ifc_guid_aliases where id::text = %s",
                        (ids.guid_alias_id(a.object_ref, a.ifc_guid),)).fetchone()
        if h is None:
            diff.add("added", "ifc_guid_aliases", f"{a.object_ref} {a.ifc_guid}")
        elif (h[0], h[1], h[2], h[3], h[4]) != (object_id, a.reason, None, a.source, project_id):
            diff.add("changed", "ifc_guid_aliases", f"{a.object_ref} {a.ifc_guid}")
    return active


def _compare_stale(cur, model: StagedModel, scope: str, project_id: str, diff: Diff,
                   alias_ids: list[str]) -> None:
    """Rows `close_stale` would close: the same predicates, as selects."""
    edges, guids = emitted_ids(model)
    for (eid,) in cur.execute(
            "select id::text from relationships where source = %s and project_id = %s and valid_until is null "
            "and not (rel_type = any(%s)) and not (id = any(%s::uuid[]))",
            (edge_source(scope), project_id, COPY_REL_TYPES, edges)).fetchall():
        diff.add("closed", "relationships", eid)
    for (hid,) in cur.execute(
            "select h.id::text from ifc_guid_history h where h.source = %s and h.valid_until is null "
            "and not (h.id = any(%s::uuid[])) and exists (select 1 from objects o where o.id = h.object_id "
            "and o.project_id = %s)", (guid_source(scope), guids, project_id)).fetchall():
        diff.add("closed", "ifc_guid_history", hid)
    aliases = alias_ids
    for (aid,) in cur.execute(
            "select id::text from ifc_guid_aliases where source = %s and project_id = %s and valid_until is null "
            "and not (id = any(%s::uuid[]))", (guid_source(scope), project_id, aliases)).fetchall():
        diff.add("closed", "ifc_guid_aliases", aid)
    docs = [o.object_ref for o in model.objects if o.object_type in documents.DOCUMENT_TYPES]
    for (ref,) in cur.execute(
            "select object_ref from objects where valid_until is null and object_type = any(%s) "
            "and properties->>'_model' = %s and project_id = %s and not (object_ref = any(%s))",
            (list(documents.DOCUMENT_TYPES), scope, project_id, docs)).fetchall():
        diff.add("closed", "documents", ref)


def check(url: str, model: StagedModel, code: str, scope: Optional[str] = None,
          storage_base: Optional[str] = None) -> Diff:
    with psycopg.connect(url, options="-c default_transaction_read_only=on") as conn, conn.cursor() as cur:
        return compare(cur, model, code, scope, storage_base)
