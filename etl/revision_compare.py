"""On-demand comparison of two model revisions (D-183 point 7); nothing is stored.

Information (attributes, psets and Qto, relationships) is compared by the DB function `ifc_rev_compare` over the revision
copies (K2). Placement is not in the DB (geometry always goes to the file, D-183 point 6), so `--placement` reads it from
the archives of both revisions: `ObjectPlacement` relative to the element's storey (an element without a storey to its
parent spatial whole, a port to its host, an assembly part to the assembly), tolerance 1 mm and 0.001 rad. A shift of a
storey or building is MODIFIED for that object only; a change of `IfcMapConversion` is one shared `georeference` change;
a common shift of most elements (baked into every element) is reported once as `common_shift` and does not flag the
elements.

Run from the repo root:
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


# ── placement from the file ───────────────────────────────────────────────────

def _storey_anchor(e: ifcopenshell.entity_instance) -> Optional[ifcopenshell.entity_instance]:
    """Placement anchor: element = its storey, assembly part = the assembly, port = host (they move with it),
    spatial whole = its parent whole; an element outside a storey = the nearest parent spatial whole."""
    import ifcopenshell.util.element as ue

    if e.is_a("IfcSpatialElement") or e.is_a("IfcSpatialStructureElement"):
        return ue.get_aggregate(e)
    for rel in getattr(e, "Nests", None) or ():          # port nested in the element
        return rel.RelatingObject
    whole = ue.get_aggregate(e)
    if whole is not None and not (whole.is_a("IfcSpatialElement") or whole.is_a("IfcSpatialStructureElement")):
        return whole                                    # assembly part (e.g. IfcElementAssembly)
    parent = ue.get_container(e) or whole
    first = parent
    while parent is not None and not parent.is_a("IfcBuildingStorey"):
        parent = ue.get_aggregate(parent)
    return parent or first


def relative_placements(f: ifcopenshell.file) -> dict[str, tuple[Optional[str], Any]]:
    """{GlobalId: (anchor GlobalId, 4x4 matrix relative to the anchor in metres)} for IfcProduct with a placement."""
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

    # IFC2X3 has no IfcMapConversion; the IfcSite placement is then an attribute change or a building placement change
    return sorted((attributes(m) for m in f.by_type("IfcMapConversion")), key=lambda d: json.dumps(d, sort_keys=True))


def _angle(r1: Any, r2: Any) -> float:
    import numpy as np

    c = (np.trace(r1.T @ r2) - 1.0) / 2.0
    return math.acos(max(-1.0, min(1.0, float(c))))


def placement_changes(a: ifcopenshell.file, b: ifcopenshell.file) -> dict[str, Any]:
    """Placement changes between revisions: {elements: {GlobalId: {dx, dy, dz, rotation_rad}}, common_shift, georeference}."""
    pa, pb = relative_placements(a), relative_placements(b)
    deltas: dict[str, tuple[Any, float]] = {}
    for gid, (anchor_b, mb) in pb.items():
        if gid not in pa:
            continue
        anchor_a, ma = pa[gid]
        if anchor_a != anchor_b:
            continue  # a different storey = a relationship change, which the DB reports
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


# ── connection to the DB ──────────────────────────────────────────────────────

def merge(rows: list[dict[str, Any]], placement: Optional[dict[str, Any]], classes: dict[str, str]) -> list[dict[str, Any]]:
    """Add the `placement` aspect to the DB rows; an element with no other change becomes MODIFIED."""
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
        elif row["change_action"] == "NOCHANGE":   # only the note "changed via type"
            row["change_action"] = "MODIFIED"
            row["aspects"] = {**(row["aspects"] or {}), "placement": delta}
    return out


def summary(rows: list[dict[str, Any]]) -> dict[str, int]:
    c = Counter(r["change_action"] for r in rows if not (r["change_action"] == "NOCHANGE"))
    c["NOCHANGE_via_type"] = sum(1 for r in rows if r["change_action"] == "NOCHANGE")
    return dict(sorted(c.items()))


def compare(model: str, rev_from: int, rev_to: int, with_placement: bool, from_file: Optional[Path] = None,
            to_file: Optional[Path] = None, db_url: Optional[str] = None,
            project_code: Optional[str] = None) -> dict[str, Any]:
    import psycopg

    from etl import config
    from etl import project as project_mod
    from etl.revision_copy import load_bytes, open_verified, revision_row

    db_url = db_url or config.database_url()
    with psycopg.connect(db_url) as conn, conn.cursor() as cur:
        pid = project_mod.require(cur, config.project_code(project_code))
        a, b = revision_row(cur, pid, model, rev_from), revision_row(cur, pid, model, rev_to)
        rows = [dict(zip(("global_id", "ifc_class", "change_action", "aspects"), r)) for r in
                cur.execute("select * from ifc_rev_compare(%s, %s, %s, %s)",
                            (model, rev_from, rev_to, pid)).fetchall()]
        classes = dict(cur.execute("select global_id, ifc_class from ifc_rev_objects where model_revision_id = %s",
                                   (b.id,)).fetchall()) if with_placement else {}
    placement = None
    if with_placement:
        fa, _ = open_verified(load_bytes(a.archive_path, from_file), a.sha256)
        fb, _ = open_verified(load_bytes(b.archive_path, to_file), b.sha256)
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
    ap.add_argument("--project", metavar="CODE", help="project code (D-189); default env AIM_PROJECT or OCB")
    args = ap.parse_args(argv)
    res = compare(args.model, args.rev_from, args.rev_to, args.placement, args.from_file, args.to_file,
                  project_code=args.project)
    print(json.dumps(res, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
