"""Názvy podlaží: ETL zvláda zápis Revitu (2NP) aj štandardu knižnice (2.NP).

Knižnica (assetin-library, IU-O-storey) predpisuje `[0-9]{1,2}.(NP|PP)`; ETL
federácia (D-049) páruje VZT podlažia s ASR cez normalizovaný kľúč `2NP`.
"""

from __future__ import annotations

from etl.transform import _NP_EXACT, _np_key


def test_np_key_normalizes_both_notations() -> None:
    assert _np_key("2NP") == "2NP"
    assert _np_key("2.NP") == "2NP"
    assert _np_key("2. NP") == "2NP"
    assert _np_key("1NP_VZT") == "1NP"
    assert _np_key("2.NP_HH_STROP") == "2NP"
    assert _np_key("Strecha") is None


def test_exact_storey_names() -> None:
    assert _NP_EXACT.match("3NP") and _NP_EXACT.match("3.NP")
    assert not _NP_EXACT.match("3NP_SH_ZD")
