"""CLI odvodzovačov (D-080).

    python -m etl.derive spatial_reference --models podklady/FINAL/ASR.ifc podklady/FINAL/VZT.ifc --dry-run
    python -m etl.derive spatial_reference --models … --report out/spatial.csv   # zapíše do DB + report

Prvý model je referenčný súradnicový rámec; ostatné sa zarovnajú cez IfcMapConversion.
"""

from __future__ import annotations

import argparse
import collections
import csv
import sys
from pathlib import Path
from typing import Optional, Sequence

from .. import config, extract
from . import spatial_reference

RULES = {"spatial_reference": spatial_reference}


def main(argv: Optional[Sequence[str]] = None) -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    p = argparse.ArgumentParser(description="AIM ETL — odvodené hrany (D-080)")
    p.add_argument("rule", choices=sorted(RULES), help="odvodzovač")
    p.add_argument("--models", nargs="+", required=True, help="IFC súbory federácie (prvý = referenčný rámec)")
    p.add_argument("--dry-run", action="store_true", help="nepíš do DB, len zhrnutie")
    p.add_argument("--report", help="CSV s odvodenými hranami a nespárovanými prvkami")
    p.add_argument("--include", nargs="+", help="IFC triedy prvkov (default IfcDistributionElement IfcFurnishingElement)")
    p.add_argument("--spatial", nargs="+", help="IFC triedy priestorov (default IfcSpace IfcSpatialZone)")
    p.add_argument("--no-plenum", action="store_true", help="nepredlžovať priestor po podlažie nad ním")
    args = p.parse_args(argv)

    models = [extract.open_model(m) for m in args.models]
    names = {}
    for m in models:
        for e in m.by_type("IfcRoot"):
            names[e.GlobalId] = (e.is_a(), getattr(e, "Name", None), getattr(e, "LongName", None))

    cfg = spatial_reference.SpatialReferenceConfig()
    if args.include:
        cfg.element_classes = tuple(args.include)
    if args.spatial:
        cfg.spatial_classes = tuple(args.spatial)
    if args.no_plenum:
        cfg.extend_to_storey_above = False

    res = spatial_reference.derive(models, cfg)
    roles = collections.Counter(e.role for e in res.edges)
    print(f"Priestory: {res.spaces_total}, prvky: {res.elements_total}, "
          f"spárované: {res.elements_matched}, hrany: {len(res.edges)} {dict(roles)}")
    if res.unmatched:
        by_type = collections.Counter(t for _, t in res.unmatched)
        print(f"Bez priestoru: {len(res.unmatched)} {dict(by_type.most_common(8))}")
    if res.overlaps:
        print(f"QA: {len(res.overlaps)} dvojíc prekrývajúcich sa priestorov (prvok naraz 'inside' v oboch):")
        for (a, b), n in sorted(res.overlaps.items(), key=lambda kv: -kv[1])[:15]:
            na, nb = names.get(a, ("?",) * 3), names.get(b, ("?",) * 3)
            print(f"  {n:4d} × {na[1]} {na[2]!r}  ↔  {nb[1]} {nb[2]!r}")

    if args.report:
        Path(args.report).parent.mkdir(parents=True, exist_ok=True)
        with open(args.report, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["element_guid", "element_type", "element_name", "space_guid", "space_name",
                        "space_long_name", "role", "ratio"])
            for e in res.edges:
                ne, ns = names.get(e.from_guid, ("?",) * 3), names.get(e.to_guid, ("?",) * 3)
                w.writerow([e.from_guid, ne[0], ne[1], e.to_guid, ns[1], ns[2], e.role, e.evidence])
            for g, t in res.unmatched:
                w.writerow([g, t, names.get(g, ("?",) * 3)[1], "", "", "", "unmatched", 0])
        print(f"Report: {args.report}")

    if args.dry_run:
        print("--dry-run → do DB sa nezapisuje.")
        return

    import psycopg

    from .db import write_edges

    source = f"derive:{args.rule}"
    with psycopg.connect(config.database_url()) as conn:
        with conn.cursor() as cur:
            st = write_edges(cur, source, spatial_reference.REL_TYPE, res.edges)
        conn.commit()
    print(f"DB: zapísané {st.written}, uzavreté zastarané {st.closed}, "
          f"GUID mimo DB {len(st.unresolved_guids)}, nepovolený object_type {len(st.disallowed)}")


if __name__ == "__main__":
    main()
