"""Porovnanie dvoch revízií modelu na požiadanie (D-183 bod 7); nič sa neukladá.

Informácie (atribúty, psety a Qto, vzťahy) porovnáva DB funkcia `ifc_rev_compare` nad kópiami revízií (K2).
Poloha v DB nie je (geometria ide vždy do súboru, D-183 bod 6), preto ju `--placement` číta z archívov oboch
revízií: `ObjectPlacement` relatívne k podlažiu prvku (prvok bez podlažia k nadradenému priestorovému celku,
port k hostiteľovi, časť zostavy k zostave), tolerancia 1 mm a 0,001 rad. Posun podlažia alebo budovy je MODIFIED len toho objektu;
zmena `IfcMapConversion` je jedna spoločná zmena `georeference`; spoločný posun väčšiny prvkov (zapečený do
každého prvku) sa vypíše raz ako `common_shift` a prvky ním neoznačí.

Spustenie z koreňa repa:
    python -m etl.revision_compare --model VZT --from 10 --to 11
    python -m etl.revision_compare --model VZT --from 10 --to 11 --placement [--from-file a.ifc.gz --to-file b.ifc.gz]
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Optional

import ifcopenshell

TOLERANCE_M = 0.001
TOLERANCE_RAD = 0.001
COMMON_SHIFT_SHARE = 0.5


# ── poloha zo súboru ──────────────────────────────────────────────────────────

def _storey_anchor(e: ifcopenshell.entity_instance) -> Optional[ifcopenshell.entity_instance]:
    """Kotva polohy: prvok = jeho podlažie, časť zostavy = zostava, port = hostiteľ (hýbu sa s ním),
    priestorový celok = nadradený celok; prvok mimo podlažia = najbližší nadradený priestorový celok."""
    import ifcopenshell.util.element as ue

    if e.is_a("IfcSpatialElement") or e.is_a("IfcSpatialStructureElement"):
        return ue.get_aggregate(e)
    for rel in getattr(e, "Nests", None) or ():          # port vnorený v prvku
        return rel.RelatingObject
    whole = ue.get_aggregate(e)
    if whole is not None and not (whole.is_a("IfcSpatialElement") or whole.is_a("IfcSpatialStructureElement")):
        return whole                                    # časť zostavy (napr. IfcElementAssembly)
    parent = ue.get_container(e) or whole
    first = parent
    while parent is not None and not parent.is_a("IfcBuildingStorey"):
        parent = ue.get_aggregate(parent)
    return parent or first


def relative_placements(f: ifcopenshell.file) -> dict[str, tuple[Optional[str], Any]]:
    """{GlobalId: (GlobalId kotvy, matica 4x4 relatívne ku kotve v metroch)} pre IfcProduct s polohou."""
    import numpy as np
    import ifcopenshell.util.placement as up
    import ifcopenshell.util.unit as uu

    scale = uu.calculate_unit_scale(f)
    cache: dict[int, Any] = {}

    def absolute(p: Any) -> Any:
        if p.id() not in cache:
            m = np.array(up.get_local_placement(p), dtype=float)
            m[:3, 3] *= scale
            cache[p.id()] = m
        return cache[p.id()]

    out: dict[str, tuple[Optional[str], Any]] = {}
    for e in f.by_type("IfcProduct"):
        if getattr(e, "ObjectPlacement", None) is None:
            continue
        m = absolute(e.ObjectPlacement)
        anchor = _storey_anchor(e)
        if anchor is not None and getattr(anchor, "ObjectPlacement", None) is not None:
            m = np.linalg.inv(absolute(anchor.ObjectPlacement)) @ m
        out[e.GlobalId] = (anchor.GlobalId if anchor is not None else None, m)
    return out


def georeference(f: ifcopenshell.file) -> list[dict[str, Any]]:
    from etl.revision_copy import attributes

    # IFC2X3 IfcMapConversion nemá; poloha IfcSite je potom zmena atribútov alebo polohy budovy
    return sorted((attributes(m) for m in f.by_type("IfcMapConversion")), key=lambda d: json.dumps(d, sort_keys=True))


def _angle(r1: Any, r2: Any) -> float:
    import numpy as np

    c = (np.trace(r1.T @ r2) - 1.0) / 2.0
    return math.acos(max(-1.0, min(1.0, float(c))))


def placement_changes(a: ifcopenshell.file, b: ifcopenshell.file) -> dict[str, Any]:
    """Zmeny polohy medzi revíziami: {elements: {GlobalId: {dx, dy, dz, rotation_rad}}, common_shift, georeference}."""
    pa, pb = relative_placements(a), relative_placements(b)
    deltas: dict[str, tuple[Any, float]] = {}
    for gid, (anchor_b, mb) in pb.items():
        if gid not in pa:
            continue
        anchor_a, ma = pa[gid]
        if anchor_a != anchor_b:
            continue  # iné podlažie = zmena vzťahu, tú hlási DB
        deltas[gid] = (mb[:3, 3] - ma[:3, 3], _angle(ma[:3, :3], mb[:3, :3]))

    moved = {g: d for g, d in deltas.items()
             if float(max(abs(d[0]))) > TOLERANCE_M or d[1] > TOLERANCE_RAD}
    common = None
    if moved and deltas:
        key = Counter(tuple(round(float(x), 3) for x in d[0]) for d in moved.values() if d[1] <= TOLERANCE_RAD)
        if key:
            shift, n = key.most_common(1)[0]
            if n > COMMON_SHIFT_SHARE * len(deltas):
                common = {"dx": shift[0], "dy": shift[1], "dz": shift[2], "elements": n}
                moved = {g: d for g, d in moved.items()
                         if not (d[1] <= TOLERANCE_RAD and tuple(round(float(x), 3) for x in d[0]) == shift)}
    geo_a, geo_b = georeference(a), georeference(b)
    return {
        "elements": {g: {"dx": round(float(d[0][0]), 4), "dy": round(float(d[0][1]), 4), "dz": round(float(d[0][2]), 4),
                         "rotation_rad": round(d[1], 5)} for g, d in sorted(moved.items())},
        "common_shift": common,
        "georeference": {"from": geo_a, "to": geo_b} if geo_a != geo_b else None,
    }


# ── spojenie s DB ─────────────────────────────────────────────────────────────

def merge(rows: list[dict[str, Any]], placement: Optional[dict[str, Any]], classes: dict[str, str]) -> list[dict[str, Any]]:
    """Doplní aspekt `placement` k riadkom DB; prvok bez inej zmeny sa stane MODIFIED."""
    if not placement:
        return rows
    by_gid = {r["global_id"]: r for r in rows}
    out = list(rows)
    for gid, delta in placement["elements"].items():
        row = by_gid.get(gid)
        if row is None:
            out.append({"global_id": gid, "ifc_class": classes.get(gid, ""), "change_action": "MODIFIED",
                        "aspects": {"placement": delta}})
        elif row["change_action"] == "MODIFIED":
            row["aspects"] = {**(row["aspects"] or {}), "placement": delta}
        elif row["change_action"] == "NOCHANGE":   # len poznámka "zmenené cez typ"
            row["change_action"] = "MODIFIED"
            row["aspects"] = {**(row["aspects"] or {}), "placement": delta}
    return out


def summary(rows: list[dict[str, Any]]) -> dict[str, int]:
    c = Counter(r["change_action"] for r in rows if not (r["change_action"] == "NOCHANGE"))
    c["NOCHANGE_via_type"] = sum(1 for r in rows if r["change_action"] == "NOCHANGE")
    return dict(sorted(c.items()))


def compare(model: str, rev_from: int, rev_to: int, with_placement: bool, from_file: Optional[Path] = None,
            to_file: Optional[Path] = None, db_url: Optional[str] = None) -> dict[str, Any]:
    import psycopg

    from etl import config
    from etl.revision_copy import load_bytes, open_verified

    db_url = db_url or config.database_url()
    with psycopg.connect(db_url) as conn, conn.cursor() as cur:
        rows = [dict(zip(("global_id", "ifc_class", "change_action", "aspects"), r)) for r in
                cur.execute("select * from ifc_rev_compare(%s, %s, %s)", (model, rev_from, rev_to)).fetchall()]
        sha = dict(cur.execute("select revision, sha256 from model_revisions where model = %s and revision in (%s, %s)",
                               (model, rev_from, rev_to)).fetchall())
        classes = dict(cur.execute("select global_id, ifc_class from ifc_rev_objects where model = %s and revision = %s",
                                   (model, rev_to)).fetchall()) if with_placement else {}
    placement = None
    if with_placement:
        fa, _ = open_verified(load_bytes(model, rev_from, from_file), sha.get(rev_from))
        fb, _ = open_verified(load_bytes(model, rev_to, to_file), sha.get(rev_to))
        placement = placement_changes(fa, fb)
        rows = merge(rows, placement, classes)
    rows.sort(key=lambda r: (r["change_action"], r["ifc_class"], r["global_id"]))
    return {
        "model": model, "from": rev_from, "to": rev_to,
        "summary": summary(rows),
        "common_shift": placement["common_shift"] if placement else None,
        "georeference": placement["georeference"] if placement else None,
        "placement": "compared" if with_placement else "not compared (--placement reads both archives)",
        "changes": rows,
    }


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m etl.revision_compare", description=__doc__.split("\n\n")[0])
    ap.add_argument("--model", required=True)
    ap.add_argument("--from", dest="rev_from", type=int, required=True)
    ap.add_argument("--to", dest="rev_to", type=int, required=True)
    ap.add_argument("--placement", action="store_true", help="porovnať aj polohu zo súborov oboch revízií")
    ap.add_argument("--from-file", type=Path, help="lokálny archív revízie --from (sha256 sa overí)")
    ap.add_argument("--to-file", type=Path, help="lokálny archív revízie --to (sha256 sa overí)")
    args = ap.parse_args(argv)
    res = compare(args.model, args.rev_from, args.rev_to, args.placement, args.from_file, args.to_file)
    print(json.dumps(res, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
