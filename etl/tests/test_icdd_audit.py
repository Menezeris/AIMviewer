"""Audit kontajnera ICDD (`etl/icdd_audit.py`, D-181).

Kontajner `fixtures/icdd/aim-small.icdd` zloží exportný kód v TypeScripte (`lib/icdd/audit-fixture.test.ts` stráži,
že súbor zodpovedá builderu). Testy nad ním overia, že čistý export audit prejde, a mutácie, že každá kontrola
naozaj zhodí výsledok. DB ani sieť sa nepoužívajú.
"""

from __future__ import annotations

import hashlib
import io
import re
import zipfile
from pathlib import Path

import pytest

rdflib = pytest.importorskip("rdflib")

from etl import icdd_audit  # noqa: E402
from etl.icdd_audit import audit, decode_step_string, main  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "icdd" / "aim-small.icdd"
COWL = "0pqk6UmJD2ARFkiAMMqZvv"


def _files() -> dict[str, bytes]:
    with zipfile.ZipFile(FIXTURE) as z:
        return {n: z.read(n) for n in z.namelist()}


def _index_name(files: dict[str, bytes]) -> str:
    return next(n for n in files if "/" not in n and n.lower() == "index.rdf")


def _write(tmp_path: Path, files: dict[str, bytes]) -> str:
    out = tmp_path / "m.icdd"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for n, d in files.items():
            z.writestr(n, d)
    out.write_bytes(buf.getvalue())
    return str(out)


def _codes(path: str, legacy: bool = True) -> tuple[set[str], set[str]]:
    rep = audit(path, legacy_index=legacy)
    return {i.code for i in rep.errors}, {i.code for i in rep.warnings}


def _replace(files: dict[str, bytes], name: str, old: str, new: str, count: int = 1) -> None:
    text = files[name].decode("utf-8")
    assert old in text, (name, old)
    files[name] = text.replace(old, new, count).encode("utf-8")


def _rehash(files: dict[str, bytes], payload: str) -> None:
    """Po zmene payloadu prepíše jeho sha256 v indexe, aby test meral len zamýšľanú chybu."""
    idx = _index_name(files)
    old = hashlib.sha256(_files()["Payload documents/" + payload]).hexdigest()
    _replace(files, idx, old, hashlib.sha256(files["Payload documents/" + payload]).hexdigest())


def test_clean_export_passes_and_reports_known_gaps() -> None:
    rep = audit(str(FIXTURE), legacy_index=True)
    assert [i for i in rep.errors] == []
    assert rep.stats["documents"] == {"total": 4, "by_type": {"ifc": 2, "pdf": 1, "xlsx": 1}, "sha256_checked": 4}
    ls = rep.stats["linksets"]
    assert ls["derived-spatial.rdf"]["links"] == 3
    assert ls["derived-spatial.rdf"]["to_class"] == {"IFCSPACE": 2, "IFCSPATIALZONE": 1}
    assert ls["documents-identity.rdf"]["by_type"] == {"IsIdenticalTo": 2}
    assert rep.stats["globalid_checked"] == {"ASR_v079.ifc": 3, "VZT_v011.ifc": 3}
    # port (IfcDistributionPort) sa nepočíta, výfukový nástavec bez priestoru áno
    assert rep.stats["coverage"]["VZT_v011.ifc"] == {"products": 3, "linked": 2, "without_space": 1}
    assert any(COWL in x and "VV.07.04.001" in x for x in rep.lists["without_space:VZT_v011.ifc"])


def test_lowercase_index_is_error_unless_legacy() -> None:
    files = _files()
    errors, _ = _codes(str(FIXTURE), legacy=False)
    if "index.rdf" in files:
        assert "index_name" in errors
    else:
        assert "index_name" not in errors


def test_cli_exit_codes(tmp_path: Path, capsys) -> None:
    assert main([str(FIXTURE), "--legacy-index", "--json", str(tmp_path / "r.json")]) == 0
    assert "Výsledok: OK" in capsys.readouterr().out
    assert (tmp_path / "r.json").exists()
    files = _files()
    files["Payload documents/D-1-1-09.pdf"] += b"x"
    assert main([_write(tmp_path, files), "--legacy-index"]) == 1
    assert main([str(tmp_path / "missing.icdd")]) in (1, 2)


@pytest.mark.parametrize(
    "mutation, code",
    [
        ("payload_tampered", "checksum"),
        ("payload_missing", "payload_missing"),
        ("payload_extra", "payload_unregistered"),
        ("linkset_missing", "linkset_missing"),
        ("linkset_extra", "linkset_unregistered"),
        ("no_documents_dir", "layout"),
        ("no_container_ontology", "ontology"),
        ("guid_not_in_ifc", "guid_missing"),
        ("doc_ident_not_in_ifc", "identifier_missing"),
        ("identifier_without_field", "identifier"),
        ("page_of_other_file", "identifier"),
        ("dangling_document", "dangling_document"),
        ("orphan_element", "orphan_element"),
        ("dangling_element", "dangling_element"),
        ("duplicate_link", "duplicate_link"),
        ("undeclared_predicate", "undeclared_term"),
        ("undeclared_class", "undeclared_term"),
        ("broken_rdf", "rdf_parse"),
    ],
)
def test_mutation_is_detected(tmp_path: Path, mutation: str, code: str) -> None:
    f = _files()
    ds = "Payload triples/derived-spatial.rdf"
    ident = "Payload triples/documents-identity.rdf"
    if mutation == "payload_tampered":
        f["Payload documents/VZT_v011.ifc"] += b"/* zmena */\n"
    elif mutation == "payload_missing":
        del f["Payload documents/D-1-1-09.pdf"]
    elif mutation == "payload_extra":
        f["Payload documents/navyse.pdf"] = b"%PDF-1.4\n"
    elif mutation == "linkset_missing":
        del f["Payload triples/federation.rdf"]
    elif mutation == "linkset_extra":
        f["Payload triples/navyse.rdf"] = f["Payload triples/federation.rdf"]
    elif mutation == "no_documents_dir":
        for n in [n for n in f if n.startswith("Payload documents/")]:
            del f[n]
    elif mutation == "no_container_ontology":
        del f["Ontology resources/Container.rdf"]
    elif mutation == "guid_not_in_ifc":
        _replace(f, ds, "<ls:identifier>1hOSvn6df7F8_7GcBWlRGQ<", "<ls:identifier>1hOSvn6df7F8_7GcBWlRGX<")
    elif mutation == "doc_ident_not_in_ifc":
        _replace(f, ident, "<ls:identifier>D.1.1.09<", "<ls:identifier>D.9.9.99<")
    elif mutation == "identifier_without_field":
        f[ds] = re.sub(rb"<ls:identifierField>GlobalId</ls:identifierField>", b"", f[ds], count=1)
    elif mutation == "page_of_other_file":
        _replace(f, ident, "D-1-1-09.pdf#page=3", "ine.pdf#page=3")
    elif mutation == "dangling_document":
        _replace(f, ds, "#doc-model_ASR", "#doc-neexistuje")
    elif mutation == "orphan_element":
        _replace(
            f, ds, "</rdf:RDF>",
            '<rdf:Description rdf:about="urn:x:sirota"><rdf:type rdf:resource="https://standards.iso.org/iso/21597/-1/ed-1/en/Linkset#LinkElement"/>'
            '<ls:hasDocument rdf:resource="urn:x-aim:container:2026-11-01_ASR-v079_VZT-v011_D1#doc-model_ASR"/></rdf:Description></rdf:RDF>',
        )
    elif mutation == "dangling_element":
        f[ds] = re.sub(rb'(<ls:hasToLinkElement rdf:resource=")[^"]+"', rb'\1urn:x:nikde"', f[ds], count=1)
    elif mutation == "duplicate_link":
        text = f[ds].decode()
        m = re.search(r'<rdf:Description rdf:about="([^"]+#L-[^"]+)">.*?</rdf:Description>', text, re.S)
        copy = m.group(0).replace(m.group(1), m.group(1) + "dup")
        f[ds] = text.replace("</rdf:RDF>", copy + "</rdf:RDF>").encode()
    elif mutation == "undeclared_predicate":
        _replace(f, ds, "<aim:role>", "<aim:rola>x</aim:rola><aim:role>")
    elif mutation == "undeclared_class":
        _replace(f, ds, "urn:x-aim:icdd#IsReferencedInSpatialStructure", "urn:x-aim:icdd#IsInSpace")
    elif mutation == "broken_rdf":
        f["Payload triples/federation.rdf"] = b"<rdf:RDF"
    errors, _ = _codes(_write(tmp_path, f))
    assert code in errors, (mutation, errors)


def test_empty_linkset_is_warning(tmp_path: Path) -> None:
    f = _files()
    fed = "Payload triples/federation.rdf"
    f[fed] = re.sub(rb"<rdf:Description rdf:about=\"[^\"]+#[LEI]-.*?</rdf:Description>", b"", f[fed], flags=re.S)
    errors, warnings = _codes(_write(tmp_path, f))
    assert "linkset_empty" in warnings and not errors


def test_native_space_containment_counts_as_covered(tmp_path: Path) -> None:
    f = _files()
    vzt = "Payload documents/VZT_v011.ifc"
    text = f[vzt].decode()
    text = text.replace(
        "ENDSEC;\nEND-ISO",
        "#20=IFCSPACE('1xS3BCk291UvhgP2a6eflN',$,'S',$,$,$,$,$,$,$,$);\n"
        "#21=IFCRELCONTAINEDINSPATIALSTRUCTURE('2xS3BCk291UvhgP2a6eflN',$,$,$,(#3),#20);\nENDSEC;\nEND-ISO",
    )
    f[vzt] = text.encode()
    _rehash(f, "VZT_v011.ifc")
    rep = audit(_write(tmp_path, f), legacy_index=True)
    assert not rep.errors, rep.errors
    assert rep.stats["coverage"]["VZT_v011.ifc"]["without_space"] == 0


def test_step_string_decoding() -> None:
    assert decode_step_string("V\\X2\\00FD\\X0\\pis") == "Výpis"
    assert decode_step_string("it''s") == "it's"
    assert decode_step_string("\\X\\E9") == "é"
    assert decode_step_string("\\S\\a") == chr(ord("a") + 128)
    assert decode_step_string("\\X4\\0001F600\\X0\\") == "\U0001F600"


def test_step_index_reads_documents_and_names() -> None:
    data = _files()["Payload documents/ASR_v079.ifc"]
    ifc = icdd_audit.IfcIndex.parse(data)
    assert ifc.schema == "IFC4X3_ADD2"
    assert ifc.doc_information == {"D.1.1.09"}
    assert ifc.doc_reference == {"page=3"}
    assert ifc.guid_name["0BTBFw6f90Nfh9rP1dlXrb"] == "1.01"
