"""Manifest vzťahov (D-051) — jeden zdroj pravdy o `rel_type` typoch.

Meta-model vzťahov B: namiesto per-vzťah tabuliek `rel_*` žije jedna generická
tabuľka `relationships` (diskriminátor `rel_type`) + kanonické views per typ.
Tento modul drží **kurátorovaný zoznam** našich `rel_type` s ich sémantikou a
**overuje ho proti IFC schéme** cez `ifcopenshell` (IFC-first, D-046):

- `ifc_entity` musí v schéme existovať a byť podtypom `IfcRelationship`
  (→ `is_ifc_rel=True`, serializuje sa na `IfcRel*`), alebo je to **resource**
  (napr. `IfcPersonAndOrganization` pri `rel_member_of` — poctivo mimo IfcRel
  taxonómie, D-048) → `is_ifc_rel=False`.
- `ifc_family` (napr. `IfcRelDecomposes`) sa **odvodí** zo supertypu tesne pod
  `IfcRelationship`.
- `relating_attr` (napr. `RelatingObject`) musí byť atribút entity — potvrdzuje,
  ktorá strana je IFC `Relating` (`relating_end` = náš `from`/`to` koniec).

Výstupy:
- `build_manifest()` → validovaný zoznam `RelType` (obohatený zo schémy),
- `sql_inserts()`   → `insert into relationship_types …` (spotrebuje migrácia F1),
- `EDGE_TYPE_TO_REL_TYPE` → mapovanie interného ETL `edge_type` → `rel_type`
  (routing pre `etl/db.py`).

Spustenie:
    python -m etl.manifest --sql     # vypíše INSERT SQL (do migrácie)
    python -m etl.manifest --check   # len validácia proti IFC schéme
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from typing import Optional

# Cieľová IFC schéma (D-046: IFC4.3 slovník teraz). Federované modely sú IFC4X3_ADD2,
# meta-model vzťahov je naprieč ADD* rovnaký → validujeme proti IFC4X3.
IFC_SCHEMA = "IFC4X3"


@dataclass
class RelType:
    """Jeden `rel_type` v manifeste (D-051).

    `ifc_entity`/`ifc_family`/`is_ifc_rel` sa dopĺňajú/overujú zo schémy v
    `build_manifest()`; ostatné polia sú kurátorované (naša sémantika, ktorú IFC
    nekóduje: mapovanie na `object_type`, namespace, export cesta, constraints).
    """

    rel_type: str
    # IFC kotva (validované proti schéme)
    ifc_entity: Optional[str]                 # None = čisto naše (aim_*, dnes žiadne)
    relating_attr: Optional[str]              # napr. 'RelatingObject' (None pre resource bez Relating)
    relating_end: str                         # 'from' | 'to' — ktorý náš koniec je IFC Relating
    # naša sémantika (IFC nekóduje)
    from_object_types: list[str]
    to_object_types: list[str]                # prázdne keď to_is_classification
    to_is_classification: bool = False
    namespace: str = "rel"                    # 'rel' (IFC-kanonické) | 'aim' (naše rozšírenie)
    export_path: str = "ifcrel"               # 'ifcrel' | 'resource' | 'icdd' | 'ifcx'
    unique_active_from: bool = False          # unique-active-parent (1 aktívny rodič na from_id)
    description: str = ""
    # dopočítané zo schémy (build_manifest)
    ifc_family: Optional[str] = None
    is_ifc_rel: bool = False


# =============================================================================
# Kurátorovaný manifest — dnešná sada hrán (D-048), presunutá do dát (D-051).
# Názvy `rel_type` = názvy dnešných tabuliek `rel_*` → kanonické views ich
# zachovajú (bezvýpadkový cutover, čítacia vrstva sa nemení).
# =============================================================================
_SPECS: list[RelType] = [
    RelType(
        rel_type="rel_aggregates",
        ifc_entity="IfcRelAggregates",
        relating_attr="RelatingObject",       # = celok (parent) = náš to_id
        relating_end="to",
        # spatial child; site → project, časti priestorovej zóny a podskupiny (D-088)
        from_object_types=["site", "building", "floor", "space", "spatial_zone", "group"],
        to_object_types=["project", "site", "building", "floor", "spatial_zone", "group"],
        unique_active_from=True,
        description="Dekompozícia Project→Site→Building→Floor→Space (D-013), časti "
                    "priestorovej zóny a skupiny (D-088).",
    ),
    RelType(
        rel_type="rel_contained_in_spatial_structure",
        ifc_entity="IfcRelContainedInSpatialStructure",
        relating_attr="RelatingStructure",    # = štruktúra (space/floor) = náš to_id
        relating_end="to",
        from_object_types=["asset", "spatial_zone"],   # fyzický prvok, priestorová zóna (D-088)
        to_object_types=["floor", "space"],    # priestor/podlažie
        unique_active_from=True,
        description="Fyzický prvok (asset) alebo priestorová zóna v priestorovej štruktúre.",
    ),
    RelType(
        rel_type="rel_referenced_in_spatial_structure",
        ifc_entity="IfcRelReferencedInSpatialStructure",
        relating_attr="RelatingStructure",    # = štruktúra (space/floor) = náš to_id
        relating_end="to",
        from_object_types=["asset", "space", "spatial_zone"],
        to_object_types=["space", "floor", "building", "site", "spatial_zone"],
        description="Prvok sa nachádza (aj) v priestorovej štruktúre — neexkluzívne; "
                    "odvodené geometriou naprieč federáciou (D-080) alebo zo súboru, "
                    "napr. priestor v priestorovej zóne (D-088).",
    ),
    RelType(
        rel_type="rel_defines_by_type",
        ifc_entity="IfcRelDefinesByType",
        relating_attr="RelatingType",          # = type = náš to_id
        relating_end="to",
        from_object_types=["asset"],           # occurrence
        to_object_types=["asset_type"],        # type
        unique_active_from=True,
        description="Type–occurrence dedičnosť (D-021).",
    ),
    RelType(
        rel_type="rel_associates_document",
        ifc_entity="IfcRelAssociatesDocument",
        relating_attr="RelatingDocument",      # = dokument = náš to_id
        relating_end="to",
        from_object_types=["project", "site", "building", "floor", "space", "asset",
                           "asset_type", "zone", "spatial_zone", "group"],
        to_object_types=["document", "document_reference"],
        description="Väzba objekt → dokument (D-014) alebo jeho časť (IfcDocumentReference, "
                    "D-101); role='drawing' pre E4.",
    ),
    RelType(
        rel_type="rel_associates_classification",
        ifc_entity="IfcRelAssociatesClassification",
        relating_attr="RelatingClassification",  # = klasifikačná referencia = náš to_id
        relating_end="to",
        from_object_types=["asset", "asset_type"],
        to_object_types=[],                      # výnimka: to_id → classification_references
        to_is_classification=True,
        description="Klasifikácia na type aj occurrence (D-023). to_id → classification_references.",
    ),
    RelType(
        rel_type="rel_assigns_to_actor",
        ifc_entity="IfcRelAssignsToActor",
        relating_attr="RelatingActor",         # = aktor = náš from_id
        relating_end="from",
        from_object_types=["person", "organization"],
        to_object_types=["project", "site", "building", "floor", "space", "asset", "asset_type",
                         "document", "zone", "spatial_zone", "group"],
        description="Zodpovednosti (D-020); role = acting rola.",
    ),
    RelType(
        rel_type="rel_assigns_to_group",
        ifc_entity="IfcRelAssignsToGroup",
        relating_attr="RelatingGroup",         # = group/system = náš to_id
        relating_end="to",
        from_object_types=["asset", "space", "zone", "spatial_zone"],   # člen
        to_object_types=["system", "zone", "group"],   # IfcDistributionSystem (D-047), IfcZone, IfcGroup (D-088)
        description="Členstvo v systéme (D-047), zóne alebo skupine (D-088).",
    ),
    RelType(
        rel_type="rel_member_of",
        ifc_entity="IfcPersonAndOrganization",  # resource, NIE IfcRel (D-048)
        relating_attr=None,                     # resource nemá Relating/Related
        relating_end="from",                    # konvencia: person = subjekt
        from_object_types=["person"],
        to_object_types=["organization"],
        export_path="resource",
        description="Osoba v organizácii (D-024) — IFC resource, nie IfcRel.",
    ),
    RelType(
        rel_type="rel_document_information_relationship",
        ifc_entity="IfcDocumentInformationRelationship",  # resource, NIE IfcRel (D-101)
        relating_attr="RelatingDocument",      # = nadradený dokument = náš to_id
        relating_end="to",
        from_object_types=["document"],        # časť (RelatedDocuments)
        to_object_types=["document"],
        export_path="resource",
        description="Strom dokumentácie (D-101): časť → nadradený dokument; "
                    "role = RelationshipType (napr. SUBDOCUMENT). IFC resource, nie IfcRel.",
    ),
]

# Interné ETL `edge_type` (model.py / db.py) → kanonický `rel_type` (D-051).
EDGE_TYPE_TO_REL_TYPE: dict[str, str] = {
    "aggregates": "rel_aggregates",
    "contained": "rel_contained_in_spatial_structure",
    "defined_by_type": "rel_defines_by_type",
    "member_of": "rel_member_of",
    "has_document": "rel_associates_document",
    "responsible_for": "rel_assigns_to_actor",
    "assigns_to_group": "rel_assigns_to_group",
    "referenced": "rel_referenced_in_spatial_structure",
    "has_classification": "rel_associates_classification",
    "document_part": "rel_document_information_relationship",
}


def _ifc_family(decl) -> Optional[str]:
    """Rodina vzťahu = supertyp tesne pod `IfcRelationship` (napr. IfcRelDecomposes)."""
    s = decl.supertype()
    while s is not None:
        parent = s.supertype()
        if parent is not None and parent.name() == "IfcRelationship":
            return s.name()
        s = parent
    return None


def _is_subtype_of(decl, ancestor: str) -> bool:
    s = decl
    while s is not None:
        if s.name() == ancestor:
            return True
        s = s.supertype()
    return False


def build_manifest(schema_name: str = IFC_SCHEMA) -> list[RelType]:
    """Vráti kurátorovaný manifest obohatený a **overený** proti IFC schéme.

    Vyhodí `ValueError`, ak IFC kotva nesedí (entita chýba, nie je IfcRelationship
    keď má byť, alebo deklarovaný `relating_attr` v entite neexistuje) — IFC-first
    guard (D-046): manifest sa nesmie rozísť s ontológiou.
    """
    from ifcopenshell import ifcopenshell_wrapper as w

    try:
        schema = w.schema_by_name(schema_name)
    except RuntimeError:
        # ifcopenshell ≥0.9 nesie IFC4.3 len ako IFC4X3_ADD2 (meta-model vzťahov je rovnaký).
        schema = w.schema_by_name(f"{schema_name}_ADD2")
    out: list[RelType] = []
    for spec in _SPECS:
        if spec.ifc_entity is None:
            out.append(spec)  # čisto naše (aim_*) — dnes žiadne
            continue
        try:
            decl = schema.declaration_by_name(spec.ifc_entity)
        except Exception as exc:  # noqa: BLE001
            raise ValueError(
                f"{spec.rel_type}: IFC entita '{spec.ifc_entity}' v {schema_name} neexistuje ({exc})"
            ) from exc

        is_rel = _is_subtype_of(decl, "IfcRelationship")
        attrs = {a.name() for a in decl.all_attributes()}
        if spec.relating_attr is not None and spec.relating_attr not in attrs:
            raise ValueError(
                f"{spec.rel_type}: '{spec.ifc_entity}' nemá atribút '{spec.relating_attr}' "
                f"(dostupné: {sorted(attrs)})"
            )

        spec.is_ifc_rel = is_rel
        spec.ifc_family = _ifc_family(decl) if is_rel else None
        out.append(spec)
    return out


def _sql_array(items: list[str]) -> str:
    if not items:
        return "array[]::text[]"
    inner = ", ".join(f"'{x}'" for x in items)
    return f"array[{inner}]"


def _sql_str(val: Optional[str]) -> str:
    if val is None:
        return "null"
    return "'" + val.replace("'", "''") + "'"


def sql_inserts(schema_name: str = IFC_SCHEMA) -> str:
    """Vygeneruje `insert into relationship_types …` pre migráciu F1.

    Deterministický výstup (stabilné poradie) — commituje sa do migrácie ako dáta,
    tento modul ostáva regeneračný/validačný nástroj (jeden zdroj pravdy).
    """
    rows = build_manifest(schema_name)
    lines = [
        "insert into relationship_types",
        "  (rel_type, ifc_entity, ifc_family, is_ifc_rel, relating_end,",
        "   from_object_types, to_object_types, to_is_classification,",
        "   namespace, export_path, unique_active_from, description)",
        "values",
    ]
    body = []
    for r in rows:
        body.append(
            "  ("
            f"{_sql_str(r.rel_type)}, {_sql_str(r.ifc_entity)}, {_sql_str(r.ifc_family)}, "
            f"{'true' if r.is_ifc_rel else 'false'}, {_sql_str(r.relating_end)}, "
            f"{_sql_array(r.from_object_types)}, {_sql_array(r.to_object_types)}, "
            f"{'true' if r.to_is_classification else 'false'}, "
            f"{_sql_str(r.namespace)}, {_sql_str(r.export_path)}, "
            f"{'true' if r.unique_active_from else 'false'}, {_sql_str(r.description)}"
            ")"
        )
    return "\n".join(lines) + "\n" + ",\n".join(body) + ";\n"


def main() -> None:
    ap = argparse.ArgumentParser(description="Manifest vzťahov (D-051)")
    ap.add_argument("--sql", action="store_true", help="vypíš INSERT SQL do relationship_types")
    ap.add_argument("--check", action="store_true", help="len validácia proti IFC schéme")
    ap.add_argument("--schema", default=IFC_SCHEMA, help=f"IFC schéma (default {IFC_SCHEMA})")
    args = ap.parse_args()

    if args.sql:
        print(sql_inserts(args.schema), end="")
        return
    # default = check
    manifest = build_manifest(args.schema)
    print(f"OK — {len(manifest)} rel_type overených proti {args.schema}:")
    for r in manifest:
        kind = f"{r.ifc_entity} ({r.ifc_family})" if r.is_ifc_rel else f"{r.ifc_entity or '—'} [resource]"
        print(f"  {r.rel_type:<38} relating={r.relating_end:<4} {kind}")


if __name__ == "__main__":
    main()
