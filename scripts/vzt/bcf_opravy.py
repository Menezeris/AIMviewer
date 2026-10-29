"""Opravy modelu VZT podľa BCF tém #14, #15 a #17 (#13 bez zmeny modelu).

Hodnoty nie sú v kóde, ale v `bcf_opravy.json` so stavom každej položky:
`dolozene` (zdroj v modeli alebo dokumente) a `potvrdene` (schválil Samuel) sa aplikujú
vždy, `navrh` len s `--vratane-navrhov` (náhľad pred schválením), `chyba_hodnota` nikdy.
GlobalId prvkov sa nemenia; skript nič nepridáva ani neodoberá okrem materiálov, psetov
a vzťahov (IfcMaterial, IfcPropertySet, IfcRel*), ktoré poistka D-086 nesleduje.

Použitie (z koreňa repa, vstup = archív aktuálnej revízie rozbalený lokálne):
    python scripts/vzt/bcf_opravy.py --vstup VZT_v010.ifc --vystup VZT_v011.ifc \\
        --zmeny zmeny_v011.json [--vratane-navrhov] [--temy 14,15,17]

Výstup `--zmeny` je zoznam zmien pre `python -m etl.model_publish publish --changes`.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import re
import sys
from pathlib import Path
from typing import Any, Optional

import ifcopenshell
import ifcopenshell.api
import ifcopenshell.util.element as E
import ifcopenshell.util.placement as P
import ifcopenshell.util.system as SY

CONFIG = Path(__file__).with_name("bcf_opravy.json")
APPLIED = {"dolozene", "potvrdene"}
UNNAMED = "<Unnamed>"
FLOOR_ORDER = {"1NP": 1, "2NP": 2, "3NP": 3, "4NP": 4}


class Zmeny:
    """Zoznam zmien vo formáte D-086 (`etl/README.md`, zmeny.json)."""

    def __init__(self) -> None:
        self.items: list[dict[str, Any]] = []
        self.skipped: list[str] = []

    def add(self, el, bcf: str, what: str, before: Any, after: Any) -> None:
        if before == after:
            return
        self.items.append({
            "guid": el.GlobalId, "ifc_class": el.is_a(), "op": "modify", "bcf": f"#{bcf}",
            "what": what, "before": before, "after": after,
        })

    def skip(self, msg: str) -> None:
        self.skipped.append(msg)


def ok(item: Optional[dict], navrhy: bool) -> bool:
    if not item:
        return False
    st = item.get("status")
    return st in APPLIED or (navrhy and st == "navrh")


def pset_value(el, pset: str, prop: str) -> Any:
    return (E.get_psets(el, psets_only=True).get(pset) or {}).get(prop)


def set_pset(f, el, pset: str, props: dict[str, Any]) -> None:
    """Zapíše vlastnosti do psetu na prvku (nie zdedeného z typu); pset vytvorí, ak chýba."""
    own = None
    for rel in getattr(el, "IsDefinedBy", None) or []:
        if rel.is_a("IfcRelDefinesByProperties") and rel.RelatingPropertyDefinition.Name == pset:
            own = rel.RelatingPropertyDefinition
    if el.is_a("IfcTypeObject"):
        own = next((p for p in el.HasPropertySets or [] if p.Name == pset), None)
    if own is None:
        own = ifcopenshell.api.run("pset.add_pset", f, product=el, name=pset)
    ifcopenshell.api.run("pset.edit_pset", f, pset=own, properties=props)


def storey(el) -> str:
    c = E.get_container(el)
    return c.Name if c else ""


def systems(el) -> list[str]:
    return [s.Name for s in SY.get_element_systems(el)]


# ── #14 koncový prvok bez označenia a s nulovým prietokom ─────────────────────

def tema_14(f, cfg: dict, navrhy: bool, z: Zmeny) -> None:
    el = f.by_guid(cfg["global_id"])
    typ = E.get_type(el)
    if ok(cfg.get("name"), navrhy):
        z.add(el, "14", "Name", el.Name, cfg["name"]["value"])
        el.Name = cfg["name"]["value"]
    else:
        z.skip("#14 Name: návrh čaká na schválenie")
    if typ is not None and ok(cfg.get("type_name"), navrhy):
        z.add(typ, "14", "Name (typ)", typ.Name, cfg["type_name"]["value"])
        typ.Name = cfg["type_name"]["value"]
    if ok(cfg.get("description"), navrhy):
        z.add(el, "14", "Description", el.Description, cfg["description"]["value"])
        el.Description = cfg["description"]["value"]
    pt = cfg.get("predefined_type")
    if ok(pt, navrhy):
        for target, label in ((el, "ObjectType"), (typ, "ElementType")):
            if target is None:
                continue
            z.add(target, "14", "PredefinedType", target.PredefinedType, pt["value"])
            target.PredefinedType = pt["value"]
            if pt["value"] == "USERDEFINED":
                z.add(target, "14", label, getattr(target, label), pt["object_type"])
                setattr(target, label, pt["object_type"])
    else:
        z.skip("#14 PredefinedType: návrh čaká na schválenie")
    flow = cfg.get("air_flow_rate_m3h")
    props: dict[str, Any] = {}
    if ok(flow, navrhy):
        props["AirFlowRate"] = flow["value"] / 3600.0          # súbor má m3/s (IfcDerivedUnit)
    else:
        z.skip("#14 AirFlowRate: návrh čaká na schválenie")
    if ok(cfg.get("air_flow_type"), navrhy):
        props["AirFlowType"] = cfg["air_flow_type"]["value"]
    for k, v in props.items():
        z.add(el, "14", f"Pset_AirTerminalOccurrence.{k}", pset_value(el, "Pset_AirTerminalOccurrence", k), v)
    if props:
        set_pset(f, el, "Pset_AirTerminalOccurrence", props)


# ── #15 materiály ─────────────────────────────────────────────────────────────

def _type_matches(typ, patterns: list[str]) -> bool:
    key = f"{typ.is_a()}:{typ.Name or ''}"
    return any(fnmatch.fnmatchcase(key, p) for p in patterns)


def _material_name(el) -> Optional[str]:
    m = E.get_material(el, should_skip_usage=True, should_inherit=False)
    return getattr(m, "Name", None) if m is not None else None


def tema_15(f, cfg: dict, navrhy: bool, z: Zmeny) -> None:
    unnamed = [m for m in f.by_type("IfcMaterial") if m.Name == UNNAMED]
    types = [t for t in f.by_type("IfcTypeObject") if t.is_a("IfcElementType")]
    done: set[int] = set()
    materials: dict[str, Any] = {}
    for spec in cfg["materials"]:
        if not ok(spec, navrhy):
            z.skip(f"#15 materiál '{spec['name']}' pre {spec['types']}: {spec['status']}")
            continue
        mat = materials.get(spec["name"])
        if mat is None:
            mat = ifcopenshell.api.run("material.add_material", f, name=spec["name"], category=spec["category"])
            mat.Description = spec.get("description")
            materials[spec["name"]] = mat
        targets = [t for t in types if t.id() not in done and _type_matches(t, spec["types"])]
        for typ in targets:
            done.add(typ.id())
            # Materiál patrí na typ (D-021); výskyt ho zdedí, vlastné '<Unnamed>' sa z neho zruší.
            for el in [typ, *E.get_types(typ)]:
                before = _material_name(el)
                if el.is_a("IfcTypeObject") or before is not None:
                    z.add(el, "15", "Material", before, spec["name"] if el.is_a("IfcTypeObject") else f"(z typu) {spec['name']}")
                if before is not None:
                    ifcopenshell.api.run("material.unassign_material", f, products=[el])
            ifcopenshell.api.run("material.assign_material", f, products=[typ], material=mat)
    rest = cfg.get("unnamed") or {}
    if ok(rest, navrhy) and rest.get("action") == "remove":
        for m in unnamed:
            for rel in list(f.get_inverse(m)):
                if rel.is_a("IfcRelAssociatesMaterial"):
                    for el in rel.RelatedObjects:
                        z.add(el, "15", "Material", UNNAMED, None)
                    ifcopenshell.api.run("material.unassign_material", f, products=list(rel.RelatedObjects))
            if not f.get_inverse(m):
                f.remove(m)
    elif unnamed and any(f.get_inverse(m) for m in unnamed):
        z.skip("#15 '<Unnamed>' ostáva na prvkoch bez potvrdeného materiálu")


# ── #17 klapky: označenie, PredefinedType, štandardné psety ──────────────────

def _sort_key(el) -> tuple:
    sy = systems(el)
    kind = 0 if any(s.startswith("Prívod") for s in sy) else 1
    x, y = P.get_local_placement(el.ObjectPlacement)[:2, 3]
    return (FLOOR_ORDER.get(storey(el), 9), kind, round(float(x)), round(float(y)), el.GlobalId)


def tema_17(f, cfg: dict, navrhy: bool, z: Zmeny) -> None:
    naming = ok(cfg.get("naming"), navrhy)
    if not naming:
        z.skip("#17 kódy a Name klapiek: návrh čaká na schválenie")
    for typ in f.by_type("IfcDamperType"):
        spec = cfg["types"].get(typ.Name)
        if spec is None:
            z.skip(f"#17 typ {typ.Name}: nie je v konfigurácii")
            continue
        occ = sorted(E.get_types(typ), key=_sort_key)
        if ok(cfg.get("element_size"), navrhy):
            for k, v in spec["element_size_mm"].items():
                z.add(typ, "17", f"Pset_ElementSize.{k}", pset_value(typ, "Pset_ElementSize", k), v)
            set_pset(f, typ, "Pset_ElementSize", spec["element_size_mm"])
        if naming:
            code = spec["code"]
            z.add(typ, "17", "Pset_DamperTypeCommon.Reference", pset_value(typ, "Pset_DamperTypeCommon", "Reference"), code)
            set_pset(f, typ, "Pset_DamperTypeCommon", {"Reference": code})
            z.add(typ, "17", "Name (typ)", typ.Name, code)
            typ.Name = code
        if typ.PredefinedType != spec["predefined_type"]:
            z.add(typ, "17", "PredefinedType (typ)", typ.PredefinedType, spec["predefined_type"])
            typ.PredefinedType = spec["predefined_type"]
        for seq, el in enumerate(occ, start=1):
            if naming:
                name = f"{spec['code']}.{seq:03d}"
                # Stena požiarneho úseku je dnes len v texte (Description, Funkcia z v005), nesmie sa stratiť.
                src = f"{el.Description or ''} {pset_value(el, 'AIM_VZT_ProjektoveHodnoty', 'Funkcia') or ''}"
                wall = re.search(r"požiarneho úseku (\S+?)[\s,)]", src)
                desc = spec["popis"].format(system=", ".join(systems(el)), stena=wall.group(1) if wall else "?")
                if "{stena}" in spec["popis"] and not wall:
                    z.skip(f"#17 {el.GlobalId}: stena požiarneho úseku sa v popise nenašla")
                z.add(el, "17", "Name", el.Name, name)
                z.add(el, "17", "Description", el.Description, desc)
                el.Name, el.Description = name, desc
                z.add(el, "17", "AIM_VZT_ProjektoveHodnoty.Oznacenie",
                      pset_value(el, "AIM_VZT_ProjektoveHodnoty", "Oznacenie"), name)
                set_pset(f, el, "AIM_VZT_ProjektoveHodnoty", {"Oznacenie": name})
            if ok(cfg.get("predefined_type_on_occurrence"), navrhy) and el.PredefinedType != spec["predefined_type"]:
                z.add(el, "17", "PredefinedType", el.PredefinedType, spec["predefined_type"])
                el.PredefinedType = spec["predefined_type"]
            if ok(cfg.get("aim_pset_cleanup"), navrhy):
                for k in ("Funkcia", "Ovladanie"):
                    before = pset_value(el, "AIM_VZT_ProjektoveHodnoty", k)
                    if before is not None:
                        z.add(el, "17", f"AIM_VZT_ProjektoveHodnoty.{k}", before, None)
                        set_pset(f, el, "AIM_VZT_ProjektoveHodnoty", {k: None})
        for pset, values in (cfg.get("optional_psets") or {}).items():
            applies = {"Pset_DamperTypeFireDamper": "FIREDAMPER", "Pset_DamperTypeControlDamper": "CONTROLDAMPER"}[pset]
            if typ.PredefinedType != applies:
                continue
            props = {k: v for k, v in values.items() if k != "status" and v is not None}
            if ok(values, navrhy) and props:
                for k, v in props.items():
                    z.add(typ, "17", f"{pset}.{k}", pset_value(typ, pset, k), v)
                set_pset(f, typ, pset, props)
            else:
                z.skip(f"#17 {pset} na {typ.Name}: {values.get('status')}")


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--vstup", required=True, type=Path)
    ap.add_argument("--vystup", required=True, type=Path)
    ap.add_argument("--zmeny", required=True, type=Path)
    ap.add_argument("--config", type=Path, default=CONFIG)
    ap.add_argument("--temy", default="14,15,17")
    ap.add_argument("--vratane-navrhov", action="store_true", help="aplikovať aj položky so stavom navrh")
    args = ap.parse_args(argv)

    cfg = json.loads(args.config.read_text(encoding="utf-8"))
    f = ifcopenshell.open(str(args.vstup))
    guids_before = {e.GlobalId for e in f.by_type("IfcRoot")}
    z = Zmeny()
    temy = {t.strip() for t in args.temy.split(",") if t.strip()}
    for num, fn in (("14", tema_14), ("15", tema_15), ("17", tema_17)):
        if num in temy:
            fn(f, cfg["bcf"][num], args.vratane_navrhov, z)

    lost = {g for g in guids_before if g} - {e.GlobalId for e in f.by_type("IfcRoot")}
    lost_objects = [g for g in lost if g in {e.GlobalId for e in f.by_type("IfcObjectDefinition")}]
    if lost_objects:
        print(f"CHYBA: zmizli objekty {lost_objects[:10]}", file=sys.stderr)
        return 2
    f.write(str(args.vystup))
    base = cfg.get("base_revision")
    summary = "VZT: " + ", ".join(
        {"14": "#14 výfukový nástavec 4NP", "15": "#15 materiály", "17": "#17 klapky označenie a psety"}[t]
        for t in sorted(temy)
    )
    doc = {
        "summary": summary + (" (NÁHĽAD s návrhmi, nepublikovať)" if args.vratane_navrhov else ""),
        "base_revision": base,
        "recipe": "Menezeris/AIMviewer: scripts/vzt/bcf_opravy.py",
        "bcf": sorted(f"#{t}" for t in temy),
        "skipped": z.skipped,
        "changes": z.items,
    }
    args.zmeny.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    per = {}
    for c in z.items:
        per[c["bcf"]] = per.get(c["bcf"], 0) + 1
    print(f"zmeny: {len(z.items)} {per}; vynechané: {len(z.skipped)}")
    for s in z.skipped:
        print("  -", s)
    return 0


if __name__ == "__main__":
    sys.exit(main())
