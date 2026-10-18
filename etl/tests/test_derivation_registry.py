"""Register pravidiel odvodení (D-089): výber pravidiel na beh a rozdelenie hrán.

Geometrické pravidlá zdieľajú jeden výpočet; hrany sa rozdelia podľa cieľovej triedy,
zdrojovej triedy a roly, aby každé pravidlo zapisovalo pod vlastným zdrojom a dalo sa vypnúť
samostatne. Vypnuté pravidlo sa pri behu uprace (jeho hrany sa uzavrú).
"""

from __future__ import annotations

import pytest

from etl.derive import DerivedEdge
from etl.derive.registry import Rule, partition_edges, select_rules

REL = "rel_referenced_in_spatial_structure"


def _rule(rid: str, target: str, *, enabled: bool = True, mode: str = "auto",
          kind: str = "geometry", roles=("inside", "partial")) -> Rule:
    return Rule(rid, rid, kind, REL if kind == "geometry" else None,
                f"derive:{rid}" if kind == "geometry" else None,
                ["IfcDistributionElement"], [target], list(roles), enabled, mode)


SPACE = _rule("element_in_space", "IfcSpace")
SZONE = _rule("element_in_spatial_zone", "IfcSpatialZone")
ZONE = _rule("element_in_zone", "IfcZone", kind="via_space")


class Ent:
    """Náhrada entity IFC: `is_a(cls)` podľa zoznamu nadtried."""

    def __init__(self, *classes: str) -> None:
        self.classes = classes

    def is_a(self, cls: str) -> bool:
        return cls in self.classes


def test_auto_runs_only_enabled_auto_rules_and_cleans_disabled() -> None:
    manual = _rule("element_in_space", "IfcSpace", mode="manual")
    off = _rule("element_in_spatial_zone", "IfcSpatialZone", enabled=False)
    to_run, to_close = select_rules([manual, off, ZONE], None, "auto")
    assert [r.id for r in to_run] == ["element_in_zone"]
    assert [r.id for r in to_close] == ["element_in_spatial_zone"]


def test_manual_runs_all_enabled_and_explicit_rules_ignore_mode() -> None:
    manual = _rule("element_in_space", "IfcSpace", mode="manual")
    assert [r.id for r in select_rules([manual, SZONE], None, "manual")[0]] == [
        "element_in_space", "element_in_spatial_zone"]
    assert [r.id for r in select_rules([manual, SZONE], ["element_in_space"], "auto")[0]] == [
        "element_in_space"]


def test_view_rule_has_nothing_to_close() -> None:
    off_zone = _rule("element_in_zone", "IfcZone", kind="via_space", enabled=False)
    assert select_rules([off_zone], None, "auto") == ([], [])


def test_unknown_rule_is_an_error() -> None:
    with pytest.raises(SystemExit):
        select_rules([SPACE], ["nie_je"], "manual")


def test_partition_by_target_class_source_class_and_role() -> None:
    entities = {
        "duct": Ent("IfcDuctSegment", "IfcDistributionElement"),
        "wall": Ent("IfcWall"),
        "room": Ent("IfcSpace", "IfcSpatialElement"),
        "fire": Ent("IfcSpatialZone", "IfcSpatialElement"),
    }
    edges = [
        DerivedEdge(REL, "duct", "room", "inside"),
        DerivedEdge(REL, "duct", "fire", "partial"),
        DerivedEdge(REL, "wall", "room", "inside"),      # stena nie je zdrojová trieda
        DerivedEdge(REL, "ghost", "room", "inside"),     # GUID mimo modelov
    ]
    only_inside = _rule("element_in_spatial_zone", "IfcSpatialZone", roles=("inside",))
    out = partition_edges(edges, [SPACE, only_inside], entities)
    assert [(e.from_guid, e.to_guid) for e in out["element_in_space"]] == [("duct", "room")]
    assert out["element_in_spatial_zone"] == []  # partial nepatrí pravidlu len s inside
