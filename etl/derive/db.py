"""Zápis odvodených hrán do DB (D-080) — idempotentná rekonciliácia.

Hrany sa identifikujú deterministickým UUID z (zdroj, rel_type, from GUID, to GUID),
takže opakovaný beh nič nezduplikuje. Hrany toho istého zdroja, ktoré nový beh
už neodvodil, sa **neodstránia**, ale uzavrú (`valid_until = now()`) — história
ostáva, presne ako pri GUID histórii (D-010). Všetko v jednej transakcii.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .. import ids
from . import DerivedEdge


@dataclass
class WriteStats:
    written: int = 0
    closed: int = 0
    unresolved_guids: set[str] = field(default_factory=set)
    disallowed: list[tuple[str, str]] = field(default_factory=list)  # (guid, object_type)


def edge_uuid(source: str, edge: DerivedEdge) -> str:
    return ids.stable_uuid("derive", source, edge.rel_type, edge.from_guid, edge.to_guid)


def write_edges(cur, source: str, rel_type: str, edges: list[DerivedEdge]) -> WriteStats:
    """Zapíše `edges` (všetky jedného `rel_type`) a uzavrie zastarané hrany `source`."""
    stats = WriteStats()
    guids = sorted({g for e in edges for g in (e.from_guid, e.to_guid)})
    rows = cur.execute(
        "select h.ifc_guid, o.id, o.object_type from ifc_guid_history h "
        "join objects o on o.id = h.object_id "
        "where h.valid_until is null and h.ifc_guid = any(%s)",
        (guids,),
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
        # id hrany je z GUID; objekt s tým GUID sa môže zmeniť (premenovaný object_ref,
        # D-087), preto upsert prepisuje aj from_id/to_id.
        eid = edge_uuid(source, e)
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
        "where source = %s and rel_type = %s and valid_until is null and not (id = any(%s)) "
        "returning id",
        (source, rel_type, keep),
    ).fetchall()
    stats.closed = len(closed)
    return stats
