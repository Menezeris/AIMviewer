"""Nahrávanie do Storage nastavuje `cacheControl` vo formulári (D-135 dodatok)."""

from __future__ import annotations

from etl import doc_upload, ifc_upload, model_publish


def _parts(body: bytes, ctype: str) -> list[bytes]:
    boundary = ctype.split("boundary=")[1].encode()
    return [p for p in body.split(b"--" + boundary) if p.strip(b"-\r\n")]


def test_multipart_carries_cache_control_and_exact_bytes() -> None:
    payload = b"\x00\x01binary\r\n--not-a-boundary\xff"
    body, ctype = ifc_upload.multipart_body(payload, "application/gzip", 31536000)
    assert ctype.startswith("multipart/form-data; boundary=")
    first, second = _parts(body, ctype)
    assert b'name="cacheControl"' in first and first.rstrip().endswith(b"31536000")
    assert b"Content-Type: application/gzip" in second
    assert second.split(b"\r\n\r\n", 1)[1] == payload + b"\r\n"


def test_policy_values() -> None:
    assert model_publish.ARCHIVE_CACHE_CONTROL == 31536000
    assert model_publish.CURRENT_CACHE_CONTROL < model_publish.ARCHIVE_CACHE_CONTROL
    assert doc_upload.CACHE_SECONDS == 3600


def test_put_posts_form_without_header_cache_control(monkeypatch) -> None:
    seen = {}

    def fake(method, url, key, *, data=None, content_type=None, extra_headers=None):
        seen.update(url=url, data=data, ctype=content_type, headers=extra_headers)
        return 200, b""

    monkeypatch.setattr(ifc_upload, "_request", fake)
    status, _ = ifc_upload.put_object(
        "https://x.supabase.co", "k", "ifc", "archive/ASR/v001.ifc.gz", b"abc",
        content_type="application/gzip", upsert=False, cache_seconds=31536000,
    )
    assert status == 200
    assert seen["url"].endswith("/storage/v1/object/ifc/archive/ASR/v001.ifc.gz")
    assert seen["ctype"].startswith("multipart/form-data")
    assert seen["headers"] == {"x-upsert": "false"}
