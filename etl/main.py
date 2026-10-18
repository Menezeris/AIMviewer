"""ETL CLI (D-031) — IFC → Supabase.

Spustenie z koreňa repa:
    python -m etl.main --file etl/data/model.ifc            # zapíše do DB
    python -m etl.main --file etl/data/model.ifc --dry-run  # len zhrnutie, bez DB
"""

from __future__ import annotations

import argparse
import re
import sys
from typing import Optional, Sequence

from . import config, extract, transform
from .db import fetch_existing_floors, load_model
from .model import StagedModel


def main(argv: Optional[Sequence[str]] = None) -> None:
    # Windows konzola býva cp1250 — diakritika v coverage reporte by inak padla
    # na UnicodeEncodeError (rovnaký guard ako doc_upload/pdf_link/pdf_annotate).
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="AIM ETL — IFC → Supabase (D-031)")
    parser.add_argument("--file", required=True, help="cesta k IFC súboru")
    parser.add_argument(
        "--dry-run", action="store_true", help="nepíš do DB, len zhrnutie + vzorka"
    )
    parser.add_argument(
        "--reset", action="store_true",
        help="pred loadom vyprázdni AIM dáta (nahradenie seedu reálnymi dátami, E2)",
    )
    parser.add_argument(
        "--federate", action="store_true",
        help="disciplinárny model (VZT) napojiť na existujúcu štruktúru — bez emitu "
             "spatial koreňov, prvky na existujúce podlažia (D-049). Nekombinovať s --reset.",
    )
    parser.add_argument(
        "--model", metavar="MENO",
        help="meno modelu federácie (ASR, VZT; D-086): hrany a GUID história dostanú zdroj "
             "modelu a čo tento beh už nevydal (zmazané/presunuté prvky), sa uzavrie.",
    )
    args = parser.parse_args(argv)

    if args.federate and args.reset:
        raise SystemExit("--federate a --reset sa vylučujú: federate pridáva do už "
                         "naloženej štruktúry, reset by ju zmazal (D-049).")

    model = extract.open_model(args.file)
    print(f"IFC schéma: {extract.schema_version(model)}")

    # Federate (D-049): dotiahni existujúce podlažia z DB pre mapovanie VZT storeyov.
    # Pri dry-rune bez DB → None (ref sa odvodí z np_key, zhoduje sa s floor konvenciou).
    existing_floors = None
    if args.federate and not args.dry_run:
        existing_floors = fetch_existing_floors(config.database_url())
        print(f"Federate → {len(existing_floors)} existujúcich podlaží z DB.")

    staged = transform.to_staged(model, federate=args.federate, existing_floors=existing_floors)
    print(f"Staged: {staged.summary()}")
    _print_unlinked(staged)

    if args.dry_run:
        print("--dry-run → do DB sa nezapisuje.")
        _print_sample(staged)
        if staged.coverage is not None:
            _print_coverage(staged.coverage)
        return

    url = config.database_url()
    if args.reset:
        print("--reset → AIM dáta sa pred loadom vyprázdnia (nahradenie seedu).")
    closed = load_model(url, staged, reset=args.reset, scope=args.model)
    if args.model:
        print(f"Model {args.model}: uzavreté zastarané hrany {closed['edges']}, "
              f"GUID záznamy {closed['guids']} (D-086).")
    print("Hotovo — zapísané do Supabase.")


_SNIM_REF = re.compile(r"^[A-Z]{2}\d{2}(?:\.\d+)+$")  # napr. DD01.06 / DD01.06.03


def _print_unlinked(staged: StagedModel) -> None:
    unlinked = staged.coverage.unlinked if staged.coverage else {}
    if unlinked:
        detail = ", ".join(f"{cls} {n}" for cls, n in sorted(unlinked.items(), key=lambda kv: -kv[1]))
        print(f"Vynechané väzby dokumentov/aktorov na neemitované entity: {detail}")


def _print_sample(staged: StagedModel) -> None:
    print("\nVzorka SNIM uzlov (object_ref zo schémy, D-033):")
    shown = 0
    for o in staged.objects:
        if o.object_type in ("asset", "asset_type") and _SNIM_REF.match(o.object_ref):
            name = (o.name or "")[:40]
            print(f"  {o.object_type:11} {o.object_ref:14} {o.ifc_type:16} {name}")
            shown += 1
        if shown >= 14:
            break
    if shown == 0:
        for o in staged.objects[:12]:
            print(f"  {o.object_type:11} {o.object_ref:28} {o.name or ''}")


def _print_coverage(cov) -> None:
    """Coverage report (D-033) — pokrytie `object_ref` SNIM kódom vs. fallback.
    Nie je to IDS/conformance (E6) — len extrakcia: čo dostalo kód a čo nie."""
    total = cov.assets_total or 1
    no_code = cov.assets_fallback.get("bez SNIM kódu (žiadny Assembly Code)", 0)
    coded = cov.assets_total - no_code

    def pct(n: int, d: int) -> str:
        return f"{(100.0 * n / d):.1f}%" if d else "—"

    print("\n" + "=" * 64)
    print("COVERAGE — object_ref / SNIM (D-033, len extrakcia, NIE IDS)")
    print("=" * 64)
    print(f"Prvky (asset, bez otvorov):           {cov.assets_total}")
    print(f"  platný inštančný SNIM kód:          {cov.assets_snim:5}  "
          f"({pct(cov.assets_snim, total)} zo všetkých)")
    print(f"  z prvkov so SNIM dátami:            {cov.assets_snim:5}/{coded}  "
          f"({pct(cov.assets_snim, coded)})  [prvky s 'Assembly Code']")
    print(f"  fallback na ifc_guid:               {cov.assets_total - cov.assets_snim}")
    for reason, n in sorted(cov.assets_fallback.items(), key=lambda kv: -kv[1]):
        print(f"      {n:5}  {reason}")

    if cov.by_category:
        print("\nSNIM inštančné kódy podľa kategórie:")
        for cat, n in sorted(cov.by_category.items(), key=lambda kv: -kv[1]):
            print(f"      {n:5}  {cat}")

    print("\nasset_type (typové SNIM kódy z occurrence):")
    print(f"      {cov.types_snim} zdieľaných kódov z {cov.types_total} IFC typov "
          f"({cov.types_merged} zlúčených)")

    undefined = {k: v for k, v in cov.undefined_tsp.items() if "@" not in k}
    misplaced = {k: v for k, v in cov.undefined_tsp.items() if "@" in k}
    if undefined:
        print("\nSNIM kód prítomný, kategória NIE je v scheme.py (doplniť):")
        for tsp, n in sorted(undefined.items(), key=lambda kv: -kv[1]):
            print(f"      {n:5}  TSP {tsp}")
    if misplaced:
        print("\nKód na nečakanej IFC triede (mimo applies_to — skontrolovať model/schému):")
        for key, n in sorted(misplaced.items(), key=lambda kv: -kv[1]):
            print(f"      {n:5}  {key}")
    if cov.collisions:
        print(f"\nKolízie SNIM kódu (duplicitný Mark, druhý → GUID): {len(cov.collisions)}")
        for code in sorted(set(cov.collisions)):
            print(f"      {code}")

    print("\nTriedy/psety s fallbackom (kde kód chýba alebo je mimo schémy):")
    for cls, n in sorted(cov.fallback_classes.items(), key=lambda kv: -kv[1])[:12]:
        print(f"      {n:5}  {cls}")
    print("=" * 64)


if __name__ == "__main__":
    main()
