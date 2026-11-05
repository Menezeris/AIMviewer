"""Opening the IFC model + low-level helpers (D-031).

A thin layer over ifcopenshell - keeps the import localized so that `transform.py`
stays about mapping. The actual mapping (and its tuning to the thesis model) is
in `transform.py`.
"""

from __future__ import annotations

from typing import Any

import ifcopenshell


def open_model(path: str) -> ifcopenshell.file:
    """Load an IFC file (raises an understandable error if that is not possible)."""
    try:
        return ifcopenshell.open(path)
    except Exception as exc:  # noqa: BLE001 - we want an understandable message
        raise SystemExit(f"Nepodarilo sa otvoriť IFC '{path}': {exc}") from exc


def attr(entity: Any, name: str) -> Any:
    """Safe reading of an IFC attribute (None if missing)."""
    return getattr(entity, name, None)


def schema_version(model: ifcopenshell.file) -> str:
    return getattr(model, "schema", "?")
