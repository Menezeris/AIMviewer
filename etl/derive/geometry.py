"""Federation alignment for the derivers (D-080).

Geometry (tessellation, BRep, spatial queries) is done by ifcopenshell
(`ifcopenshell.geom.tree`); here is only the conversion of IfcMapConversion -> the shift
of the model into the reference frame of the federation, passed on as `model-offset`.
Geometry is never stored in the DB (D-044) - it lives only during the deriver run.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import numpy as np


@dataclass(frozen=True)
class MapFrame:
    """The engineering CRS of the model relative to the map (IfcMapConversion), lengths in metres."""

    eastings: float
    northings: float
    height: float
    cos: float
    sin: float


def map_frame(model) -> Optional[MapFrame]:
    """The first IfcMapConversion of the model, or None (a model without georeferencing)."""
    try:
        convs = model.by_type("IfcMapConversion")
    except RuntimeError:
        return None
    if not convs:
        return None
    mc = convs[0]
    a = mc.XAxisAbscissa if mc.XAxisAbscissa is not None else 1.0
    b = mc.XAxisOrdinate if mc.XAxisOrdinate is not None else 0.0
    n = math.hypot(a, b) or 1.0
    return MapFrame(
        float(mc.Eastings or 0.0),
        float(mc.Northings or 0.0),
        float(mc.OrthogonalHeight or 0.0),
        a / n,
        b / n,
    )


def offset_to(reference: Optional[MapFrame], other: Optional[MapFrame]) -> np.ndarray:
    """The shift (m) that converts the local coordinates of `other` into the frame of `reference`.

    map = R*local + T  =>  local_ref = local_other + R^-1*(T_other - T_ref).
    Assumption: the same rotation and scale (a federation of one project); otherwise
    a full transformation would be needed - then we report an error, not a silent mistake.
    """
    if reference is None or other is None:
        return np.zeros(3)
    if abs(reference.cos - other.cos) > 1e-6 or abs(reference.sin - other.sin) > 1e-6:
        raise ValueError("Modely federácie majú rôznu rotáciu IfcMapConversion — nepodporované.")
    dx = other.eastings - reference.eastings
    dy = other.northings - reference.northings
    c, s = reference.cos, reference.sin
    return np.array([c * dx + s * dy, -s * dx + c * dy, other.height - reference.height])
