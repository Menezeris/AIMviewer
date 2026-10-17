"""Kontrola modelu voči IDS z knižnice požiadaviek (D-081).

IDS sa sem nekopíruje — vyrába ho knižnica (assetin-library). Krok ho prečíta,
overí model cez ifctester (referenčná implementácia IDS) a výsledok (špecifikácia ×
prvok, pass/fail + dôvody) zapíše do `ids_runs` / `ids_results`.

    python -m etl.ids_check --ids ../assetin-library/tests/fixtures/ids/ER-0101_ARCH.ids \\
        --model podklady/FINAL/ASR.ifc --label ASR --dry-run --report out/ids.csv
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Sequence

IDS_NS = "{http://standards.buildingsmart.org/IDS}"
NO_APPLICABLE = "Model neobsahuje žiadny prvok, na ktorý sa povinná špecifikácia vzťahuje."
PROHIBITED = "Prvok je podľa špecifikácie zakázaný."


@dataclass
class ResultRow:
    spec_identifier: Optional[str]
    spec_name: str
    spec_description: Optional[str]
    spec_instructions: Optional[str]
    ifc_guid: Optional[str]
    ifc_type: Optional[str]
    status: str  # pass | fail
    reasons: list[str] = field(default_factory=list)


@dataclass
class CheckResult:
    ids_title: str
    ids_version: Optional[str]
    ids_sha256: str
    rows: list[ResultRow] = field(default_factory=list)
    specs_total: int = 0
    specs_passed: int = 0


def _spec_identifiers(path: Path) -> list[Optional[str]]:
    """`identifier` špecifikácií v poradí súboru (ifctester ho nečíta vo všetkých verziách)."""
    root = ET.parse(path).getroot()
    return [s.get("identifier") for s in root.iter(f"{IDS_NS}specification")]


def check(ids_path: Path, model) -> CheckResult:
    import ifctester.ids

    data = ids_path.read_bytes()
    ids = ifctester.ids.open(str(ids_path))
    ids.validate(model)
    idents = _spec_identifiers(ids_path)
    info = ids.info or {}
    res = CheckResult(
        ids_title=info.get("title") or ids_path.stem,
        ids_version=info.get("version"),
        ids_sha256=hashlib.sha256(data).hexdigest(),
        specs_total=len(ids.specifications),
    )
    for i, spec in enumerate(ids.specifications):
        ident = getattr(spec, "identifier", None) or (idents[i] if i < len(idents) else None)
        if spec.status:
            res.specs_passed += 1
        base = dict(
            spec_identifier=ident,
            spec_name=spec.name,
            spec_description=getattr(spec, "description", None),
            spec_instructions=getattr(spec, "instructions", None),
        )
        reasons: dict[int, list[str]] = {}
        for req in spec.requirements or []:
            label = req.to_string("requirement")
            for f in getattr(req, "failures", None) or []:
                el = f["element"] if isinstance(f, dict) else f.element
                why = f.get("reason") if isinstance(f, dict) else getattr(f, "reason", None)
                reasons.setdefault(el.id(), []).append(f"{label}: {why}" if why else label)
        failed = {e.id() for e in getattr(spec, "failed_entities", None) or []}
        applicable = list(spec.applicable_entities or [])
        if not applicable:
            min_occurs = spec.minOccurs if spec.minOccurs is not None else 0
            if int(min_occurs) >= 1:
                res.rows.append(ResultRow(**base, ifc_guid=None, ifc_type=None, status="fail",
                                          reasons=[NO_APPLICABLE]))
            continue
        prohibited = str(spec.maxOccurs) == "0"
        for el in applicable:
            bad = el.id() in failed or el.id() in reasons or prohibited
            why = reasons.get(el.id(), [PROHIBITED] if prohibited else [])
            res.rows.append(ResultRow(**base, ifc_guid=getattr(el, "GlobalId", None), ifc_type=el.is_a(),
                                      status="fail" if bad else "pass", reasons=why if bad else []))
    return res


def write_run(cur, res: CheckResult, *, model_label: str, model_file: str,
              ids_source: Optional[str]) -> tuple[str, int]:
    """Zapíše jeden beh. Vráti (run_id, počet výsledkov bez prvku v DB)."""
    guids = sorted({r.ifc_guid for r in res.rows if r.ifc_guid})
    rows = cur.execute(
        "select ifc_guid, object_id from ifc_guid_history "
        "where valid_until is null and ifc_guid = any(%s)",
        (guids,),
    ).fetchall()
    by_guid = {g: oid for g, oid in rows}
    failed = sum(1 for r in res.rows if r.status == "fail")
    run_id = cur.execute(
        """
        insert into ids_runs (ids_title, ids_version, ids_sha256, ids_source, model_label,
          model_file, specs_total, specs_passed, results_total, results_failed)
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id
        """,
        (res.ids_title, res.ids_version, res.ids_sha256, ids_source, model_label, model_file,
         res.specs_total, res.specs_passed, len(res.rows), failed),
    ).fetchone()[0]
    missing = 0
    for r in res.rows:
        oid = by_guid.get(r.ifc_guid) if r.ifc_guid else None
        if r.ifc_guid and oid is None:
            missing += 1
        cur.execute(
            """
            insert into ids_results (run_id, spec_identifier, spec_name, spec_description,
              spec_instructions, object_id, ifc_guid, ifc_type, status, reasons)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (run_id, r.spec_identifier, r.spec_name, r.spec_description, r.spec_instructions,
             oid, r.ifc_guid, r.ifc_type, r.status, r.reasons),
        )
    return str(run_id), missing


def main(argv: Optional[Sequence[str]] = None) -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    p = argparse.ArgumentParser(description="AIM ETL — kontrola modelu voči IDS (D-081)")
    p.add_argument("--ids", required=True, help="IDS súbor z knižnice požiadaviek")
    p.add_argument("--model", required=True, help="IFC súbor")
    p.add_argument("--label", required=True, help="označenie modelu federácie (ASR, VZT…)")
    p.add_argument("--source", help="pôvod IDS (napr. assetin-library@<commit>:<cesta>)")
    p.add_argument("--dry-run", action="store_true", help="nepíš do DB")
    p.add_argument("--report", help="CSV s výsledkami")
    args = p.parse_args(argv)

    from . import config, extract

    model = extract.open_model(args.model)
    res = check(Path(args.ids), model)
    print(f"IDS: {res.ids_title} v{res.ids_version or '?'} ({res.ids_sha256[:12]}) × {args.label}")
    by_spec: dict[tuple, list[ResultRow]] = {}
    for r in res.rows:
        by_spec.setdefault((r.spec_identifier, r.spec_name), []).append(r)
    for (ident, name), rows in by_spec.items():
        bad = [r for r in rows if r.status == "fail"]
        tag = "FAIL" if bad else "PASS"
        print(f"  {tag} {ident or '-':12s} {name[:48]:48s} {len(rows) - len(bad)}/{len(rows)}"
              + (f"  napr.: {bad[0].reasons[0][:90]}" if bad and bad[0].reasons else ""))
    print(f"Špecifikácie splnené: {res.specs_passed}/{res.specs_total}")

    if args.report:
        Path(args.report).parent.mkdir(parents=True, exist_ok=True)
        with open(args.report, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["spec_identifier", "spec_name", "ifc_guid", "ifc_type", "status", "reasons"])
            for r in res.rows:
                w.writerow([r.spec_identifier, r.spec_name, r.ifc_guid, r.ifc_type, r.status, " | ".join(r.reasons)])
        print(f"Report: {args.report}")

    if args.dry_run:
        print("--dry-run → do DB sa nezapisuje.")
        return

    import psycopg

    with psycopg.connect(config.database_url()) as conn:
        with conn.cursor() as cur:
            run_id, missing = write_run(cur, res, model_label=args.label, model_file=Path(args.model).name,
                                        ids_source=args.source)
        conn.commit()
    print(f"DB: beh {run_id}, výsledkov {len(res.rows)}, prvok mimo DB {missing}")


if __name__ == "__main__":
    main()
