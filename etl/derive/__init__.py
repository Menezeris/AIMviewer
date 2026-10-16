"""Post-processing odvodzovače nad naloadenými IFC modelmi (D-080).

Odvodzovač (rule) dostane jeden alebo viac IFC modelov federácie a vráti hrany,
ktoré v žiadnom zdrojovom súbore nie sú, ale dajú sa z nich odvodiť (geometria,
tranzitivita, …). Hrany žijú len v našej DB ako vrstva nad zdrojmi: zdrojové IFC
sa nikdy neprepisujú, každá odvodená hrana nesie `source='derive:<rule>'`
a beh je idempotentný (rekonciliácia v `db.py`).

Nový odvodzovač = nová trieda s `name`/`rel_type` a metódou `derive(ctx)`,
zaregistrovaná v `RULES`. Spustenie: `python -m etl.derive <rule> --models …`.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DerivedEdge:
    """Jedna odvodená hrana medzi dvoma IFC entitami (identita = IFC GUID)."""

    rel_type: str
    from_guid: str
    to_guid: str
    role: str | None
