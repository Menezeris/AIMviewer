"""Documents from IFC (D-104) over a small file shaped like the ASR.

The ASR carries a documentation tree (PD -> part -> file via IfcDocumentInformationRelationship),
files with `Location = ../Dokumentacia/<Identification>.pdf`, IfcDocumentReference to the pages
of the assembly listing and links to the project, zones, spatial zones, groups and type.
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

    # identity = Identification; folder parts without a file are documents too
    plan = objs["OCB_SO01_ASR_D-1-1-03_PODORYS-3NP"]
    assert plan.name == "D.1.1.03 Pôdorys 3NP" and plan.ifc_type == "IfcDocumentInformation"
    d = plan.document
    assert d.location == "../Dokumentacia/OCB_SO01_ASR_D-1-1-03_PODORYS-3NP.pdf"
    assert d.document_owner == "Samuel Augustín (Assetin s.r.o.)"
    assert d.creation_time == "2025-01-15T21:03:23+01:00"
    assert d.last_revision_time == "2025-01-15T21:03:32+01:00"
    assert d.electronic_format == "application/pdf"
    assert objs["OCB_SO01_PD"].document.location is None

    # page reference: its own node with a name, points to the assembly listing
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
    assert documents.resolve_locations(st, names, BASE) == 2   # listing + its page
    objs = _by_ref(st)
    vypis = objs["OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB"]
    assert vypis.document.storage_type == "supabase"
    assert vypis.document.location == (
        f"{BASE}/storage/v1/object/public/documents/OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB.pdf")
    assert vypis.properties["_ifc_location"] == "../Dokumentacia/OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB.pdf"
    page = objs["OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB#page=3"].document
    assert page.storage_type == "supabase" and page.location.endswith(".pdf#page=3")
    # the file is not in the bucket -> the path from the file stays
    plan = objs["OCB_SO01_ASR_D-1-1-03_PODORYS-3NP"].document
    assert plan.storage_type == "unresolved" and plan.location.startswith("../Dokumentacia/")
    # a repeated call changes nothing
    assert documents.resolve_locations(st, names, BASE) == 0
    assert vypis.properties["_ifc_location"].startswith("../Dokumentacia/")


def test_resolve_locations_without_base_keeps_source() -> None:
    m = StagedModel(objects=[ObjectRow("D", "document", document=DocumentExt(location="a\\b\\D.pdf"))])
    assert documents.resolve_locations(m, {"D.pdf"}, None) == 0
    assert m.objects[0].document.location == "a\\b\\D.pdf"
    m.objects[0].document.location = "a\\b\\D.pdf"
    assert documents.resolve_locations(m, {"D.pdf"}, BASE) == 1   # Windows separator


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


def test_document_classification_iso19650() -> None:
    """Type information (ASR v77): IfcExternalReferenceRelationship from a reference to documents."""
    f = _model()
    system = f.createIfcClassification(Source="BSI", Name="ISO 19650 typ informácie")
    dr = f.createIfcClassificationReference(Identification="DR", Name="Výkres", ReferencedSource=system)
    sh = f.createIfcClassificationReference(Identification="SH", Name="Výpis", ReferencedSource=system)
    by_ident = {d.Identification: d for d in f.by_type("IfcDocumentInformation")}
    f.createIfcExternalReferenceRelationship(
        RelatingReference=dr, RelatedResourceObjects=[by_ident["OCB_SO01_ASR_D-1-1-03_PODORYS-3NP"]])
    f.createIfcExternalReferenceRelationship(
        RelatingReference=sh, RelatedResourceObjects=[by_ident["OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB"]])
    st = transform.to_staged(f)

    links = {(c.from_ref, c.system_name, c.identification, c.edge_type) for c in st.class_links}
    assert links == {
        ("OCB_SO01_ASR_D-1-1-03_PODORYS-3NP", "ISO 19650 typ informácie", "DR", "document_classification"),
        ("OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB", "ISO 19650 typ informácie", "SH", "document_classification"),
    }
    assert {(r.identification, r.name) for r in st.refs} == {("DR", "Výkres"), ("SH", "Výpis")}
    assert [s.source for s in st.systems] == ["BSI"]
