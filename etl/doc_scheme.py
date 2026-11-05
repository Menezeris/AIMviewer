"""Document naming convention: CDE standard (D-036).

For elements the identity spine is `object_ref` (`scheme.py`); for documents it is the
**naming convention**. The name of an information container carries metadata in fixed
**positional fields** separated by `_`; this module splits it into `DocumentMeta`
(the same principle as `scheme.py` uses to compose `object_ref`).

The convention adopts the **real CDE standard** (Jihočeský kraj, "Standard CDE - Společné
datové prostředí", ISO 19650 line), not the generic ISO: the code vocabulary is ready and
authoritative. Another project = another vocabulary in this file, the code does not change (D-033 line).

Structure (7 positions, separator `_`):

    Projekt _ StupeňPD _ ČástDíla _ Profese _ TypSouboru _ Číslo _ Popis
     OCB    _  DPS     _  SO01    _  ARS    _  VD        _ 101   _ Pudorys-1NP

Writing rules (from CDE): variable position length; no diacritics; codes in UPPERCASE
(except Popis); missing value -> placeholder `X`; in Popis spaces/dots -> `-`,
max 20 characters.

**The document<->node link is not in the name** (CDE has no field for the floor): it is solved by
the explicit column `target_ref` in the manifest `docs.csv` (D-036). Here we only parse
the metadata and derive `role` from `Typ souboru`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

DELIMITER = "_"
PLACEHOLDER = "X"          # CDE: missing value at the position
N_POSITIONS = 7

# Positions (order = order in the name).
POS_PROJECT = "project"
POS_STAGE = "stage"           # Stupeň PD
POS_PART = "part"             # Část Díla
POS_DISCIPLINE = "discipline" # Profese
POS_TYPE = "doc_type"         # Typ souboru
POS_NUMBER = "number"
POS_DESCRIPTION = "description"


# ── Code vocabularies (CDE: diagnostic labels; another project = another vocabulary) ──────

# Stupeň PD: documentation phase (maps our life cycle "design -> construction -> operation").
STAGES: dict[str, str] = {
    "ADS": "Architektonicko-dispozičná štúdia",
    "DPZ": "Dokumentácia pre povolenie zámeru",
    "DPS": "Dokumentácia pre prevedenie stavby",
    "DSPS": "Dokumentácia skutočného prevedenia",
    "PAS": "Pasportná dokumentácia",
    "XX": "Obecný dokument (mimo stupňa PD)",
}

# Profese: discipline (from the project data standard, confirmed by the BEP).
DISCIPLINES: dict[str, str] = {
    "ARS": "Architektúra / pozemné staviteľstvo",
    "STA": "Statika",
    "TZB": "Technika prostredia budov",
    "VZT": "Vzduchotechnika",
    "ZTI": "Zdravotechnika",
    "ELT": "Elektroinštalácie / FVE",
    "POZ": "Požiarna bezpečnosť",
    "STF": "Stavebná fyzika",
    "XX": "Neurčené",
}

# Typ souboru: form of the document (selection from CDE relevant for construction documentation).
DOC_TYPES: dict[str, str] = {
    "VD": "Výkresová dokumentácia",
    "RP": "Report, správa",
    "SP": "Špecifikácia",
    "TL": "Technický list",
    "VV": "Výkaz výmer",
    "KAL": "Kalkulácie, výpočty",
    "SC": "Schéma",
    "DiMS": "Digitálny model stavby",
    "TP": "Technologický predpis",
    "ST": "Štúdia",
    "TAB": "Tabuľka, databáza",
    "XX": "Neurčené",
}

# ISO 19650 states: into `documents.status` (NOT into the name, D-036).
STATUSES: dict[str, str] = {
    "WIP": "Rozpracované (work in progress)",
    "S1": "Zdieľané — vhodné pre koordináciu",
    "S2": "Zdieľané — vhodné pre informovanie",
    "S3": "Zdieľané — interná kontrola",
    "S4": "Zdieľané — vhodné na schválenie",
    "A1": "Publikované — schválené a podpísané",
    "B1": "Publikované — čiastočne podpísané",
    "AB": "Skutočné prevedenie (as-built)",
}

# `rel_associates_document.role` derived from Typ souboru (D-014 / object-type.ts vocab).
# The type is the form of the container; the role is the *relationship* of the document to the node. The mapping is 1:N-safe
# (several types can have the same role) and default = "document".
_TYPE_TO_ROLE: dict[str, str] = {
    "VD": "drawing",
    "RP": "report",
    "SP": "specification",
    "TL": "datasheet",
    "VV": "schedule",
    "KAL": "calculation",
    "SC": "diagram",
    "DiMS": "model",
    "TP": "specification",
    "ST": "study",
    "TAB": "schedule",
}
DEFAULT_ROLE = "document"


@dataclass(frozen=True)
class DocumentMeta:
    """Parsed positional fields of the name + derived values (D-036)."""

    project: Optional[str]
    stage: Optional[str]
    part: Optional[str]
    discipline: Optional[str]
    doc_type: Optional[str]
    number: Optional[str]
    description: Optional[str]
    container_name: str       # original (reconstructed) name without the extension

    @property
    def role(self) -> str:
        """`rel_associates_document.role` from Typ souboru (fallback `document`)."""
        if not self.doc_type:
            return DEFAULT_ROLE
        return _TYPE_TO_ROLE.get(self.doc_type, DEFAULT_ROLE)

    @property
    def stage_label(self) -> Optional[str]:
        return STAGES.get(self.stage) if self.stage else None

    @property
    def discipline_label(self) -> Optional[str]:
        return DISCIPLINES.get(self.discipline) if self.discipline else None

    @property
    def type_label(self) -> Optional[str]:
        return DOC_TYPES.get(self.doc_type) if self.doc_type else None

    def human_description(self) -> Optional[str]:
        """Popis with `-` -> spaces (for `objects.name` / `documents.description`)."""
        if not self.description:
            return None
        return self.description.replace("-", " ").strip() or None

    def unknown_codes(self) -> list[str]:
        """Codes outside the vocabulary: input to the validation report (mini-IDS)."""
        bad: list[str] = []
        if self.stage and self.stage not in STAGES:
            bad.append(f"StupeňPD={self.stage}")
        if self.discipline and self.discipline not in DISCIPLINES:
            bad.append(f"Profese={self.discipline}")
        if self.doc_type and self.doc_type not in DOC_TYPES:
            bad.append(f"TypSouboru={self.doc_type}")
        return bad


def _norm(value: str) -> Optional[str]:
    """Empty / placeholder `X` -> None; otherwise stripped."""
    value = value.strip()
    if not value or value == PLACEHOLDER:
        return None
    return value


def parse_container_name(name: str) -> DocumentMeta:
    """Splits the container name (without extension) into `DocumentMeta`.

    Tolerant to spaces around `_` (the source sometimes has them: `CMSP_DPZ _SO01_...`).
    Missing trailing positions stay None (shorter name = fewer fields); extra fields
    (Popis with `_`) are not merged: Popis is the last position, so we join any
    further `_` in the description back.
    """
    stem = name.rsplit(".", 1)[0] if "." in name else name
    raw = [p.strip() for p in stem.split(DELIMITER)]
    # Can Popis (7th position) contain `_`? CDE says "words separated by `-`", so
    # no, but for robustness we glue the rest into Popis.
    if len(raw) > N_POSITIONS:
        raw = raw[: N_POSITIONS - 1] + [DELIMITER.join(raw[N_POSITIONS - 1 :])]
    raw += [""] * (N_POSITIONS - len(raw))   # fill in missing positions

    project, stage, part, discipline, doc_type, number, description = raw[:N_POSITIONS]
    return DocumentMeta(
        project=_norm(project),
        stage=_norm(stage),
        part=_norm(part),
        discipline=_norm(discipline),
        doc_type=_norm(doc_type),
        number=_norm(number),
        description=_norm(description),
        container_name=DELIMITER.join(
            p if p else PLACEHOLDER for p in raw[:N_POSITIONS]
        ),
    )


def build_container_name(
    *,
    project: str,
    stage: str = PLACEHOLDER,
    part: str = PLACEHOLDER,
    discipline: str = PLACEHOLDER,
    doc_type: str = PLACEHOLDER,
    number: str = PLACEHOLDER,
    description: str = PLACEHOLDER,
) -> str:
    """Composes the canonical container name according to CDE (D-036).

    Popis is cleaned (spaces/dots -> `-`, max 20 characters); the other positions in UPPERCASE.
    """
    def clean_desc(d: str) -> str:
        d = d.strip().replace(" ", "-").replace(".", "-")
        return d[:20].strip("-")

    positions = [
        project.upper(),
        stage.upper(),
        part.upper(),
        discipline.upper(),
        doc_type,                       # DiMS has lowercase letters: keep as-is
        number,
        clean_desc(description),
    ]
    return DELIMITER.join(p if p else PLACEHOLDER for p in positions)
