"""Overenie modelu VZT po úprave (BCF #13 až #17): IDS, porty klapiek, schéma IFC.

    python scripts/vzt/kontrola.py --ifc VZT_v011.ifc [--ids scripts/vzt/bcf_opravy.ids] [--bez-schemy]

- IDS (`bcf_opravy.ids`) cez ifctester: verdikt každej špecifikácie, počty pass/fail.
- #13: každý port každej IfcDamper je spojený cez IfcRelConnectsPorts.
- schéma: `ifcopenshell.validate` (atribúty, typy, WHERE pravidlá); vypíše počet chýb podľa
  správy. Porovnávaj so základom: chyby, ktoré mal už základ, úprava nespôsobila.
Kód 0 = všetko prešlo, 1 = niečo neprešlo.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections import Counter
from pathlib import Path
from typing import Optional

import ifcopenshell
import ifcopenshell.util.system as SY

IDS = Path(__file__).with_name("bcf_opravy.ids")


def check_ids(f: ifcopenshell.file, ids_path: Path) -> bool:
    from ifctester import ids as ids_mod

    spec = ids_mod.open(str(ids_path))
    spec.validate(f)
    ok = True
    for s in spec.specifications:
        passed = len(s.passed_entities)
        failed = len(s.failed_entities)
        verdict = "OK" if s.status else "NEPREŠLO"
        ok &= bool(s.status)
        print(f"IDS {verdict}: pass {passed}, fail {failed} - {s.name}")
        for e in list(s.failed_entities)[:5]:
            print(f"    fail {e.is_a()} {e.GlobalId} {e.Name}")
    return ok


def check_damper_ports(f: ifcopenshell.file) -> bool:
    bad = []
    dampers = f.by_type("IfcDamper")
    for d in dampers:
        ports = SY.get_ports(d)
        if not ports:
            bad.append((d.GlobalId, d.Name, "bez portov"))
        for p in ports:
            if SY.get_connected_port(p) is None:
                bad.append((d.GlobalId, d.Name, p.Name))
    print(f"#13 porty klapiek: {len(dampers)} klapiek, nenapojené {len(bad)}")
    for b in bad:
        print("    ", *b)
    return not bad


def check_schema(f: ifcopenshell.file) -> int:
    import ifcopenshell.validate as V

    logger = V.json_logger()
    V.validate(f, logger, express_rules=False)
    msgs = Counter(str(s.get("message", ""))[:120] for s in logger.statements)
    print(f"schéma: {len(logger.statements)} hlásení")
    for m, n in msgs.most_common(10):
        print(f"    {n}x {m}")
    return len(logger.statements)


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ifc", required=True, type=Path)
    ap.add_argument("--ids", type=Path, default=IDS)
    ap.add_argument("--bez-schemy", action="store_true")
    args = ap.parse_args(argv)
    logging.disable(logging.WARNING)
    f = ifcopenshell.open(str(args.ifc))
    ok = check_ids(f, args.ids)
    ok &= check_damper_ports(f)
    if not args.bez_schemy:
        check_schema(f)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
