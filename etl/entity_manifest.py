"""Entity manifest `entity_types` (D-195): every entity of IFC 4.3 as data.

The relationship manifest (`etl/manifest.py`, D-051) covers our `rel_type` values. This module covers the
entities: one row per IFC 4.3 entity (876), built from the machine schema in ifcopenshell (`IFC4X3_ADD2`),
with the class tree (supertype, ancestors), abstract, IfcRoot or not, stored as a node or not, and the
entity's own explicit attributes (enum values inline). The schema layer and package come from the pinned
schema submodule (`vendor/ifc4.3`, fetched by `scripts/ifc-schema/fetch.sh`), which is also the cross-check:
the entity files there must be exactly the ifcopenshell entities.

No text from the schema docs goes into the table (CC BY-ND 4.0, D-195); tools read the files by path:
`vendor/ifc4.3/docs/schemas/<schema_layer>/<schema_package>/Entities/<ifc_class>.md`.

The output is a whole migration, checked in. Usage, from the repo root:
    python -m etl.entity_manifest --write   # (re)write the migration file
    python -m etl.entity_manifest --check   # regenerate and compare; exit 1 on drift
    python -m etl.entity_manifest --stats   # counts and spot checks
"""

from __future__ import annotations

import argparse
import difflib
import json
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

IFC_SCHEMA = "IFC4X3_ADD2"
ROOT = Path(__file__).resolve().parent.parent
SUBMODULE = "vendor/ifc4.3"
MIGRATION = ROOT / "supabase" / "migrations" / "20261105130000_entity_types.sql"

# Resource entities with identity stored as nodes in `objects` (plan 7.3 point 1, R1). They are not IfcRoot
# subtypes; export returns them as resource entities.
RESOURCE_NODES: tuple[str, ...] = (
    "IfcApproval",
    "IfcDocumentInformation",
    "IfcDocumentReference",
    "IfcMetric",
    "IfcObjective",
    "IfcOrganization",
    "IfcPerson",
)
NODE_ROOT = "IfcObjectDefinition"


@dataclass
class Entity:
    ifc_class: str
    supertype: Optional[str]
    ancestors: list[str]                  # root first, without the class itself
    is_abstract: bool
    is_root: bool
    is_node: bool
    schema_layer: str
    schema_package: str
    attributes: list[dict[str, Any]] = field(default_factory=list)


def _schema():
    from ifcopenshell import ifcopenshell_wrapper as w

    return w.schema_by_name(IFC_SCHEMA)


def _type_info(t) -> dict[str, Any]:
    """Type of an attribute: {type, kind, enum?}; aggregates as 'LIST [1:?] OF IfcLabel'."""
    agg = t.as_aggregation_type()
    if agg is not None:
        inner = _type_info(agg.type_of_element())
        ub = agg.bound2()
        bounds = f"[{agg.bound1()}:{'?' if ub < 0 else ub}]"
        out = {"type": f"{agg.type_of_aggregation_string().upper()} {bounds} OF {inner['type']}",
               "kind": inner["kind"], "aggregate": True}
        if "enum" in inner:
            out["enum"] = inner["enum"]
        return out
    named = t.as_named_type()
    if named is not None:
        decl = named.declared_type()
        if decl.as_entity() is not None:
            return {"type": decl.name(), "kind": "entity"}
        enum = decl.as_enumeration_type()
        if enum is not None:
            return {"type": decl.name(), "kind": "enum", "enum": list(enum.enumeration_items())}
        if decl.as_select_type() is not None:
            return {"type": decl.name(), "kind": "select"}
        return {"type": decl.name(), "kind": "type"}
    simple = t.as_simple_type()
    if simple is not None:
        return {"type": simple.declared_type().upper(), "kind": "simple"}
    return {"type": str(t), "kind": "other"}


def _attributes(decl) -> list[dict[str, Any]]:
    out = []
    for a in decl.attributes():          # own explicit attributes, in schema order
        info = _type_info(a.type_of_attribute())
        row: dict[str, Any] = {"name": a.name(), "type": info["type"], "kind": info["kind"],
                               "optional": bool(a.optional())}
        if info.get("aggregate"):
            row["aggregate"] = True
        if "enum" in info:
            row["enum"] = info["enum"]
        out.append(row)
    return out


def schema_paths(root: Path = ROOT) -> dict[str, tuple[str, str]]:
    """ifc_class -> (layer, package) from the entity files of the pinned submodule."""
    base = root / SUBMODULE / "docs" / "schemas"
    if not base.is_dir():
        raise SystemExit(
            f"entity_manifest: {SUBMODULE} is not fetched; run: bash scripts/ifc-schema/fetch.sh"
        )
    out: dict[str, tuple[str, str]] = {}
    for p in base.glob("*/*/Entities/*.md"):
        layer, package = p.parts[-4], p.parts[-3]
        if p.stem in out:
            raise SystemExit(f"entity_manifest: {p.stem} appears twice in {SUBMODULE}")
        out[p.stem] = (layer, package)
    return out


def source_commit(root: Path = ROOT) -> str:
    """The submodule commit recorded in the superproject (not the checkout, which may lag)."""
    out = subprocess.run(["git", "ls-tree", "HEAD", SUBMODULE], cwd=root, capture_output=True,
                         text=True, check=True).stdout.split()
    if len(out) < 3 or out[1] != "commit":
        raise SystemExit(f"entity_manifest: no submodule commit recorded for {SUBMODULE}")
    return out[2]


def checkout_commit(root: Path = ROOT) -> Optional[str]:
    r = subprocess.run(["git", "-C", str(root / SUBMODULE), "rev-parse", "HEAD"],
                       capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None


def build(root: Path = ROOT) -> list[Entity]:
    schema = _schema()
    paths = schema_paths(root)
    decls = sorted((d.as_entity() for d in schema.declarations() if d.as_entity() is not None),
                   key=lambda e: e.name())
    names = {e.name() for e in decls}
    if names != set(paths):
        only_ios = sorted(names - set(paths))
        only_docs = sorted(set(paths) - names)
        raise SystemExit(f"entity_manifest: {IFC_SCHEMA} and {SUBMODULE} differ: "
                         f"only in ifcopenshell {only_ios[:10]}, only in the docs {only_docs[:10]}")
    missing = [c for c in RESOURCE_NODES if c not in names]
    if missing:
        raise SystemExit(f"entity_manifest: resource node classes not in the schema: {missing}")

    out = []
    for e in decls:
        chain = []
        s = e.supertype()
        while s is not None:
            chain.append(s.name())
            s = s.supertype()
        ancestors = list(reversed(chain))
        lineage = set(ancestors) | {e.name()}
        layer, package = paths[e.name()]
        out.append(Entity(
            ifc_class=e.name(),
            supertype=chain[0] if chain else None,
            ancestors=ancestors,
            is_abstract=bool(e.is_abstract()),
            is_root="IfcRoot" in lineage,
            is_node=NODE_ROOT in lineage or e.name() in RESOURCE_NODES,
            schema_layer=layer,
            schema_package=package,
            attributes=_attributes(e),
        ))
    return out


# --------------------------------------------------------------------------------------------- SQL

def _s(v: Optional[str]) -> str:
    return "null" if v is None else "'" + v.replace("'", "''") + "'"


def _arr(items: list[str]) -> str:
    return "array[]::text[]" if not items else "array[" + ", ".join(_s(x) for x in items) + "]"


def _b(v: bool) -> str:
    return "true" if v else "false"


HEADER = """\
-- D-195: entity manifest entity_types, every entity of IFC 4.3 as data (platform step 4).
-- GENERATED by `python -m etl.entity_manifest --write`; do not edit by hand. CI and pytest regenerate it and
-- fail on drift (`--check`). Source: ifcopenshell {schema}; schema layer and package from the pinned
-- submodule {submodule} at {commit} (buildingSMART/IFC4.3.x-development, CC BY-ND 4.0; no text copied).
--
-- Global table (no project_id, like relationship_types). Only creates and fills the new table and adds two
-- read-only functions; no existing table, view or function changes.

create table entity_types (
  ifc_class      text primary key,                 -- IFC entity name as in the schema, e.g. IfcDoor
  supertype      text references entity_types (ifc_class) deferrable initially deferred,
  ancestors      text[] not null,                  -- supertypes, root first, without the class itself
  is_abstract    boolean not null,
  is_root        boolean not null,                 -- IfcRoot subtype (has GlobalId)
  is_node        boolean not null,                 -- stored as a node in objects (7.3 point 1, R1)
  schema_layer   text not null,                    -- core | shared | domain | resource
  schema_package text not null,                    -- e.g. IfcKernel; docs: <layer>/<package>/Entities/<class>.md
  attributes     jsonb not null,                   -- own explicit attributes in schema order (name, type, kind, optional, aggregate?, enum?)
  schema_version text not null,
  source_commit  text not null,
  source         text not null default 'ifcopenshell',
  check (supertype is null or ancestors[cardinality(ancestors)] = supertype)
);

comment on table entity_types is
  'D-195: every IFC 4.3 entity; generated by etl/entity_manifest.py. is_node = stored in objects.';

alter table entity_types enable row level security;
revoke all on entity_types from anon, authenticated;

"""

FOOTER = """
-- True when child is ancestor or one of its subtypes (R9 categories, R10 relationship validation).
create or replace function entity_is_a(p_child text, p_ancestor text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from entity_types e
    where e.ifc_class = p_child
      and (e.ifc_class = p_ancestor or p_ancestor = any (e.ancestors))
  );
$$;

-- Keys of properties._attributes that the class (with its supertypes) does not declare (D-195). A report,
-- not a check: nothing is rejected. Keys starting with '_' are meta keys and are skipped. Unknown class =
-- every key is returned.
create or replace function entity_attributes_unknown_keys(p_ifc_class text, p_attributes jsonb)
returns text[]
language sql
stable
set search_path = public
as $$
  with known as (
    select a ->> 'name' as name
    from entity_types e
    cross join lateral jsonb_array_elements(e.attributes) a
    where e.ifc_class = p_ifc_class
       or e.ifc_class = any (coalesce((select ancestors from entity_types where ifc_class = p_ifc_class),
                                      array[]::text[]))
  )
  select coalesce(array_agg(k order by k), array[]::text[])
  from jsonb_object_keys(case when jsonb_typeof(p_attributes) = 'object' then p_attributes
                              else '{}'::jsonb end) k
  where left(k, 1) <> '_' and k not in (select name from known);
$$;

revoke all on function entity_is_a(text, text) from public, anon, authenticated;
revoke all on function entity_attributes_unknown_keys(text, jsonb) from public, anon, authenticated;

analyze entity_types;
"""


def render(root: Path = ROOT) -> str:
    rows = build(root)
    commit = source_commit(root)
    lines = [HEADER.format(schema=IFC_SCHEMA, submodule=SUBMODULE, commit=commit[:7]),
             "insert into entity_types",
             "  (ifc_class, supertype, ancestors, is_abstract, is_root, is_node, schema_layer, schema_package,",
             "   attributes, schema_version, source_commit)",
             "values"]
    body = []
    for r in rows:
        attrs = json.dumps(r.attributes, separators=(",", ":"), ensure_ascii=True)
        body.append(
            f"  ({_s(r.ifc_class)}, {_s(r.supertype)}, {_arr(r.ancestors)}, {_b(r.is_abstract)}, "
            f"{_b(r.is_root)}, {_b(r.is_node)}, {_s(r.schema_layer)}, {_s(r.schema_package)},\n"
            f"   {_s(attrs)}::jsonb, {_s(IFC_SCHEMA)}, {_s(commit)})"
        )
    return "\n".join(lines) + "\n" + ",\n".join(body) + ";\n" + FOOTER


def stats(rows: list[Entity]) -> dict[str, Any]:
    by = {r.ifc_class: r for r in rows}
    spots = {}
    for c in ("IfcApproval", "IfcTask", "IfcActionRequest", "IfcEvent", "IfcSpace", "IfcDoor"):
        r = by[c]
        spots[c] = {"supertypes": " > ".join(reversed(r.ancestors)) or "-", "is_root": r.is_root,
                    "is_node": r.is_node, "is_abstract": r.is_abstract}
    return {
        "total": len(rows),
        "abstract": sum(r.is_abstract for r in rows),
        "is_root": sum(r.is_root for r in rows),
        "is_node": sum(r.is_node for r in rows),
        "is_node_not_root": sorted(r.ifc_class for r in rows if r.is_node and not r.is_root),
        "spot_checks": spots,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Entity manifest entity_types (D-195)")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--write", action="store_true", help="write the migration file")
    g.add_argument("--check", action="store_true", help="regenerate and compare (default)")
    g.add_argument("--stats", action="store_true", help="counts and spot checks")
    args = ap.parse_args()

    co = checkout_commit()
    if co and co != source_commit():
        print(f"entity_manifest: {SUBMODULE} checkout {co[:7]} is not the recorded commit "
              f"{source_commit()[:7]}; run: bash scripts/ifc-schema/fetch.sh", file=sys.stderr)
        sys.exit(2)

    if args.stats:
        print(json.dumps(stats(build()), indent=2))
        return
    sql = render()
    if args.write:
        MIGRATION.write_text(sql, encoding="utf-8")
        print(f"wrote {MIGRATION.relative_to(ROOT)} ({len(sql.splitlines())} lines)")
        return
    current = MIGRATION.read_text(encoding="utf-8") if MIGRATION.exists() else ""
    if current != sql:
        diff = difflib.unified_diff(current.splitlines(), sql.splitlines(), "checked in", "generated",
                                    lineterm="", n=1)
        print("entity_manifest: drift between the migration and the schema:", file=sys.stderr)
        for i, line in enumerate(diff):
            if i >= 40:
                print("...", file=sys.stderr)
                break
            print(line, file=sys.stderr)
        sys.exit(1)
    print(f"OK - {MIGRATION.relative_to(ROOT)} matches {IFC_SCHEMA} and {SUBMODULE}")


if __name__ == "__main__":
    main()
