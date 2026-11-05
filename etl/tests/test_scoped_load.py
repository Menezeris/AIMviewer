"""Load with a model source (D-086): stale edges and GUID records of the model are closed.

Editing a model moves an element, merges spaces or deletes an element. An upsert would leave the old
edge active (for `rel_aggregates` the new parent would crash the load on the partial
unique index), hence: the new parent first closes the old one and after the load everything
with the model source that this run did not emit is closed. A stub cursor as in `test_guid_history`.
"""

from __future__ import annotations

from etl import ids
from etl.db import (
    _load_edges,
    close_legacy,
    close_stale,
    emitted_ids,
    scope_sources,
)
from etl.db import _load_class_links, _load_guid_aliases, writes_edge
from etl.model import ClassLink, Edge, GuidAlias, GuidHistory, StagedModel

P = "9e2dfcba-437b-43d3-a925-0dd29f195b38"  # OCB (D-189)


class StubCursor:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple]] = []

    def execute(self, sql: str, params: tuple = ()) -> "StubCursor":
        self.calls.append((" ".join(sql.split()), params))
        return self

    def fetchall(self) -> list:
        return [("x",)]

    def fetchone(self):
        return None


def _model() -> StagedModel:
    m = StagedModel()
    m.edges.append(Edge("aggregates", "1.01", "1NP"))
    m.edges.append(Edge("referenced", "1.01", "Z1"))
    m.edges.append(Edge("has_document", "1.01", "DOC", source="pdf_link (E4)"))
    m.class_links.append(ClassLink(from_ref="1.01", system_name="CCI", identification="A"))
    m.class_links.append(ClassLink(from_ref="DOC", system_name="ISO", identification="DR",
                                   edge_type="document_classification"))
    m.guid_aliases.append(GuidAlias(object_ref="DD01", ifc_guid="T2", source="IFC import"))
    m.guid_history.append(GuidHistory(object_ref="1.01", ifc_guid="G1", source="IFC import"))
    m.guid_history.append(
        GuidHistory(object_ref="1.01", ifc_guid="G0", valid_until="2026-01-01", source="IFC import")
    )
    return m


def test_scope_sources_rewrites_only_default_sources() -> None:
    m = _model()
    scope_sources(m, "ASR")
    assert [e.source for e in m.edges] == ["etl:ASR", "etl:ASR", "pdf_link (E4)"]
    assert {c.source for c in m.class_links} == {"etl:ASR"}
    assert {g.source for g in m.guid_history} == {"IFC import:ASR"}
    assert m.guid_aliases[0].source == "IFC import:ASR"


def test_emitted_ids_cover_edges_classifications_and_active_guids() -> None:
    edges, guids = emitted_ids(_model())
    # The ETL does not emit IFC relationships from the revision copy (D-183 K3 step 3); the AIM layer and other types it does
    assert ids.edge_id("1.01", "1NP", "aggregates") not in edges
    assert ids.edge_id("1.01", "CCI:A", "has_classification") not in edges
    assert ids.edge_id("1.01", "Z1", "referenced") in edges
    assert ids.edge_id("1.01", "DOC", "has_document") in edges
    assert ids.edge_id("DOC", "ISO:DR", "document_classification") in edges
    assert guids == [ids.guid_history_id("1.01", "G1")]  # a closed G0 is not counted


def test_close_stale_closes_only_this_model() -> None:
    cur = StubCursor()
    m = _model()
    scope_sources(m, "ASR")
    closed = close_stale(cur, m, "ASR", P)
    assert closed == {"edges": 1, "guids": 2, "objects": 1, "documents": 1, "repointed": 2}
    (edge_sql, edge_params), (guid_sql, guid_params), (alias_sql, alias_params), \
        (obj_sql, obj_params), (doc_sql, doc_params), *repoint = cur.calls
    assert edge_sql.startswith("update relationships set valid_until = now()")
    assert ("source = %s and project_id = %s and valid_until is null and not (rel_type = any(%s)) "
            "and not (id = any(%s))") in edge_sql
    assert edge_params[:2] == ("etl:ASR", P)
    # a re-ETL does not close the old type edges from the revision copy (a separate step, D-183 K3 step 3)
    assert edge_params[2] == sorted({
        "rel_aggregates", "rel_contained_in_spatial_structure", "rel_defines_by_type",
        "rel_assigns_to_group", "rel_associates_document", "rel_associates_classification"})
    assert guid_sql.startswith("update ifc_guid_history h set valid_until = now()")
    assert "o.project_id = %s" in guid_sql
    assert guid_params == ("IFC import:ASR", [ids.guid_history_id("1.01", "G1")], P)
    assert alias_sql.startswith("update ifc_guid_aliases set valid_until = now()")
    assert alias_params == ("IFC import:ASR", P, [ids.guid_alias_id("DD01", "T2")])
    # an object without an active GUID from the model source ceases to exist (D-088)
    assert obj_sql.startswith("update objects o set valid_until = now()")
    assert "not exists (select 1 from ifc_guid_history h where h.object_id = o.id and h.valid_until is null)" in obj_sql
    assert obj_params == ("IFC import:ASR", P)
    # model documents that the run did not emit cease to exist (D-104); other models and E3 do not
    assert doc_sql.startswith("update objects set valid_until = now()")
    assert "properties->>'_model' = %s and project_id = %s and not (object_ref = any(%s))" in doc_sql
    assert doc_params == (["document", "document_reference"], "ASR", P, [])
    # manual links to a successor with the same GUID, both ends; ETL and derive links are not
    assert [sql.split(" = s.new_id")[0] for sql, _ in repoint] == [
        "update relationships r set from_id", "update relationships r set to_id"]
    assert all("r.source not like 'etl%%' and r.source not like 'derive:%%'" in sql for sql, _ in repoint)
    # a GUID is unique only within a project: the successor is searched in the same project (D-189)
    assert all("n.project_id = o.project_id" in sql and params == (P,) for sql, params in repoint)


def test_close_legacy_targets_sources_without_model() -> None:
    cur = StubCursor()
    close_legacy(cur)
    assert [c[1] for c in cur.calls] == [("etl", P), ("IFC import", P), ("IFC import", P), (P,), (P,)]


def test_new_parent_closes_previous_active_parent_first() -> None:
    """Merging spaces / a move: 1.06 has a new parent -> the old one is closed before the insert."""
    cur = StubCursor()
    m = StagedModel()
    m.edges.append(Edge("aggregates", "1.06", "1NP", source="seed"))  # AIM layer, not ETL
    m.edges.append(Edge("has_document", "1.06", "DOC", source="seed"))  # without unique-active-parent
    _load_edges(cur, m, {"1.06": "uuid-106", "1NP": "uuid-1np", "DOC": "uuid-doc"}, P)

    close_sql, close_params = cur.calls[0]
    assert close_sql.startswith("update relationships set valid_until = now()")
    assert "rel_type = %s and from_id = %s and valid_until is null and id <> %s" in close_sql
    assert close_params == (
        "rel_aggregates", "uuid-106", ids.edge_id("1.06", "1NP", "aggregates")
    )
    assert cur.calls[1][0].startswith("insert into relationships")
    # a document has no single parent -> no closing, just an insert
    assert len(cur.calls) == 3 and cur.calls[2][0].startswith("insert into relationships")


def test_writes_edge_skips_only_etl_edges_read_from_revision_copy() -> None:
    """D-183 K3 step 3: an IFC relationship from a file that the view reads from the copy is not written by the ETL; the AIM layer is."""
    for edge_type in ("aggregates", "contained", "defined_by_type", "assigns_to_group",
                      "has_document", "has_classification"):
        assert not writes_edge(edge_type, "etl")
        assert not writes_edge(edge_type, "etl:VZT")
    assert writes_edge("has_document", "pdf_link (E4)")
    assert writes_edge("aggregates", "etlx")  # another source, only a similar prefix
    for edge_type in ("referenced", "space_boundary", "responsible_for", "member_of",
                      "document_part", "document_classification"):
        assert writes_edge(edge_type, "etl:ASR")


def test_load_writes_no_ifc_edges_from_file() -> None:
    """The graph ETL writes neither an edge nor a classification link of types from the copy; the federation container is not even searched for."""
    cur = StubCursor()
    m = StagedModel()
    m.edges.append(Edge("contained", "VZT.1", "2NP", source="etl:VZT"))  # 2NP is neither in the run nor in the DB
    m.edges.append(Edge("defined_by_type", "VZT.1", "VT.1", source="etl:VZT"))
    m.edges.append(Edge("assigns_to_group", "VZT.1", "SYS", source="etl:VZT"))
    _load_edges(cur, m, {"VZT.1": "u1"}, P)
    assert cur.calls == []
    m.class_links.append(ClassLink(from_ref="VZT.1", system_name="S", identification="X", source="etl:VZT"))
    m.class_links.append(ClassLink(from_ref="DOC", system_name="ISO", identification="DR",
                                   edge_type="document_classification", source="etl:VZT"))
    _load_class_links(cur, m, {"VZT.1": "u1", "DOC": "ud"}, {("S", "X"): "r1", ("ISO", "DR"): "r2"})
    assert len(cur.calls) == 1 and cur.calls[0][1][1] == "rel_external_reference_relationship"


def test_guid_alias_closes_other_active_alias_then_upserts() -> None:
    """Alias GUID of a merged type (D-033 as data): another active alias of that GUID is closed, then an upsert."""
    cur = StubCursor()
    m = StagedModel()
    m.guid_aliases.append(GuidAlias(object_ref="DD01.06", ifc_guid="T2", source="IFC import:ASR"))
    assert _load_guid_aliases(cur, m, {"DD01.06": "u-type"}, P) == [ids.guid_alias_id("DD01.06", "T2")]
    aid = ids.guid_alias_id("DD01.06", "T2")
    (look_sql, look_params), (close_sql, close_params), (ins_sql, ins_params) = cur.calls
    assert look_sql.startswith("select id from ifc_guid_aliases") and look_params == (P, "T2", "u-type", "type_code")
    assert close_sql.startswith("update ifc_guid_aliases set valid_until = now()")
    # only aliases of the run's project are closed (D-189)
    assert close_params == ("T2", P, aid)
    assert ins_sql.startswith("insert into ifc_guid_aliases")
    assert ins_params == (aid, "u-type", "T2", "type_code", "IFC import:ASR", P)


def test_equivalent_active_alias_is_kept() -> None:
    """D-189: an alias with the same meaning under another id (migration backfill) is kept, not re-inserted,
    and its id counts as emitted, so close_stale does not close it."""

    class Found(StubCursor):
        def fetchone(self):
            return ("backfilled-id",)

    cur = Found()
    m = StagedModel()
    m.guid_aliases.append(GuidAlias(object_ref="DD01.06", ifc_guid="T2", source="IFC import:ASR"))
    assert _load_guid_aliases(cur, m, {"DD01.06": "u-type"}, P) == ["backfilled-id"]
    assert len(cur.calls) == 1
    cur = StubCursor()
    close_stale(cur, m, "ASR", P, ["backfilled-id"])
    alias_close = [c for c in cur.calls if c[0].startswith("update ifc_guid_aliases")][0]
    assert alias_close[1] == ("IFC import:ASR", P, ["backfilled-id"])
