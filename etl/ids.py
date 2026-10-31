"""Deterministické UUID pre idempotentné re-runy (D-031).

`objects.id` ostáva DB-generované (verné D-010 — Master UUID vlastní DB), preto
sa tu **negeneruje**; uzly sa upsertujú cez `object_ref`. Deterministické UUID sa
používajú len tam, kde tabuľka nemá prirodzený unikátny kľúč: hrany `rel_*`,
`classification_systems`, `ifc_guid_history`. Tým je re-import stabilný
(`ON CONFLICT (id) DO UPDATE`).
"""

from __future__ import annotations

import uuid

# Stabilný namespace pre celý AIM ETL (ľubovoľné fixné UUID — nemeniť).
_NS = uuid.UUID("a1b0c0d0-0000-4000-8000-000000000031")


def stable_uuid(*parts: str) -> str:
    """UUIDv5 z pipe-spojených častí — rovnaký vstup ⇒ rovnaké UUID."""
    return str(uuid.uuid5(_NS, "|".join(parts)))


def edge_id(from_ref: str, to_ref: str, edge_type: str) -> str:
    """Deterministické id hrany `rel_*` (from→to + typ hrany)."""
    return stable_uuid("edge", edge_type, from_ref, to_ref)


def system_id(name: str) -> str:
    """Deterministické id klasifikačného systému (názov je jeho identita)."""
    return stable_uuid("clsys", name)


def guid_history_id(object_ref: str, ifc_guid: str) -> str:
    """Deterministické id záznamu histórie GUID."""
    return stable_uuid("guidhist", object_ref, ifc_guid)


def guid_alias_id(object_ref: str, ifc_guid: str) -> str:
    """Deterministické id aliasu GUID (zlúčený IFC typ -> `asset_type`, D-033, D-183 K3)."""
    return stable_uuid("guidalias", object_ref, ifc_guid)
