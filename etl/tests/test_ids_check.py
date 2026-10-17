"""Kontrola modelu voči IDS (D-081): ifctester výsledok → riadky, zápis behu.

Integrácia: malý IFC4X3 (dve miestnosti, jedna so zlým číslom, žiadna zóna)
a minimálny IDS 1.0 (číslo miestnosti podľa vzoru + povinná zóna).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from etl.ids_check import NO_APPLICABLE, CheckResult, ResultRow, check, write_run

IDS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<ids:ids xmlns:ids="http://standards.buildingsmart.org/IDS" xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://standards.buildingsmart.org/IDS http://standards.buildingsmart.org/IDS/1.0/ids.xsd">
  <ids:info><ids:title>Test ER</ids:title><ids:version>0.1</ids:version></ids:info>
  <ids:specifications>
    <ids:specification ifcVersion="IFC4X3_ADD2" name="Priestor" identifier="IU-O-space">
      <ids:applicability minOccurs="1" maxOccurs="unbounded">
        <ids:entity><ids:name><ids:simpleValue>IFCSPACE</ids:simpleValue></ids:name></ids:entity>
      </ids:applicability>
      <ids:requirements>
        <ids:attribute cardinality="required">
          <ids:name><ids:simpleValue>Name</ids:simpleValue></ids:name>
          <ids:value><xs:restriction base="xs:string"><xs:pattern value="[0-9]{2}\\.[0-9]{3}"/></xs:restriction></ids:value>
        </ids:attribute>
      </ids:requirements>
    </ids:specification>
    <ids:specification ifcVersion="IFC4X3_ADD2" name="Zóna" identifier="IU-O-zone">
      <ids:applicability minOccurs="1" maxOccurs="unbounded">
        <ids:entity><ids:name><ids:simpleValue>IFCZONE</ids:simpleValue></ids:name></ids:entity>
      </ids:applicability>
      <ids:requirements>
        <ids:attribute cardinality="required"><ids:name><ids:simpleValue>Name</ids:simpleValue></ids:name></ids:attribute>
      </ids:requirements>
    </ids:specification>
  </ids:specifications>
</ids:ids>
"""


def _model():
    ifcopenshell = pytest.importorskip("ifcopenshell")
    pytest.importorskip("ifcopenshell.api")
    m = ifcopenshell.api.run("project.create_file", version="IFC4X3")
    project = ifcopenshell.api.run("root.create_entity", m, ifc_class="IfcProject")
    building = ifcopenshell.api.run("root.create_entity", m, ifc_class="IfcBuilding")
    ifcopenshell.api.run("aggregate.assign_object", m, relating_object=project, products=[building])
    storey = ifcopenshell.api.run("root.create_entity", m, ifc_class="IfcBuildingStorey", name="2.NP")
    ifcopenshell.api.run("aggregate.assign_object", m, relating_object=building, products=[storey])
    ok = ifcopenshell.api.run("root.create_entity", m, ifc_class="IfcSpace", name="02.015")
    bad = ifcopenshell.api.run("root.create_entity", m, ifc_class="IfcSpace", name="2.01")
    ifcopenshell.api.run("aggregate.assign_object", m, relating_object=storey, products=[ok, bad])
    return m, ok, bad


def test_check_marks_elements_and_missing_mandatory_spec(tmp_path: Path) -> None:
    pytest.importorskip("ifctester")
    ids_path = tmp_path / "test.ids"
    ids_path.write_text(IDS_XML, encoding="utf-8")
    m, ok, bad = _model()
    res = check(ids_path, m)

    assert res.ids_title == "Test ER" and res.ids_version == "0.1" and len(res.ids_sha256) == 64
    by_guid = {r.ifc_guid: r for r in res.rows if r.ifc_guid}
    assert by_guid[ok.GlobalId].status == "pass"
    assert by_guid[bad.GlobalId].status == "fail"
    assert by_guid[bad.GlobalId].spec_identifier == "IU-O-space"
    assert any("2.01" in why for why in by_guid[bad.GlobalId].reasons)
    zone = [r for r in res.rows if r.spec_identifier == "IU-O-zone"]
    assert len(zone) == 1 and zone[0].ifc_guid is None and zone[0].reasons == [NO_APPLICABLE]
    assert res.specs_total == 2 and res.specs_passed == 0


class StubCursor:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple]] = []
        self._last = ""

    def execute(self, sql: str, params: tuple = ()) -> "StubCursor":
        self._last = " ".join(sql.split())
        self.calls.append((self._last, params))
        return self

    def fetchall(self):
        return [("G1", "uuid-1")]

    def fetchone(self):
        return ("run-1",)


def test_write_run_resolves_guids_and_counts() -> None:
    res = CheckResult("ER", "0.1", "abc", specs_total=2, specs_passed=1, rows=[
        ResultRow("IU-O-space", "Priestor", None, None, "G1", "IfcSpace", "fail", ["zlé číslo"]),
        ResultRow("IU-O-space", "Priestor", None, None, "G2", "IfcSpace", "pass"),
        ResultRow("IU-O-zone", "Zóna", None, None, None, None, "fail", [NO_APPLICABLE]),
    ])
    cur = StubCursor()
    run_id, missing = write_run(cur, res, model_label="ASR", model_file="ASR.ifc", ids_source="lib@x")
    assert (run_id, missing) == ("run-1", 1)
    run = [c for c in cur.calls if c[0].startswith("insert into ids_runs")][0]
    assert run[1][-2:] == (3, 2)  # results_total, results_failed
    results = [c[1] for c in cur.calls if c[0].startswith("insert into ids_results")]
    assert [r[5] for r in results] == ["uuid-1", None, None]  # object_id: G1 v DB, G2 nie, zóna bez prvku
