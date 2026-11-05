"""Coding scheme - field-source resolver + project SNIM definition (D-033).

`object_ref` (D-010 layer 2) is **composed from the project's coding scheme**, not from the IFC
`Tag` (Revit internal number, e.g. `959314` - unstable, unusable for matching
with drawings). The scheme is a set of ordered **typed fields + delimiters**; each
field has a **source descriptor** (`from`), an optional `extract` (regex) and `format` (pad/
case/trim). The same definition drives extraction (ETL: where to read from) and - later -
validation (IDS). No new classification/coding system requires a code change, only
a different scheme definition -> **nothing SNIM-specific is hardcoded outside this file**.

Found from the real IFC of the thesis (`Office centrum Brno.ifc`) and `SNIM - Hierarchia.pdf`:
  - The SNIM code has 6 positions: TSP·PSP | (delim) | UOT | (delim) | INST.
  - The source of the code is the **IFC `Name` of the element** - the cleaned re-export (2026-07-02) bakes
    the full composite code `TSP·PSP[.UOT[.INST]]` into it (door `DD02.05.04`, window `LP01.44`,
    wall `SN07`). We read the segments from `Name` via an `extract` regex. (Until 2026-06 these were
    three separate properties `Assembly Code`/`Type Mark`/`Mark` across psets; the new
    export no longer exports them, but the scheme output is identical - see `_snim_parts`.)
  - **The category (TSP) is determined by the code prefix from `Name`, NOT by the IFC class or the pset name** -
    e.g. both the facade `FS*` and the roof `ST*` occur in the model on `IfcWall`. We tell
    categories apart by TSP (the first 2 characters of the code).
  - **Type entities (`IfcDoorType`...)** - the type-level code (TSP·PSP[.UOT]) is derived from the
    occurrence code (handled by `transform.py`); the instance adds `.INST`.
  - Elements without a SNIM code in `Name` (VZT terminals `60`, uncleaned `Fascia:Atika:...`)
    do not match the regex -> `object_ref` falls back to the GUID (correct - no fictitious code is forced).

Code composition (verified on doors): `Name=DD02.05.04` => TSP·PSP `DD02`, UOT `05`, INST `04`
=> type `DD02.05`, instance `DD02.05.04`. Numeric segments are zero-padded (min. width).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

# Code levels - a type-level field forms the `asset_type` ref, an instance-level one completes the `asset`.
TYPE = "type"
INSTANCE = "instance"


# ── Field-source resolver (project-independent) ──────────────────────────────


@dataclass(frozen=True)
class Field:
    """Descriptor of one code field - where and how to read its value (D-033).

    `source`:
      - ``property``       - a named pset (`pset=`) or across all of them (`pset=None`)
      - ``attribute``      - an IFC attribute (`Name`/`Tag`/`ObjectType`/`Description`/...)
      - ``classification`` - identifier of a reference of system `key` (system+identification)
      - ``type_property``  - a property from `IfcTypeObject` (pset on the type)
    `extract` - regex with one capture group (code baked into text, e.g. `...CC:DD02.05`).
    `pad`     - **minimum** zero-padding width of a numeric field (never truncates a longer value).
    """

    source: str
    key: str
    pset: Optional[str] = None
    extract: Optional[str] = None
    pad: Optional[int] = None
    case: Optional[str] = None          # "upper" | "lower" | None
    trim: bool = True


@dataclass
class FieldContext:
    """Pre-read data of one entity - keeps the resolver pure and testable.

    `transform.py` fills it via ifcopenshell; the resolver here does not depend on ifcopenshell.
    """

    psets: dict[str, dict[str, Any]] = field(default_factory=dict)        # occurrence (+inherited)
    type_psets: dict[str, dict[str, Any]] = field(default_factory=dict)   # IfcTypeObject psets
    attrs: Callable[[str], Any] = lambda _name: None                      # IFC attribute
    classifications: list[tuple[str, str]] = field(default_factory=list)  # (system, identification)


def _scan_psets(psets: dict[str, dict[str, Any]], pset: Optional[str], key: str) -> Any:
    """Value of property `key`: from the named pset, otherwise across all (first match)."""
    if pset is not None:
        block = psets.get(pset)
        if isinstance(block, dict) and block.get(key) not in (None, ""):
            return block.get(key)
        # named pset missing/has no field -> fallback to scanning all (robust against anomalies)
    for block in psets.values():
        if isinstance(block, dict) and block.get(key) not in (None, ""):
            return block.get(key)
    return None


def _raw_value(spec: Field, ctx: FieldContext) -> Any:
    if spec.source == "property":
        return _scan_psets(ctx.psets, spec.pset, spec.key)
    if spec.source == "type_property":
        return _scan_psets(ctx.type_psets, spec.pset, spec.key)
    if spec.source == "attribute":
        return ctx.attrs(spec.key)
    if spec.source == "classification":
        for system, identification in ctx.classifications:
            if system == spec.key:
                return identification
        return None
    raise ValueError(f"Neznámy field source: {spec.source!r}")


def resolve_field(spec: Field, ctx: FieldContext) -> Optional[str]:
    """Return the formatted text value of the field, or None if it is missing."""
    raw = _raw_value(spec, ctx)
    if raw is None:
        return None
    text = str(raw)
    if spec.trim:
        text = text.strip()
    if not text:
        return None
    if spec.extract:
        match = re.search(spec.extract, text)
        if not match:
            return None
        text = match.group(1) if match.groups() else match.group(0)
    if spec.pad and text.isdigit():
        text = text.zfill(spec.pad)        # minimum width - longer values stay as they are
    if spec.case == "upper":
        text = text.upper()
    elif spec.case == "lower":
        text = text.lower()
    return text or None


# ── Composite code (object_ref) ──────────────────────────────────────────────────


@dataclass(frozen=True)
class CodePart:
    """One position of the composite `object_ref`. `level=INSTANCE` belongs only to the asset ref."""

    field: Field
    level: str = TYPE


@dataclass
class ElementScheme:
    """Definition of one category of the coding scheme (e.g. SNIM "Dvere")."""

    tsp: str                          # category key = Assembly Code prefix (e.g. "DD")
    label: str                        # human name ("Dvere")
    applies_to: tuple[str, ...]       # IFC classes where the code is expected (mini-IDS applicability)
    parts: tuple[CodePart, ...]
    delimiter: str = "."

    def _join(self, ctx: FieldContext, max_level: str) -> tuple[Optional[str], list[str]]:
        """Compose the code up to `max_level`. Returns (code|None, missing_fields).

        A type-level field is mandatory (without it there is no code). An instance-level field
        missing at `max_level=INSTANCE` means "code incomplete" -> None + reason.
        """
        out: list[str] = []
        missing: list[str] = []
        for part in self.parts:
            if part.level == INSTANCE and max_level != INSTANCE:
                continue
            value = resolve_field(part.field, ctx)
            if value is None:
                missing.append(part.field.key)
                if part.level == INSTANCE:
                    return None, missing      # missing INST = incomplete instance code
                continue                      # optional type field (e.g. missing UOT)
            out.append(value)
        if not out:
            return None, missing
        return self.delimiter.join(out), missing


@dataclass(frozen=True)
class ScopePolicy:
    """Import scope (D-034) - which IFC elements become an `asset`.

    Principle of D-034: *"asset = what we have an information requirement written for."*
    Structural criterion (IFC-native, independent of coding quality):
      - asset = a **top-level** element (hangs directly in the space: `get_aggregate` =
        space/None) - really manageable units (walls, doors, roofs, slabs,
        VZT terminals, columns, ceilings, the facade as a whole, stairs, furniture);
      - dropped are **voids** (`IfcFeatureElement` = openings) and **sub-components**
        (nested elements - facade mullions/infills/panels, roof layers, stair flights);
      - **exception:** nested `IfcDoor`/`IfcWindow`/`IfcRailing` stay assets - functionally
        they are standalone elements despite the nesting. `IfcRailing` added (D-034 addendum):
        railings/handrails (ZV) and shading (TV) are modelled nested in `IfcStair`,
        but carry their own SNIM code and information requirement - same reason as doors/windows.
        Conversely `IfcSlab` (roof layers, ST) and `IfcStairFlight` (flights, SH) stay
        excluded - those are real sub-components of the assembly (types ST01.* already come from `IfcRoof`).

    Defined as a **policy (config), not hardcoded in `transform.py`** - another project
    = another policy (line of D-033/D-034). The resolver does not depend on ifcopenshell: it gets
    an `is_a` callable (IFC inheritance check) + a `top_level` flag.
    """

    exclude_classes: tuple[str, ...] = ("IfcFeatureElement",)   # openings/voids - never an asset
    # functionally standalone elements even when nested (set in the facade / in the staircase)
    nested_keep: tuple[str, ...] = ("IfcDoor", "IfcWindow", "IfcRailing")
    # MEP "grouping" (D-049): elements where the instance does not matter - imported as asset,
    # but do NOT get spatial containment (do not flood the tree); they are only system members
    # (rel_assigns_to_group). Ducts/fittings/runs. Instance-relevant MEP elements
    # (air terminals, VZT units) do NOT belong here -> they get a floor normally.
    group_only: tuple[str, ...] = (
        "IfcDuctSegment", "IfcDuctFitting",
        "IfcPipeSegment", "IfcPipeFitting",
        "IfcCableSegment", "IfcCableFitting", "IfcCableCarrierSegment", "IfcCableCarrierFitting",
    )

    def is_asset(self, is_a: Callable[[str], bool], top_level: bool) -> bool:
        if any(is_a(cls) for cls in self.exclude_classes):
            return False
        if top_level:
            return True
        return any(is_a(cls) for cls in self.nested_keep)

    def is_group_only(self, is_a: Callable[[str], bool]) -> bool:
        """The element is imported, but without spatial containment (only a system member, D-049)."""
        return any(is_a(cls) for cls in self.group_only)


@dataclass
class CodingScheme:
    """Project scheme: how to recognize the category and compose `object_ref`."""

    name: str
    discriminator: Field              # reads the raw code identifying the category (1st segment of Name)
    discriminator_len: int            # how many characters form the TSP key (SNIM = 2)
    categories: dict[str, ElementScheme]
    scope: ScopePolicy = field(default_factory=ScopePolicy)   # import scope (D-034)

    def applicable_classes(self) -> set[str]:
        """Union of `applies_to` - IFC classes where a SNIM code is expected at all."""
        classes: set[str] = set()
        for cat in self.categories.values():
            classes.update(cat.applies_to)
        return classes

    def category_for(self, ctx: FieldContext) -> tuple[Optional[ElementScheme], Optional[str]]:
        """Find the category by TSP prefix. Returns (category|None, tsp|None)."""
        raw = resolve_field(self.discriminator, ctx)
        if not raw:
            return None, None
        tsp = raw[: self.discriminator_len]
        return self.categories.get(tsp), tsp


# ── SNIM definition of the project "Office centrum Brno" ─────────────────────────────
#
# All SNIM categories share the same composition (TSP·PSP [type] + UOT [type] + INST
# [instance]); they differ in TSP, human name and `applies_to`. We read all three segments
# from the IFC `Name` via an `extract` regex - the full code is baked in there (e.g. `DD02.05.04`).
#
# Padding (D-033 open question - INST width per drawing): both UOT and INST = min. width 2
# (verified on doors `DD02.05.04`; `pad` does not truncate longer values). Adjustable per field.

_TSP_PSP = r"[A-Z]{2}\d{2}"                                       # 1st segment, e.g. DD02, SN07
# Discriminator = 1st segment of the code from Name (TSP·PSP); category_for takes the first 2 characters (TSP).
_ASSEMBLY_CODE = Field(source="attribute", key="Name", extract=rf"^({_TSP_PSP})")
_UOT_PAD = 2
_INST_PAD = 2


def _snim_parts() -> tuple[CodePart, ...]:
    # Code segments from `Name`: `DD02.05.04` -> TSP·PSP `DD02`, UOT `05`, INST `04`.
    return (
        CodePart(_ASSEMBLY_CODE, level=TYPE),
        CodePart(Field(source="attribute", key="Name", extract=rf"^{_TSP_PSP}\.(\d+)", pad=_UOT_PAD), level=TYPE),
        CodePart(Field(source="attribute", key="Name", extract=rf"^{_TSP_PSP}\.\d+\.(\d+)", pad=_INST_PAD), level=INSTANCE),
    )


def _snim_category(tsp: str, label: str, applies_to: tuple[str, ...]) -> ElementScheme:
    return ElementScheme(tsp=tsp, label=label, applies_to=applies_to, parts=_snim_parts())


# `applies_to` = IFC classes on which the given TSP really occurs in the model
# (verified by a scan of the ASR IFC) + meaningful according to `SNIM - Hierarchia.pdf` /
# `SNIM - Výpis skladieb.pdf`. Serves as mini-IDS applicability for the coverage report;
# the code creation itself runs by TSP prefix (across psets), independent of the class.
#
# Categories from `SNIM - Hierarchia.pdf` (8): DD, SN, FS, PH, ST, PD, ZV, KV.
# Added from `SNIM - Výpis skladieb.pdf` + the ASR scan (E2): OV, PL, ZD, DZ, SD, VT,
# SH, LP, IH, TV. The label is diagnostic (coverage report); object.name in the Viewer
# comes from the IFC Name, not from here. The code composition is the same for all (Assembly Code
# [type] + Type Mark [type/UOT] + Mark [instance/INST]); most categories have no
# `Mark` -> the instance goes to the GUID fallback (correct - no instance tag is forced).
SNIM = CodingScheme(
    name="SNIM — Office centrum Brno (diplomka)",
    discriminator=_ASSEMBLY_CODE,
    discriminator_len=2,
    categories={
        # - from Hierarchia.pdf -
        "DD": _snim_category("DD", "Dvere", ("IfcDoor",)),
        "SN": _snim_category("SN", "Steny", ("IfcWall",)),
        "PD": _snim_category("PD", "Podlahy", ("IfcSlab",)),
        "SL": _snim_category("SL", "Stĺpy", ("IfcColumn",)),
        "PH": _snim_category("PH", "Podhľady", ("IfcCovering",)),
        "ST": _snim_category("ST", "Strechy", ("IfcRoof", "IfcSlab", "IfcWall")),
        "FS": _snim_category(
            "FS", "Fasádny systém",
            ("IfcWall", "IfcSlab", "IfcCurtainWall", "IfcMember", "IfcPlate"),
        ),
        "ZV": _snim_category(
            "ZV", "Zámočnícke výrobky",
            ("IfcRailing", "IfcStair", "IfcStairFlight", "IfcBuildingElementProxy"),
        ),
        "KV": _snim_category(
            "KV", "Klampiarske výrobky",
            ("IfcPlate", "IfcCovering", "IfcBuildingElementProxy"),
        ),
        # - added in E2 (Výpis skladieb + ASR scan) -
        "OV": _snim_category(
            "OV", "Otvorové výplne a vybavenie",
            ("IfcFlowTerminal", "IfcFurniture", "IfcCurtainWall"),
        ),
        "PL": _snim_category("PL", "Presklené steny/priečky", ("IfcCurtainWall",)),
        "LP": _snim_category("LP", "Ľahký obvodový plášť (LOP)", ("IfcCurtainWall", "IfcWindow")),
        "ZD": _snim_category("ZD", "Základové dosky", ("IfcSlab", "IfcWall")),
        "DZ": _snim_category("DZ", "Podkladný betón", ("IfcSlab", "IfcWall")),
        "SD": _snim_category("SD", "Stropné dosky", ("IfcSlab",)),
        "IH": _snim_category("IH", "Hydroizolácie spodnej stavby", ("IfcWall", "IfcSlab")),
        "VT": _snim_category("VT", "Vráta", ("IfcDoor",)),
        "SH": _snim_category("SH", "Schodiská", ("IfcStair", "IfcStairFlight", "IfcSlab")),
        "TV": _snim_category("TV", "Tieniaca technika", ("IfcRailing", "IfcBuildingElementProxy")),
    },
)
"""Aktívna schéma projektu. Iný projekt = iná `CodingScheme` (kód sa nemení)."""
