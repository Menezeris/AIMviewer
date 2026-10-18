"""CLI odvodzovačov (D-080) a registra pravidiel odvodení (D-089).

    python -m etl.derive run --models ASR.ifc VZT.ifc [--rule ID …] [--trigger auto|manual] [--dry-run]
    python -m etl.derive rules                       # pravidlá, stav a posledný beh
    python -m etl.derive enable --rule ID [--mode auto|manual]
    python -m etl.derive disable --rule ID           # uzavrie hrany pravidla
    python -m etl.derive spatial_reference --models … [--dry-run] [--report out.csv]   # priamo D-080

`run` bez `--rule` spustí zapnuté pravidlá (pri `--trigger auto` len v režime auto) a vypnutým
uzavrie hrany. Prvý model je referenčný súradnicový rámec; ostatné sa zarovnajú cez
IfcMapConversion.
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


def main(argv: Optional[Sequence[str]] = None) -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    p = argparse.ArgumentParser(description="AIM ETL — odvodené hrany (D-080, D-089)")
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="spustiť pravidlá z registra (D-089)")
    r.add_argument("--models", nargs="+", required=True, help="IFC súbory federácie (prvý = referenčný rámec)")
    r.add_argument("--rule", nargs="+", help="len tieto pravidlá (inak zapnuté podľa režimu)")
    r.add_argument("--trigger", choices=("auto", "manual"), default="manual",
                   help="auto = po novej revízii (len pravidlá v režime auto)")
    r.add_argument("--dry-run", action="store_true", help="nepíš do DB, len zhrnutie")

    sub.add_parser("rules", help="zoznam pravidiel a posledný beh")
    for name in ("enable", "disable"):
        e = sub.add_parser(name, help=f"{'zapnúť' if name == 'enable' else 'vypnúť'} pravidlo")
        e.add_argument("--rule", required=True)
        if name == "enable":
            e.add_argument("--mode", choices=("auto", "manual"))

    lp = sub.add_parser("spatial_reference", help="priamo odvodzovač D-080 (bez registra)")
    lp.add_argument("--models", nargs="+", required=True, help="IFC súbory federácie (prvý = referenčný rámec)")
    lp.add_argument("--dry-run", action="store_true", help="nepíš do DB, len zhrnutie")
    lp.add_argument("--report", help="CSV s odvodenými hranami a nespárovanými prvkami")
    lp.add_argument("--include", nargs="+", help="IFC triedy prvkov (default IfcDistributionElement IfcFurnishingElement)")
    lp.add_argument("--spatial", nargs="+", help="IFC triedy priestorov (default IfcSpace)")
    lp.add_argument("--inside-only", action="store_true", help="len prvky celé vnútri priestoru (bez partial)")
    args = p.parse_args(argv)

    if args.cmd == "run":
        cmd_run(args)
    elif args.cmd == "rules":
        cmd_rules()
    elif args.cmd in ("enable", "disable"):
        cmd_toggle(args)
    else:
        cmd_spatial_reference(args)


def _print_derive_summary(res, names) -> None:
    roles = collections.Counter(e.role for e in res.edges)
    print(f"Priestory: {res.spaces_total}, prvky: {res.elements_total}, "
          f"spárované: {res.elements_matched}, hrany: {len(res.edges)} {dict(roles)}")
    if res.unmatched:
        by_type = collections.Counter(t for _, t in res.unmatched)
        print(f"Bez priestoru: {len(res.unmatched)} {dict(by_type.most_common(8))}")
    if res.overlaps:
        print(f"QA: {len(res.overlaps)} dvojíc prekrývajúcich sa priestorov (prvok celý v oboch naraz):")
        for (a, b), n in sorted(res.overlaps.items(), key=lambda kv: -kv[1])[:15]:
            na, nb = names.get(a, ("?",) * 3), names.get(b, ("?",) * 3)
            print(f"  {n:4d} × {na[1]} {na[2]!r}  ↔  {nb[1]} {nb[2]!r}")


def cmd_run(args) -> None:
    """Register pravidiel (D-089): geometria raz pre všetky zapnuté geometrické pravidlá."""
    import psycopg

    from .db import write_edges
    from .registry import (RuleResult, close_rule_edges, current_revisions, load_rules,
                           partition_edges, record_run, select_rules)

    url = config.database_url()
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        rules = load_rules(cur)
        revisions = current_revisions(cur)
    to_run, to_close = select_rules(rules, args.rule, args.trigger)
    geo = [r for r in to_run if r.kind == "geometry"]
    print(f"Pravidlá na výpočet: {[r.id for r in to_run] or '-'}; na uzavretie: "
          f"{[r.id for r in to_close] or '-'}; revízie {revisions or '-'}")

    edges_by_rule: dict = {}
    if geo:
        models = [extract.open_model(m) for m in args.models]
        cfg = spatial_reference.SpatialReferenceConfig(
            element_classes=tuple(sorted({c for r in geo for c in r.source_classes})),
            spatial_classes=tuple(sorted({c for r in geo for c in r.target_classes})),
            include_partial=any("partial" in r.roles for r in geo),
        )
        res = spatial_reference.derive(models, cfg)
        entities = {e.GlobalId: e for m in models for e in m.by_type("IfcRoot")}
        names = {g: (e.is_a(), getattr(e, "Name", None), getattr(e, "LongName", None))
                 for g, e in entities.items()}
        _print_derive_summary(res, names)
        edges_by_rule = partition_edges(res.edges, geo, entities)

    for r in to_run:
        n = len(edges_by_rule.get(r.id, ()))
        print(f"  {r.id}: {n if r.kind == 'geometry' else 'pohľad'}"
              f"{' ' + str(dict(collections.Counter(e.role for e in edges_by_rule[r.id]))) if n else ''}")
    if args.dry_run:
        print("--dry-run → do DB sa nezapisuje.")
        return

    results: list[RuleResult] = []
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            for r in to_run:
                if r.kind == "geometry":
                    edges = edges_by_rule.get(r.id, [])
                    st = write_edges(cur, r.source, r.rel_type, edges)
                    results.append(RuleResult(
                        r.id, "ok", st.written, st.closed, len(st.unresolved_guids),
                        {"roles": dict(collections.Counter(e.role for e in edges)),
                         "disallowed": len(st.disallowed)}))
                else:
                    rows, elements = cur.execute(
                        "select count(*), count(distinct element_id) from v_zone_elements"
                    ).fetchone()
                    results.append(RuleResult(r.id, "ok", details={"rows": rows, "elements": elements}))
            for r in to_close:
                closed = close_rule_edges(cur, r)
                if closed:
                    results.append(RuleResult(r.id, "disabled", closed=closed))
            for res_ in results:
                record_run(cur, res_, args.trigger, revisions)
        conn.commit()
    for res_ in results:
        print(f"DB {res_.rule_id}: {res_.status}, zapísané {res_.written}, uzavreté {res_.closed}, "
              f"GUID mimo DB {res_.unresolved} {res_.details or ''}")


def cmd_rules() -> None:
    import psycopg

    from .registry import last_runs, load_rules

    with psycopg.connect(config.database_url()) as conn, conn.cursor() as cur:
        rules = load_rules(cur)
        last = last_runs(cur)
    for r in rules:
        state = f"{'zapnuté' if r.enabled else 'vypnuté'}, {r.mode}"
        lr = last.get(r.id)
        run = (f"{lr[2]:%Y-%m-%d %H:%M} {lr[0]} (+{lr[3]} / -{lr[4]}) {lr[5]}" if lr else "bez behu")
        print(f"{r.id:26} {state:20} {', '.join(r.target_classes):18} {run}")


def cmd_toggle(args) -> None:
    import psycopg

    from .registry import RuleResult, close_rule_edges, current_revisions, record_run, set_enabled

    enable = args.cmd == "enable"
    with psycopg.connect(config.database_url()) as conn:
        with conn.cursor() as cur:
            rule = set_enabled(cur, args.rule, enable, getattr(args, "mode", None))
            if not enable:
                closed = close_rule_edges(cur, rule)
                record_run(cur, RuleResult(rule.id, "disabled", closed=closed), "manual",
                           current_revisions(cur))
        conn.commit()
    if enable:
        print(f"{rule.id}: zapnuté ({rule.mode}). Hrany vzniknú pri ďalšom `run`.")
    else:
        print(f"{rule.id}: vypnuté, uzavreté hrany {closed}.")


def cmd_spatial_reference(args) -> None:
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
    if args.inside_only:
        cfg.include_partial = False

    res = spatial_reference.derive(models, cfg)
    _print_derive_summary(res, names)

    if args.report:
        Path(args.report).parent.mkdir(parents=True, exist_ok=True)
        with open(args.report, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["element_guid", "element_type", "element_name", "space_guid", "space_name",
                        "space_long_name", "role"])
            for e in res.edges:
                ne, ns = names.get(e.from_guid, ("?",) * 3), names.get(e.to_guid, ("?",) * 3)
                w.writerow([e.from_guid, ne[0], ne[1], e.to_guid, ns[1], ns[2], e.role])
            for g, t in res.unmatched:
                w.writerow([g, t, names.get(g, ("?",) * 3)[1], "", "", "", "unmatched"])
        print(f"Report: {args.report}")

    if args.dry_run:
        print("--dry-run → do DB sa nezapisuje.")
        return

    import psycopg

    from .db import write_edges

    source = "derive:spatial_reference"
    with psycopg.connect(config.database_url()) as conn:
        with conn.cursor() as cur:
            st = write_edges(cur, source, spatial_reference.REL_TYPE, res.edges)
        conn.commit()
    print(f"DB: zapísané {st.written}, uzavreté zastarané {st.closed}, "
          f"GUID mimo DB {len(st.unresolved_guids)}, nepovolený object_type {len(st.disallowed)}")


if __name__ == "__main__":
    main()
