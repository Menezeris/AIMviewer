"""Dokumenty z IFC (D-101) nad malým súborom v tvare ASR.

ASR nesie strom dokumentácie (PD -> časť -> súbor cez IfcDocumentInformationRelationship),
súbory s `Location = ../Dokumentacia/<Identification>.pdf`, IfcDocumentReference na strany
výpisu skladieb a väzby na projekt, zóny, priestorové zóny, skupiny a typ.
"""

from __future__ import annotations

from collections import Counter

import ifcopenshell
import ifcopenshell.guid

from etl import documents, transform
from etl.model import ObjectRow, StagedModel, DocumentExt

BASE = "https://x.supabase.co"


def _model() -> ifcopenshell.file:
    f = ifcopenshell.file(schema="IFC4X3_ADD2")
    g = ifcopenshell.guid.new
    project = f.createIfcProject(g(), Name="OCB")
    s1 = f.createIfcGroup(g(), Name="S1")
    zone = f.createIfcZone(g(), Name="NJ - 3NP")
    person = f.createIfcPerson(FamilyName="Augustín", GivenName="Samuel")
    org = f.createIfcOrganization(Name="Assetin s.r.o.")
    owner = f.createIfcPersonAndOrganization(ThePerson=person, TheOrganization=org)

    pd = f.createIfcDocumentInformation(Identification="OCB_SO01_PD", Name="Projektová dokumentácia")
    asr = f.createIfcDocumentInformation(Identification="OCB_SO01_ASR", Name="D.1.1 ASR")
    plan = f.createIfcDocumentInformation(
        Identification="OCB_SO01_ASR_D-1-1-03_PODORYS-3NP", Name="D.1.1.03 Pôdorys 3NP",
        Location="../Dokumentacia/OCB_SO01_ASR_D-1-1-03_PODORYS-3NP.pdf",
        DocumentOwner=owner, CreationTime="2025-01-15T21:03:23+01:00",
        LastRevisionTime="2025-01-15T21:03:32+01:00", ElectronicFormat="application/pdf",
    )
    vypis = f.createIfcDocumentInformation(
        Identification="OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB", Name="D.1.1.09 Výpis skladieb",
        Location="../Dokumentacia/OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB.pdf",
    )
    f.createIfcDocumentInformationRelationship(
        RelatingDocument=pd, RelatedDocuments=[asr], RelationshipType="SUBDOCUMENT")
    f.createIfcDocumentInformationRelationship(
        RelatingDocument=asr, RelatedDocuments=[plan, vypis], RelationshipType="SUBDOCUMENT")
    page3 = f.createIfcDocumentReference(
        Location="../Dokumentacia/OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB.pdf#page=3",
        Identification="page=3", Description="S1 - Skladba strechy (D.1.1.09, strana 3)",
        ReferencedDocument=vypis,
    )
    f.createIfcRelAssociatesDocument(g(), RelatedObjects=[project], RelatingDocument=plan)
    f.createIfcRelAssociatesDocument(g(), RelatedObjects=[zone], RelatingDocument=plan)
    f.createIfcRelAssociatesDocument(g(), RelatedObjects=[s1], RelatingDocument=page3)
    return f


def _by_ref(st: StagedModel) -> dict[str, ObjectRow]:
    return {o.object_ref: o for o in st.objects}


def test_documents_tree_and_references() -> None:
    st = transform.to_staged(_model())
    objs = _by_ref(st)
    kinds = Counter(o.object_type for o in st.objects)
    assert kinds["document"] == 4 and kinds["document_reference"] == 1

    # identita = Identification; priečinkové časti bez súboru sú tiež dokumenty
    plan = objs["OCB_SO01_ASR_D-1-1-03_PODORYS-3NP"]
    assert plan.name == "D.1.1.03 Pôdorys 3NP" and plan.ifc_type == "IfcDocumentInformation"
    d = plan.document
    assert d.location == "../Dokumentacia/OCB_SO01_ASR_D-1-1-03_PODORYS-3NP.pdf"
    assert d.document_owner == "Samuel Augustín (Assetin s.r.o.)"
    assert d.creation_time == "2025-01-15T21:03:23+01:00"
    assert d.last_revision_time == "2025-01-15T21:03:32+01:00"
    assert d.electronic_format == "application/pdf"
    assert objs["OCB_SO01_PD"].document.location is None

    # odkaz na stranu: vlastný uzol s menom, ukazuje na výpis skladieb
    ref = objs["OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB#page=3"]
    assert ref.object_type == "document_reference" and ref.ifc_type == "IfcDocumentReference"
    assert ref.name == "S1 - Skladba strechy (D.1.1.09, strana 3)"
    assert ref.document.referenced_document_ref == "OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB"

    edges = {(e.edge_type, e.from_ref, e.to_ref, e.role) for e in st.edges}
    assert ("document_part", "OCB_SO01_ASR", "OCB_SO01_PD", "SUBDOCUMENT") in edges
    assert ("document_part", "OCB_SO01_ASR_D-1-1-03_PODORYS-3NP", "OCB_SO01_ASR", "SUBDOCUMENT") in edges
    has_doc = {(objs[e.from_ref].object_type, e.to_ref) for e in st.edges if e.edge_type == "has_document"}
    assert has_doc == {
        ("project", "OCB_SO01_ASR_D-1-1-03_PODORYS-3NP"),
        ("zone", "OCB_SO01_ASR_D-1-1-03_PODORYS-3NP"),
        ("group", "OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB#page=3"),
    }
    assert not st.coverage.unlinked


def test_resolve_locations_uses_bucket_and_keeps_fragment() -> None:
    st = transform.to_staged(_model())
    names = {"OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB.pdf"}
    assert documents.resolve_locations(st, names, BASE) == 2   # výpis + jeho strana
    objs = _by_ref(st)
    vypis = objs["OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB"]
    assert vypis.document.storage_type == "supabase"
    assert vypis.document.location == (
        f"{BASE}/storage/v1/object/public/documents/OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB.pdf")
    assert vypis.properties["_ifc_location"] == "../Dokumentacia/OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB.pdf"
    page = objs["OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB#page=3"].document
    assert page.storage_type == "supabase" and page.location.endswith(".pdf#page=3")
    # súbor v buckete nie je → ostáva cesta zo súboru
    plan = objs["OCB_SO01_ASR_D-1-1-03_PODORYS-3NP"].document
    assert plan.storage_type == "unresolved" and plan.location.startswith("../Dokumentacia/")
    # opakované volanie nič nemení
    assert documents.resolve_locations(st, names, BASE) == 0
    assert vypis.properties["_ifc_location"].startswith("../Dokumentacia/")


def test_resolve_locations_without_base_keeps_source() -> None:
    m = StagedModel(objects=[ObjectRow("D", "document", document=DocumentExt(location="a\\b\\D.pdf"))])
    assert documents.resolve_locations(m, {"D.pdf"}, None) == 0
    assert m.objects[0].document.location == "a\\b\\D.pdf"
    m.objects[0].document.location = "a\\b\\D.pdf"
    assert documents.resolve_locations(m, {"D.pdf"}, BASE) == 1   # Windows oddeľovač


def test_mark_model_only_documents() -> None:
    m = StagedModel(objects=[ObjectRow("D", "document"), ObjectRow("R", "document_reference"),
                             ObjectRow("1.01", "space")])
    documents.mark_model(m, "ASR")
    assert [o.properties.get("_model") for o in m.objects] == ["ASR", "ASR", None]


class _Cur:
    def __init__(self, legacy: list) -> None:
        self.legacy, self.calls = legacy, []

    def execute(self, sql: str, params: tuple = ()) -> "_Cur":
        self.calls.append((" ".join(sql.split()), params))
        return self

    def fetchall(self) -> list:
        sql = self.calls[-1][0]
        if sql.startswith("select id from objects"):
            return [(i,) for i in self.legacy]
        return [("e1",), ("e2",)]


def test_close_legacy_retires_documents_without_model_and_their_edges() -> None:
    cur = _Cur(["d1", "d2"])
    assert documents.close_legacy(cur) == {"documents": 2, "edges": 2}
    select, edges, objects = cur.calls
    assert "not (properties ? '_model')" in select[0]
    assert "(from_id = any(%s) or to_id = any(%s))" in edges[0] and edges[1] == (["d1", "d2"], ["d1", "d2"])
    assert objects[0].startswith("update objects set valid_until = now() where id = any(%s)")


def test_close_legacy_without_legacy_is_noop() -> None:
    cur = _Cur([])
    assert documents.close_legacy(cur) == {"documents": 0, "edges": 0}
    assert len(cur.calls) == 1
