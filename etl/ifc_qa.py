"""IFC QA - quality check of the source model before the ETL (read-only).

Findings from the scan of `Office centrum Brno - ASR.ifc` (2026-06-22) promoted to a repeatable
report. It is not IDS/conformance (that is E6) - it is **authoring QA**: run this script before and
after a re-export from Revit and compare whether the findings were fixed.

    python -m etl.ifc_qa --file "podklady/.../Office centrum Brno - ASR.ifc"

Each check prints a status:
  PASS  - fine
  WARN  - recommended to fix (not blocking for the ETL)
  FAIL  - wrong, fix it in the source

The script changes NOTHING (it opens the IFC read-only).
"""

from __future__ import annotations

import argparse
import re
from collections import Counter
from typing import Any, Optional, Sequence

import ifcopenshell
import ifcopenshell.util.element as ue

# Revit default `Name` = "Family:Type:ElementId" -> the ":<number>" tail is a volatile Revit ID.
_REVIT_ID_TAIL = re.compile(r":\d+(?::\d+)?$")
# A "real" storey (not an auxiliary Revit level 1NP_SH_ZD / Spadova vrstva / Dojazd_...).
_REAL_FLOOR = re.compile(r"^\d+NP$")
# A real Uniformat code: letter A-G + digits (A1010, B2010...). A SNIM code is `DD02`, `SN11`.
_UNIFORMAT = re.compile(r"^[A-G]\d")
# Placeholder values that Revit/the template leaves unfilled.
_PLACEHOLDERS = {"default", "", "[názov projektu]", "[název projektu]", "nnnn/nn/nnn"}
# Psets that are usually empty noise (reinforcement on architecture, environmental on everything).
_NOISE_PSETS = (
    "Pset_EnvironmentalImpactIndicators",
    "Pset_ReinforcementBarPitchOfWall",
    "Pset_ReinforcementBarPitchOfSlab",
    "Pset_ReinforcementBarPitchOfColumn",
)


def _attr(e: Any, name: str) -> Any:
    return getattr(e, name, None)


def _status(ok: bool, warn_only: bool = False) -> str:
    if ok:
        return "PASS"
    return "WARN" if warn_only else "FAIL"


def _line(status: str, title: str, detail: str = "") -> None:
    print(f"  [{status:4}] {title}" + (f"  — {detail}" if detail else ""))


# ── individual checks ─────────────────────────────────────────────────────────


def check_names(m: ifcopenshell.file) -> None:
    print("\n# 1. Názvy prvkov (Name)")
    els = m.by_type("IfcElement")
    id_tail = [e for e in els if e.Name and _REVIT_ID_TAIL.search(e.Name)]
    _line(
        _status(not id_tail),
        "Name bez Revit ':ElementId' chvosta",
        f"{len(id_tail)}/{len(els)} má volatilný ':<id>' (napr. 'Basic Wall:Stena:959298')",
    )
    # Name identical to the type name = no human/instance override.
    same_as_type = 0
    for e in els:
        t = ue.get_type(e)
        tn = _attr(t, "Name") if t else None
        if e.Name and tn and e.Name == tn:
            same_as_type += 1
    if same_as_type:
        _line("WARN", "Name = Type.Name (žiadny inštančný popis)", f"{same_as_type} prvkov")


def check_spatial_names(m: ifcopenshell.file) -> None:
    print("\n# 2. Hlavičkové entity (Project / Site / Building)")
    for cls in ("IfcProject", "IfcSite", "IfcBuilding"):
        for e in m.by_type(cls):
            name = (e.Name or "").strip()
            ok = name.lower() not in _PLACEHOLDERS
            long_name = (_attr(e, "LongName") or "").strip()
            ln_ok = long_name.lower() not in _PLACEHOLDERS or not long_name
            _line(
                _status(ok and ln_ok, warn_only=True),
                f"{cls}",
                f"Name={e.Name!r} LongName={_attr(e, 'LongName')!r}",
            )


def check_storeys(m: ifcopenshell.file) -> None:
    print("\n# 3. Podlažia (IfcBuildingStorey)")
    storeys = m.by_type("IfcBuildingStorey")
    aux = [s for s in storeys if not _REAL_FLOOR.match(_attr(s, "Name") or "")]
    _line(
        _status(not aux, warn_only=True),
        "Len reálne podlažia označené ako Building Story",
        f"{len(storeys)} celkom, {len(aux)} pomocných úrovní",
    )
    for s in aux:
        print(f"           pomocná: {_attr(s, 'Name')!r}  (Elev={_attr(s, 'Elevation')})")


def check_classification(m: ifcopenshell.file) -> None:
    print("\n# 4. Klasifikácia")
    systems = m.by_type("IfcClassification")
    for c in systems:
        _line("PASS", "IfcClassification", f"Name={c.Name!r} Source={_attr(c, 'Source')!r}")
    # SNIM codes under the 'Uniformat' header = a wrongly named system.
    miscoded: Counter = Counter()
    for cr in m.by_type("IfcClassificationReference"):
        ident = _attr(cr, "Identification") or _attr(cr, "ItemReference")
        src = _attr(cr, "ReferencedSource")
        sys_name = (_attr(src, "Name") if src else None) or ""
        if ident and "uniformat" in sys_name.lower() and not _UNIFORMAT.match(str(ident)):
            miscoded[str(ident)] += 1
    if miscoded:
        sample = ", ".join(sorted(miscoded)[:8])
        _line(
            "FAIL",
            "Kódy pod 'Uniformat' nie sú Uniformat (sú to SNIM kódy)",
            f"{len(miscoded)} kódov, napr. {sample} → premenovať systém na SNIM",
        )
    # Classification on openings (IfcOpeningElement) = wrong.
    on_openings = 0
    for r in m.by_type("IfcRelAssociatesClassification"):
        on_openings += sum(1 for o in (r.RelatedObjects or []) if o.is_a("IfcOpeningElement"))
    if on_openings:
        _line("WARN", "Klasifikácia na IfcOpeningElement (otvory)", f"{on_openings}×")


def check_psets(m: ifcopenshell.file) -> None:
    print("\n# 5. Property sety")
    types = m.by_type("IfcTypeObject")
    types_with_psets = sum(1 for t in types if ue.get_psets(t, should_inherit=False))
    _line(
        _status(types_with_psets > 0, warn_only=True),
        "Typy nesú property sety (zdieľané info na type, nie na occurrence)",
        f"{types_with_psets}/{len(types)} typov má pset",
    )
    noise: Counter = Counter()
    for e in m.by_type("IfcElement"):
        for pn in (ue.get_psets(e, should_inherit=False) or {}):
            if pn in _NOISE_PSETS:
                noise[pn] += 1
    for pn, n in noise.most_common():
        _line("WARN", f"Šumový pset prítomný: {pn}", f"{n}× (overiť, či nie je prázdny)")


def run(path: str) -> None:
    m = ifcopenshell.open(path)
    print("=" * 72)
    print(f"IFC QA  —  {path}")
    print(f"schéma: {m.schema}   IfcElement: {len(m.by_type('IfcElement'))}")
    print("=" * 72)
    check_names(m)
    check_spatial_names(m)
    check_storeys(m)
    check_classification(m)
    check_psets(m)
    print("\n" + "=" * 72)
    print("Hotovo. FAIL/WARN = kandidáti na opravu v zdroji (Revit) + re-export.")
    print("=" * 72)


def main(argv: Optional[Sequence[str]] = None) -> None:
    p = argparse.ArgumentParser(description="IFC QA — kontrola kvality zdroja (read-only)")
    p.add_argument("--file", required=True, help="cesta k IFC súboru")
    run(p.parse_args(argv).file)


if __name__ == "__main__":
    main()
