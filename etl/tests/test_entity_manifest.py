"""Entity manifest entity_types (D-195): the checked-in migration equals the generator output.

Needs ifcopenshell and the pinned schema submodule (`bash scripts/ifc-schema/fetch.sh`); without the
submodule the drift test is skipped here, CI runs it (`ifc-manifest` job).
"""

from __future__ import annotations

import pytest

pytest.importorskip("ifcopenshell")

from etl import entity_manifest as em  # noqa: E402

needs_schema = pytest.mark.skipif(
    not (em.ROOT / em.SUBMODULE / "docs" / "schemas").is_dir(),
    reason="vendor/ifc4.3 not fetched (bash scripts/ifc-schema/fetch.sh)",
)


@needs_schema
def test_migration_matches_generator():
    assert em.MIGRATION.read_text(encoding="utf-8") == em.render(), (
        "drift: run python -m etl.entity_manifest --write and review the diff"
    )


@needs_schema
def test_counts_and_spot_checks():
    s = em.stats(em.build())
    assert (s["total"], s["abstract"], s["is_root"], s["is_node"]) == (876, 133, 484, 422)
    assert s["is_node_not_root"] == sorted(em.RESOURCE_NODES)
    assert s["spot_checks"]["IfcTask"]["supertypes"] == "IfcProcess > IfcObject > IfcObjectDefinition > IfcRoot"
    assert s["spot_checks"]["IfcApproval"] == {
        "supertypes": "-", "is_root": False, "is_node": True, "is_abstract": False,
    }


def test_attribute_types():
    schema = em._schema()
    task = {a["name"]: a for a in em._attributes(schema.declaration_by_name("IfcTask").as_entity())}
    assert "GlobalId" not in task                       # own attributes only
    assert task["TaskTime"] == {"name": "TaskTime", "type": "IfcTaskTime", "kind": "entity", "optional": True}
    assert task["PredefinedType"]["kind"] == "enum" and "MAINTENANCE" in task["PredefinedType"]["enum"]
    addr = {a["name"]: a for a in em._attributes(schema.declaration_by_name("IfcPostalAddress").as_entity())}
    assert addr["AddressLines"] == {"name": "AddressLines", "type": "LIST [1:?] OF IfcLabel", "kind": "type",
                                    "optional": True, "aggregate": True}
