"""Post-processing derivers over the loaded IFC models (D-080).

A deriver (rule) receives one or more IFC models of the federation and returns edges
that are in no source file but can be derived from them (geometry,
transitivity, ...). The edges live only in our DB as a layer above the sources: the source IFC
files are never overwritten, every derived edge carries `source='derive:<rule>'`
and a run is idempotent (reconciliation in `db.py`).

A new deriver = a new class with `name`/`rel_type` and a `derive(ctx)` method,
registered in `RULES`. Run: `python -m etl.derive <rule> --models ...`.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DerivedEdge:
    """One derived edge between two IFC entities (identity = IFC GUID)."""

    rel_type: str
    from_guid: str
    to_guid: str
    role: str | None
