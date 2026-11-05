"""Deterministic UUIDs for idempotent re-runs (D-031).

`objects.id` stays DB-generated (faithful to D-010 - the Master UUID is owned by the DB), so
it is **not** generated here; nodes are upserted via `object_ref`. Deterministic UUIDs are
used only where the table has no natural unique key: `rel_*` edges,
`classification_systems`, `ifc_guid_history`. This makes re-import stable
(`ON CONFLICT (id) DO UPDATE`).
"""

from __future__ import annotations

import uuid

# Stable namespace for the whole AIM ETL (any fixed UUID - do not change).
_NS = uuid.UUID("a1b0c0d0-0000-4000-8000-000000000031")


def stable_uuid(*parts: str) -> str:
    """UUIDv5 from pipe-joined parts - same input -> same UUID."""
    return str(uuid.uuid5(_NS, "|".join(parts)))


def edge_id(from_ref: str, to_ref: str, edge_type: str) -> str:
    """Deterministic id of a `rel_*` edge (from->to + edge type)."""
    return stable_uuid("edge", edge_type, from_ref, to_ref)


def system_id(name: str) -> str:
    """Deterministic id of a classification system (the name is its identity)."""
    return stable_uuid("clsys", name)


def guid_history_id(object_ref: str, ifc_guid: str) -> str:
    """Deterministic id of a GUID history record."""
    return stable_uuid("guidhist", object_ref, ifc_guid)


def guid_alias_id(object_ref: str, ifc_guid: str) -> str:
    """Deterministic id of a GUID alias (merged IFC type -> `asset_type`, D-033, D-183 K3)."""
    return stable_uuid("guidalias", object_ref, ifc_guid)
