"""Zarovnanie federácie pre odvodzovače (D-080).

Geometriu (tesseláciu, BRep, priestorové dotazy) robí ifcopenshell
(`ifcopenshell.geom.tree`); tu je len prepočet IfcMapConversion → posun
modelu do referenčného rámca federácie, ktorý sa odovzdá ako `model-offset`.
Geometria sa nikdy neukladá do DB (D-044) — žije len počas behu odvodzovača.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import numpy as np


@dataclass(frozen=True)
class MapFrame:
    """Engineering CRS modelu voči mape (IfcMapConversion), dĺžky v metroch."""

    eastings: float
    northings: float
    height: float
    cos: float
    sin: float


def map_frame(model) -> Optional[MapFrame]:
    """Prvý IfcMapConversion modelu, alebo None (model bez georeferencie)."""
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
    """Posun (m), ktorý prevedie lokálne súradnice `other` do rámca `reference`.

    map = R·local + T  ⇒  local_ref = local_other + R⁻¹·(T_other − T_ref).
    Predpoklad: rovnaká rotácia aj mierka (federácia jedného projektu); inak
    by bolo treba plnú transformáciu — vtedy hlásime chybu, nie tichý omyl.
    """
    if reference is None or other is None:
        return np.zeros(3)
    if abs(reference.cos - other.cos) > 1e-6 or abs(reference.sin - other.sin) > 1e-6:
        raise ValueError("Modely federácie majú rôznu rotáciu IfcMapConversion — nepodporované.")
    dx = other.eastings - reference.eastings
    dy = other.northings - reference.northings
    c, s = reference.cos, reference.sin
    return np.array([c * dx + s * dy, -s * dx + c * dy, other.height - reference.height])
