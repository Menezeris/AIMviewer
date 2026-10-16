"""Geometrické pomôcky odvodzovačov (D-080): triangulácia z ifcopenshell,
zarovnanie federácie cez IfcMapConversion a test bodu v pôdoryse priestoru.

Geometria sa nikdy neukladá do DB (D-044) — žije len počas behu odvodzovača.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Iterator, Optional

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


@dataclass
class Mesh:
    guid: str
    ifc_type: str
    verts: np.ndarray  # (n, 3) v metroch, v referenčnom rámci federácie
    faces: np.ndarray  # (m, 3) indexy do verts


def iter_meshes(model, products: Iterable, offset: np.ndarray) -> Iterator[Mesh]:
    """Triangulované tvary produktov vo svetových súradniciach + posun federácie."""
    import ifcopenshell.geom

    products = list(products)
    if not products:
        return
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    it = ifcopenshell.geom.iterator(settings, model, 1, include=products)
    if not it.initialize():
        return
    while True:
        shape = it.get()
        verts = np.asarray(shape.geometry.verts, dtype=float).reshape(-1, 3) + offset
        faces = np.asarray(shape.geometry.faces, dtype=np.int64).reshape(-1, 3)
        if len(verts) and len(faces):
            yield Mesh(shape.guid, model.by_guid(shape.guid).is_a(), verts, faces)
        if not it.next():
            break


@dataclass
class Footprint:
    """Priestor ako hranol: pôdorys (projekcia nevertikálnych trojuholníkov) × výška."""

    guid: str
    tri: np.ndarray  # (k, 3, 2) trojuholníky pôdorysu v XY
    xy_min: np.ndarray
    xy_max: np.ndarray
    z_min: float
    z_max: float


def footprint(mesh: Mesh, z_top: Optional[float] = None, z_below: float = 0.05) -> Optional[Footprint]:
    """Pôdorys uzavretého telesa = zjednotenie projekcií jeho nevertikálnych stien.

    `z_top` predĺži priestor nahor (napr. po úroveň podlažia nad ním), aby do
    miestnosti spadli aj prvky v podhľade — telo IfcSpace v Reverte končí na
    podhľade, VZT býva nad ním.
    """
    tri3 = mesh.verts[mesh.faces]  # (m, 3, 3)
    e1 = tri3[:, 1] - tri3[:, 0]
    e2 = tri3[:, 2] - tri3[:, 0]
    nz = np.cross(e1, e2)[:, 2]
    area = np.linalg.norm(np.cross(e1, e2), axis=1)
    keep = np.abs(nz) > 0.1 * np.maximum(area, 1e-12)
    if not keep.any():
        return None
    tri = tri3[keep][:, :, :2]
    z0 = float(mesh.verts[:, 2].min())
    z1 = float(mesh.verts[:, 2].max())
    return Footprint(
        mesh.guid,
        tri,
        tri.reshape(-1, 2).min(0),
        tri.reshape(-1, 2).max(0),
        z0 - z_below,
        max(z1, z_top) if z_top is not None else z1,
    )


def points_inside(fp: Footprint, pts: np.ndarray, eps: float = 1e-9) -> np.ndarray:
    """Bool maska bodov (n, 3) vnútri hranola `fp` (hranica sa počíta dnu)."""
    inside = (
        (pts[:, 2] >= fp.z_min)
        & (pts[:, 2] <= fp.z_max)
        & (pts[:, 0] >= fp.xy_min[0])
        & (pts[:, 0] <= fp.xy_max[0])
        & (pts[:, 1] >= fp.xy_min[1])
        & (pts[:, 1] <= fp.xy_max[1])
    )
    idx = np.nonzero(inside)[0]
    if len(idx) == 0:
        return inside
    p = pts[idx, :2][:, None, :]  # (n, 1, 2)
    a, b, c = fp.tri[:, 0][None], fp.tri[:, 1][None], fp.tri[:, 2][None]  # (1, k, 2)

    def cross(o, u, v):
        return (u[..., 0] - o[..., 0]) * (v[..., 1] - o[..., 1]) - (u[..., 1] - o[..., 1]) * (v[..., 0] - o[..., 0])

    d1, d2, d3 = cross(a, b, p), cross(b, c, p), cross(c, a, p)
    neg = (d1 < -eps) | (d2 < -eps) | (d3 < -eps)
    pos = (d1 > eps) | (d2 > eps) | (d3 > eps)
    hit = (~(neg & pos)).any(axis=1)
    out = np.zeros(len(pts), dtype=bool)
    out[idx[hit]] = True
    return out


def sample_points(mesh: Mesh, max_points: int = 48) -> np.ndarray:
    """Body reprezentujúce prvok: stred obálky + rovnomerne vybrané vrcholy."""
    v = mesh.verts
    center = (v.min(0) + v.max(0)) / 2
    if len(v) > max_points - 1:
        v = v[np.linspace(0, len(v) - 1, max_points - 1).astype(int)]
    return np.vstack([center, v])
