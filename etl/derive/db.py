"""Writing derived edges to the DB (D-080) - idempotent reconciliation.

Edges are identified by a deterministic UUID from (source, rel_type, from GUID, to GUID),
so a repeated run duplicates nothing. Edges of the same source that the new run
no longer derived are **not deleted** but closed (`valid_until = now()`) - the history
stays, exactly as with the GUID history (D-010). Everything in one transaction.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .. import ids
from ..project import OCB_ID
from . import DerivedEdge


@dataclass
class WriteStats:
    written: int = 0
    closed: int = 0
    unresolved_guids: set[str] = field(default_factory=set)
    disallowed: list[tuple[str, str]] = field(default_factory=list)  # (guid, object_type)


def edge_uuid(source: str, edge: DerivedEdge, project_id: str = OCB_ID) -> str:
    """Deterministic id from GUIDs. A GUID is unique only within a project (D-189), so outside OCB the
    project is part of the key; OCB keeps its existing ids."""
    if project_id == OCB_ID:
        return ids.stable_uuid("derive", source, edge.rel_type, edge.from_guid, edge.to_guid)
    return ids.stable_uuid("derive", project_id, source, edge.rel_type, edge.from_guid, edge.to_guid)


def write_edges(cur, source: str, rel_type: str, edges: list[DerivedEdge],
                project_id: str = OCB_ID) -> WriteStats:
    """Writes `edges` (all of one `rel_type`) and closes the stale edges of `source` in the project (D-189)."""
    stats = WriteStats()
    guids = sorted({g for e in edges for g in (e.from_guid, e.to_guid)})
    rows = cur.execute(
        "select h.ifc_guid, o.id, o.object_type from ifc_guid_history h "
        "join objects o on o.id = h.object_id "
        "where h.valid_until is null and h.ifc_guid = any(%s) and o.project_id = %s",
        (guids, project_id),
    ).fetchall()
    by_guid = {g: (oid, otype) for g, oid, otype in rows}

    allowed = cur.execute(
        "select from_object_types, to_object_types from relationship_types where rel_type = %s",
        (rel_type,),
    ).fetchone()
    if allowed is None:
        raise SystemExit(f"rel_type {rel_type} nie je v manifeste — chýba migrácia (D-080).")
    from_ok, to_ok = set(allowed[0] or []), set(allowed[1] or [])

    keep: list[str] = []
    for e in edges:
        if e.rel_type != rel_type:
            raise ValueError(f"Odvodzovač vydal {e.rel_type}, očakávaný {rel_type}.")
        f, t = by_guid.get(e.from_guid), by_guid.get(e.to_guid)
        if f is None or t is None:
            stats.unresolved_guids.update(g for g, r in ((e.from_guid, f), (e.to_guid, t)) if r is None)
            continue
        if from_ok and f[1] not in from_ok:
            stats.disallowed.append((e.from_guid, f[1]))
            continue
        if to_ok and t[1] not in to_ok:
            stats.disallowed.append((e.to_guid, t[1]))
            continue
        # The edge id comes from the GUIDs; the object with that GUID can change (a renamed
        # object_ref, D-088), so the upsert also overwrites from_id/to_id.
        eid = edge_uuid(source, e, project_id)
        keep.append(eid)
        cur.execute(
            """
            insert into relationships
              (id, rel_type, from_id, to_id, role, valid_from, valid_until, source)
            values (%s, %s, %s, %s, %s, now(), null, %s)
            on conflict (id) do update set
              from_id = excluded.from_id, to_id = excluded.to_id,
              role = excluded.role, valid_until = null, source = excluded.source
            """,
            (eid, rel_type, f[0], t[0], e.role, source),
        )
        stats.written += 1

    closed = cur.execute(
        "update relationships set valid_until = now() "
        "where source = %s and rel_type = %s and project_id = %s and valid_until is null "
        "and not (id = any(%s)) returning id",
        (source, rel_type, project_id, keep),
    ).fetchall()
    stats.closed = len(closed)
    return stats
