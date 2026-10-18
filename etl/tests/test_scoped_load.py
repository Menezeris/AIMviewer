"""Load so zdrojom modelu (D-086): zastarané hrany a GUID záznamy modelu sa uzavrú.

Úprava modelu presunie prvok, zlúči priestory alebo prvok zmaže. Upsert by starú
hranu nechal aktívnu (pri `rel_aggregates` by nový rodič zhodil load na parciálnom
unique indexe), preto: nový rodič najprv uzavrie starého a po loade sa uzavrie
všetko so zdrojom modelu, čo tento beh nevydal. Stub kurzor ako `test_guid_history`.
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
from etl.model import ClassLink, Edge, GuidHistory, StagedModel


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
    m.edges.append(Edge("has_document", "1.01", "DOC", source="pdf_link (E4)"))
    m.class_links.append(ClassLink(from_ref="1.01", system_name="CCI", identification="A"))
    m.guid_history.append(GuidHistory(object_ref="1.01", ifc_guid="G1", source="IFC import"))
    m.guid_history.append(
        GuidHistory(object_ref="1.01", ifc_guid="G0", valid_until="2026-01-01", source="IFC import")
    )
    return m


def test_scope_sources_rewrites_only_default_sources() -> None:
    m = _model()
    scope_sources(m, "ASR")
    assert [e.source for e in m.edges] == ["etl:ASR", "pdf_link (E4)"]
    assert m.class_links[0].source == "etl:ASR"
    assert {g.source for g in m.guid_history} == {"IFC import:ASR"}


def test_emitted_ids_cover_edges_classifications_and_active_guids() -> None:
    edges, guids = emitted_ids(_model())
    assert ids.edge_id("1.01", "1NP", "aggregates") in edges
    assert ids.edge_id("1.01", "CCI:A", "has_classification") in edges
    assert guids == [ids.guid_history_id("1.01", "G1")]  # uzavretý G0 sa nepočíta


def test_close_stale_closes_only_this_model() -> None:
    cur = StubCursor()
    m = _model()
    closed = close_stale(cur, m, "ASR")
    assert closed == {"edges": 1, "guids": 1, "objects": 1, "repointed": 2}
    (edge_sql, edge_params), (guid_sql, guid_params), (obj_sql, obj_params), *repoint = cur.calls
    assert edge_sql.startswith("update relationships set valid_until = now()")
    assert "source = %s and valid_until is null and not (id = any(%s))" in edge_sql
    assert edge_params[0] == "etl:ASR"
    assert guid_sql.startswith("update ifc_guid_history set valid_until = now()")
    assert guid_params == ("IFC import:ASR", [ids.guid_history_id("1.01", "G1")])
    # objekt bez aktívneho GUID zo zdroja modelu zanikne (D-087)
    assert obj_sql.startswith("update objects o set valid_until = now()")
    assert "not exists (select 1 from ifc_guid_history h where h.object_id = o.id and h.valid_until is null)" in obj_sql
    assert obj_params == ("IFC import:ASR",)
    # ručné väzby na nástupcu s rovnakým GUID, oba konce; väzby ETL a derive nie
    assert [sql.split(" = s.new_id")[0] for sql, _ in repoint] == [
        "update relationships r set from_id", "update relationships r set to_id"]
    assert all("r.source not like 'etl%' and r.source not like 'derive:%'" in sql for sql, _ in repoint)


def test_close_legacy_targets_sources_without_model() -> None:
    cur = StubCursor()
    close_legacy(cur)
    assert [c[1] for c in cur.calls] == [("etl",), ("IFC import",), ("IFC import",), (), ()]


def test_new_parent_closes_previous_active_parent_first() -> None:
    """Zlúčenie priestorov / presun: 1.06 má nového rodiča → starý sa uzavrie pred insertom."""
    cur = StubCursor()
    m = StagedModel()
    m.edges.append(Edge("aggregates", "1.06", "1NP"))
    m.edges.append(Edge("has_document", "1.06", "DOC"))  # bez unique-active-parent
    _load_edges(cur, m, {"1.06": "uuid-106", "1NP": "uuid-1np", "DOC": "uuid-doc"})

    close_sql, close_params = cur.calls[0]
    assert close_sql.startswith("update relationships set valid_until = now()")
    assert "rel_type = %s and from_id = %s and valid_until is null and id <> %s" in close_sql
    assert close_params == (
        "rel_aggregates", "uuid-106", ids.edge_id("1.06", "1NP", "aggregates")
    )
    assert cur.calls[1][0].startswith("insert into relationships")
    # dokument nemá jedného rodiča → žiadne uzavretie, len insert
    assert len(cur.calls) == 3 and cur.calls[2][0].startswith("insert into relationships")
