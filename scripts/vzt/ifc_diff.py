"""Porovnanie dvoch revízií IFC podľa GlobalId (overenie úpravy pred publikáciou, D-086).

Vypíše: zmenu počtu entít podľa triedy (aj geometrie, má byť 0), pridané a odobraté
objekty, a pre objekty s rovnakým GlobalId zmeny atribútov (Name, Description,
ObjectType, ElementType, PredefinedType, Tag), psetov (vlastné aj z typu) a materiálu
(aj zdedeného z typu). Nič nezapisuje do IFC.

    python scripts/vzt/ifc_diff.py --pred VZT_v010.ifc --po VZT_v011.ifc [--json diff.json] [--detail 30]
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Optional

import ifcopenshell
import ifcopenshell.util.element as E

ATTRS = ("Name", "Description", "ObjectType", "ElementType", "PredefinedType", "Tag")


def _material(el) -> Optional[str]:
    m = E.get_material(el, should_skip_usage=True)
    if m is None:
        return None
    return getattr(m, "Name", None) or m.is_a()


def snapshot(f: ifcopenshell.file) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for el in f.by_type("IfcObjectDefinition"):
        row: dict[str, Any] = {"_class": el.is_a()}
        for a in ATTRS:
            if hasattr(el, a):
                v = getattr(el, a)
                row[a] = v if v is None or isinstance(v, (str, int, float)) else str(v)
        for pset, props in E.get_psets(el).items():
            for k, v in props.items():
                if k != "id":
                    row[f"{pset}.{k}"] = v
        if el.is_a("IfcElement") or el.is_a("IfcElementType"):
            row["Material"] = _material(el)
        out[el.GlobalId] = row
    return out


def diff(pred: Path, po: Path) -> dict[str, Any]:
    a, b = ifcopenshell.open(str(pred)), ifcopenshell.open(str(po))
    ca = Counter(e.is_a() for e in a)
    cb = Counter(e.is_a() for e in b)
    entity_delta = {k: cb[k] - ca[k] for k in sorted(set(ca) | set(cb)) if cb[k] != ca[k]}
    sa, sb = snapshot(a), snapshot(b)
    added = sorted(set(sb) - set(sa))
    removed = sorted(set(sa) - set(sb))
    changed: dict[str, list[dict[str, Any]]] = {}
    by_field: Counter = Counter()
    by_class: Counter = Counter()
    for g in sorted(set(sa) & set(sb)):
        ra, rb = sa[g], sb[g]
        ch = [{"field": k, "before": ra.get(k), "after": rb.get(k)}
              for k in sorted(set(ra) | set(rb)) if ra.get(k) != rb.get(k)]
        if ch:
            changed[g] = ch
            by_class[rb["_class"]] += 1
            for c in ch:
                by_field[c["field"]] += 1
    count = lambda s: dict(sorted(Counter(r["_class"] for r in s.values()).items()))  # noqa: E731
    return {
        "pred": str(pred), "po": str(po),
        "objects": {"pred": len(sa), "po": len(sb)},
        "class_counts_pred": count(sa), "class_counts_po": count(sb),
        "entity_delta": entity_delta,
        "added": added, "removed": removed,
        "changed_objects": len(changed),
        "changed_by_class": dict(by_class.most_common()),
        "changed_by_field": dict(by_field.most_common()),
        "changed": changed,
    }


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pred", required=True, type=Path)
    ap.add_argument("--po", required=True, type=Path)
    ap.add_argument("--json", type=Path)
    ap.add_argument("--detail", type=int, default=0, help="koľko zmenených objektov vypísať")
    args = ap.parse_args(argv)
    d = diff(args.pred, args.po)
    if args.json:
        args.json.write_text(json.dumps(d, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(f"objekty: {d['objects']['pred']} -> {d['objects']['po']}, pridané {len(d['added'])}, odobraté {len(d['removed'])}")
    print("zmena počtu entít:", d["entity_delta"] or "žiadna")
    cp, cq = d["class_counts_pred"], d["class_counts_po"]
    diffc = {k: (cp.get(k, 0), cq.get(k, 0)) for k in sorted(set(cp) | set(cq)) if cp.get(k) != cq.get(k)}
    print("počty objektov podľa triedy, zmeny:", diffc or "žiadne")
    print(f"zmenené objekty: {d['changed_objects']}", d["changed_by_class"])
    print("zmenené polia:", d["changed_by_field"])
    groups: dict[str, list[str]] = defaultdict(list)
    for g, ch in d["changed"].items():
        groups[", ".join(c["field"] for c in ch)].append(g)
    for i, (fields, gs) in enumerate(groups.items()):
        if i >= args.detail:
            break
        ex = d["changed"][gs[0]]
        print(f"- {len(gs)}x [{fields}] napr. {gs[0]}: "
              + "; ".join(f"{c['field']}: {c['before']!r} -> {c['after']!r}" for c in ex))
    return 0


if __name__ == "__main__":
    sys.exit(main())
