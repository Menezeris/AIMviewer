"""IFC pset definitions manifest (D-061) - static dictionary of standard psets.

Mirrors the pattern of `etl/manifest.py` (D-051): curated input + validation against
the IFC schema via `ifcopenshell`, deterministic `--sql` output committed into a
migration. Here the input is the **list of IFC classes present in the project** and
the output is the definitions of their standard psets (`Pset_`/`Qto_`) from the
bSDD/psd templates that `ifcopenshell` ships built in
(`ifcopenshell.util.pset.PsetQto`).

Purpose: LLM grounding of MEANING - description, data type (PrimaryMeasureType),
enum values and applicable classes of the standard properties. Complements
`v_property_dictionary` (D-058), which says what actually IS in the data (including
custom psets - a static schema cannot know those by design).

The class list is a curated default (`DEFAULT_CLASSES` - classes of the demo model
ARCH+VZT + planned ÚK/ZTI import). After the data in the DB changes, regenerate:

    python -m etl.pset_manifest --classes-from-db   # classes from objects.ifc_type
    python -m etl.pset_manifest --sql               # INSERT SQL (into a NEW migration)
    python -m etl.pset_manifest --check             # validation + summary

Determinism: output sorted by (pset, property); same input = same SQL.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Iterable, Optional

# Target IFC schema - aligned with the relationships manifest (D-046: IFC4.3 vocabulary).
IFC_SCHEMA = "IFC4X3"

# Max length of description in the dictionary (full texts needlessly bloat the
# migration and the LLM context; truncation is lossless for the grounding purpose).
DESCRIPTION_MAX = 200

# Curated class list of the demo project (Office centrum Brno: ARCH + VZT models,
# D-049) + classes of the planned water model (ÚK/ZTI - valve use case D-056).
# Regeneration from real data: --classes-from-db.
DEFAULT_CLASSES: list[str] = [
    # spatial structure
    "IfcSite", "IfcBuilding", "IfcBuildingStorey", "IfcSpace",
    # ARCH
    "IfcDoor", "IfcWindow", "IfcWall", "IfcSlab", "IfcColumn", "IfcBeam",
    "IfcStair", "IfcRailing", "IfcRoof", "IfcCovering", "IfcCurtainWall",
    # VZT
    "IfcUnitaryEquipment", "IfcFan", "IfcAirTerminal", "IfcDuctSegment",
    "IfcDuctFitting", "IfcDistributionSystem",
    # ÚK/ZTI (import planned - D-056 valve query)
    "IfcPipeSegment", "IfcPipeFitting", "IfcValve", "IfcPump",
]


@dataclass
class PropertyDef:
    """One standard property in the dictionary (a row of `ifc_property_definitions`)."""

    pset: str
    property: str
    data_type: Optional[str]        # PrimaryMeasureType (IfcLabel, IfcAreaMeasure...)
    template_type: Optional[str]    # P_SINGLEVALUE | P_ENUMERATEDVALUE | Q_LENGTH...
    enum_values: list[str]          # for P_ENUMERATEDVALUE the PEnum_* values
    description: Optional[str]
    applicable_classes: list[str]   # ONLY classes from the input list (not all of IFC)


def classes_from_db() -> list[str]:
    """Distinct `objects.ifc_type` from the DB (both occurrence and type classes)."""
    import psycopg

    from . import config

    with psycopg.connect(config.database_url()) as conn:
        rows = conn.execute(
            "select distinct ifc_type from objects where ifc_type is not null order by 1"
        ).fetchall()
    return [r[0] for r in rows]


def _norm_occurrence_class(name: str) -> str:
    """`IfcDoorType` -> `IfcDoor` - templates apply to both occurrence and Type
    (ApplicableEntity is usually 'IfcDoor,IfcDoorType'); the dictionary is kept on occurrence."""
    return name[:-4] if name.endswith("Type") and len(name) > 7 else name


def build_definitions(
    classes: Iterable[str], schema_name: str = IFC_SCHEMA
) -> tuple[list[PropertyDef], list[str]]:
    """Return (definitions sorted by (pset, property), classes without templates).

    A class without templates (typo / not in the schema / has no psets) does NOT
    crash - it is reported (warn in --check), so the manifest does not silently
    drift from the data.
    """
    from ifcopenshell.util.pset import PsetQto

    qto = PsetQto(schema_name)
    wanted = sorted({_norm_occurrence_class(c) for c in classes})

    by_key: dict[tuple[str, str], PropertyDef] = {}
    missing: list[str] = []
    for cls in wanted:
        try:
            templates = qto.get_applicable(cls)
        except Exception:  # noqa: BLE001 - an unknown class must not crash generation
            templates = []
        if not templates:
            missing.append(cls)
            continue
        for tpl in templates:
            for pt in tpl.HasPropertyTemplates or []:
                key = (tpl.Name, pt.Name)
                entry = by_key.get(key)
                if entry is None:
                    enums: list[str] = []
                    enumerators = getattr(pt, "Enumerators", None)
                    if enumerators is not None:
                        # values are IfcLabel instances -> unwrap to a plain string
                        enums = [
                            str(getattr(v, "wrappedValue", v))
                            for v in enumerators.EnumerationValues or []
                        ]
                    desc = (getattr(pt, "Description", None) or "").strip() or None
                    if desc and len(desc) > DESCRIPTION_MAX:
                        desc = desc[: DESCRIPTION_MAX - 1] + "…"
                    entry = PropertyDef(
                        pset=tpl.Name,
                        property=pt.Name,
                        data_type=getattr(pt, "PrimaryMeasureType", None),
                        template_type=str(getattr(pt, "TemplateType", None) or "") or None,
                        enum_values=enums,
                        description=desc,
                        applicable_classes=[],
                    )
                    by_key[key] = entry
                if cls not in entry.applicable_classes:
                    entry.applicable_classes.append(cls)

    defs = sorted(by_key.values(), key=lambda d: (d.pset, d.property))
    for d in defs:
        d.applicable_classes.sort()
    return defs, missing


def _sql_str(val: Optional[str]) -> str:
    if val is None:
        return "null"
    return "'" + val.replace("'", "''") + "'"


def _sql_array(items: list[str]) -> str:
    if not items:
        return "array[]::text[]"
    return "array[" + ", ".join(_sql_str(x) for x in items) + "]"


def sql_inserts(classes: Iterable[str], schema_name: str = IFC_SCHEMA) -> str:
    """`insert into ifc_property_definitions ...` for a migration (deterministic)."""
    defs, missing = build_definitions(classes, schema_name)
    lines: list[str] = []
    if missing:
        lines.append(f"-- POZOR: triedy bez šablón v {schema_name}: {', '.join(missing)}")
    lines += [
        "insert into ifc_property_definitions",
        "  (pset, property, data_type, template_type, enum_values, description, applicable_classes)",
        "values",
    ]
    body = [
        "  ("
        f"{_sql_str(d.pset)}, {_sql_str(d.property)}, {_sql_str(d.data_type)}, "
        f"{_sql_str(d.template_type)}, {_sql_array(d.enum_values)}, "
        f"{_sql_str(d.description)}, {_sql_array(d.applicable_classes)}"
        ")"
        for d in defs
    ]
    return "\n".join(lines) + "\n" + ",\n".join(body) + ";\n"


def main() -> None:
    ap = argparse.ArgumentParser(description="Manifest IFC pset definícií (D-061)")
    ap.add_argument("--sql", action="store_true", help="vypíš INSERT SQL do ifc_property_definitions")
    ap.add_argument("--check", action="store_true", help="len validácia + súhrn")
    ap.add_argument(
        "--classes-from-db",
        action="store_true",
        help="zoznam tried z DB (objects.ifc_type) namiesto DEFAULT_CLASSES",
    )
    ap.add_argument("--classes", help="explicitný zoznam tried oddelený čiarkou")
    ap.add_argument("--schema", default=IFC_SCHEMA, help=f"IFC schéma (default {IFC_SCHEMA})")
    args = ap.parse_args()

    if args.classes:
        classes = [c.strip() for c in args.classes.split(",") if c.strip()]
    elif args.classes_from_db:
        classes = classes_from_db()
    else:
        classes = DEFAULT_CLASSES

    if args.sql:
        print(sql_inserts(classes, args.schema), end="")
        return

    # default = check
    defs, missing = build_definitions(classes, args.schema)
    psets = sorted({d.pset for d in defs})
    print(
        f"OK — {len(defs)} properties v {len(psets)} psetoch "
        f"pre {len(classes)} tried ({args.schema})."
    )
    if missing:
        print(f"WARN — triedy bez šablón: {', '.join(missing)}")
    enum_count = sum(1 for d in defs if d.enum_values)
    print(f"     P_ENUMERATEDVALUE s hodnotami: {enum_count}")


if __name__ == "__main__":
    main()
