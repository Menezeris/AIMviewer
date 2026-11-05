"""Project of an ETL run (D-189): selection, checks, resolution and project-qualified refs.

A project is the `objects` node with `object_type = 'project'`; its `object_ref` is the project code, which
equals `IfcProject.Name` of every file of the project. IFC defines IfcProject per exchange, so the IfcProject
of every other file maps onto the same node by `Name` and its GlobalId becomes an `ifc_guid_aliases` row.

Rules for projects other than OCB (D-190, Samuel 5 Nov):
- every IFC file name follows the CDE scheme (D-036, `doc_scheme.py`) with type `DiMS` and the project code in
  the first position; OCB's existing files (`ASR.ifc`, `VZT.ifc`) are grandfathered;
- every project-bound `object_ref` (the QR tag, unique across the platform) is `<code>:<ref>`, because several
  projects (for example stages) can hold the same element with the same GUID and SNIM code. The plain ref stays
  in `properties._ref`. Global nodes (person, organization) and the project node itself are not prefixed.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from . import doc_scheme
from .model import StagedModel

# The project that existed before D-189; its refs, file names and archive paths stay as they are.
OCB_CODE = "OCB"
OCB_ID = "9e2dfcba-437b-43d3-a925-0dd29f195b38"

REF_SEPARATOR = ":"
PLAIN_REF_KEY = "_ref"
GLOBAL_OBJECT_TYPES = frozenset({"person", "organization"})
MODEL_FILE_TYPE = "DiMS"
ALIAS_REASON = "IfcProject of another file of the project (D-189)"


class ProjectError(SystemExit):
    """A file or a run does not fit the selected project; the message says what to fix."""


def is_legacy(code: str) -> bool:
    """OCB keeps plain refs, its file names and its archive paths."""
    return code == OCB_CODE


# ── checks on the file (no DB) ─────────────────────────────────────────────────

def ifc_project(model: Any) -> Any:
    """The single IfcProject of the file (IfcSingleProjectInstance)."""
    projects = list(model.by_type("IfcProject"))
    if len(projects) != 1:
        raise ProjectError(f"The IFC file must contain exactly one IfcProject, found {len(projects)} (D-189).")
    return projects[0]


def check_file(model: Any, code: str, file_name: Optional[str] = None) -> Any:
    """`IfcProject.Name` must equal the project code; returns the IfcProject."""
    project = ifc_project(model)
    name = (getattr(project, "Name", None) or "").strip()
    if name != code:
        where = f" in {file_name}" if file_name else ""
        raise ProjectError(
            f"IfcProject.Name{where} is '{name or '(empty)'}', but the run is for project '{code}'. "
            f"Every file of a project must carry its code in IfcProject.Name (D-189); "
            f"use --project {name} or fix the file." if name else
            f"IfcProject.Name{where} is empty; it must be the project code '{code}' (D-189)."
        )
    return project


def _stem(file_name: str) -> str:
    stem = Path(file_name).name
    for suffix in (".gz", ".ifc", ".ifczip"):
        if stem.lower().endswith(suffix):
            stem = stem[: -len(suffix)]
    return stem


def check_file_name(file_name: str, code: str) -> list[str]:
    """CDE file name of a model (D-036 scheme, D-190). Raises on a broken rule, returns warnings
    (codes outside the vocabulary of `doc_scheme.py`, which is per project). OCB is grandfathered."""
    if is_legacy(code):
        return []
    stem = _stem(file_name)
    pattern = f"{code}_<stage>_<part>_<discipline>_{MODEL_FILE_TYPE}_<number>_<description>.ifc"
    parts = stem.split(doc_scheme.DELIMITER)
    if len(parts) != doc_scheme.N_POSITIONS or not all(p.strip() for p in parts):
        raise ProjectError(
            f"File name '{Path(file_name).name}' does not follow the CDE scheme (D-036): expected "
            f"{doc_scheme.N_POSITIONS} positions separated by '_', for example {pattern}."
        )
    meta = doc_scheme.parse_container_name(stem)
    if meta.project != code:
        raise ProjectError(
            f"File name '{Path(file_name).name}' starts with project '{meta.project}', expected '{code}' ({pattern})."
        )
    if meta.doc_type != MODEL_FILE_TYPE:
        raise ProjectError(
            f"File name '{Path(file_name).name}' has type '{meta.doc_type}', a model must be "
            f"'{MODEL_FILE_TYPE}' ({pattern})."
        )
    return meta.unknown_codes()


# ── project-qualified refs ─────────────────────────────────────────────────────

def qualify(ref: str, code: str) -> str:
    return ref if is_legacy(code) or ref == code else f"{code}{REF_SEPARATOR}{ref}"


def qualify_refs(staged: StagedModel, code: str) -> None:
    """Rewrite every project-bound ref of the staged model to `<code>:<ref>` (no-op for OCB).

    Refs of global nodes (person, organization) stay, so an actor shared by projects stays one node; the
    project node keeps the code. Edge endpoints that are not in this run (federation into an existing
    structure) are project-bound by construction and get the same prefix."""
    if is_legacy(code):
        return
    global_refs = {o.object_ref for o in staged.objects if o.object_type in GLOBAL_OBJECT_TYPES}

    def q(ref: Optional[str]) -> Optional[str]:
        if ref is None or ref in global_refs:
            return ref
        return qualify(ref, code)

    for o in staged.objects:
        if o.object_type in GLOBAL_OBJECT_TYPES or o.object_ref == code:
            continue
        o.properties = {**(o.properties or {}), PLAIN_REF_KEY: o.object_ref}
        o.object_ref = qualify(o.object_ref, code)
        if o.document is not None and o.document.referenced_document_ref:
            o.document.referenced_document_ref = q(o.document.referenced_document_ref)
    for e in staged.edges:
        e.from_ref, e.to_ref = q(e.from_ref), q(e.to_ref)
    for c in staged.class_links:
        c.from_ref = q(c.from_ref)
    for g in staged.guid_history:
        g.object_ref = q(g.object_ref)
    for a in staged.guid_aliases:
        a.object_ref = q(a.object_ref)
    staged.link_classes = {q(k): v for k, v in staged.link_classes.items()}


# ── DB ──────────────────────────────────────────────────────────────────────────

def resolve(cur, code: str) -> Optional[str]:
    """Id of the project node with this code, or None when the project does not exist yet."""
    row = cur.execute(
        "select id from objects where object_type = 'project' and object_ref = %s and valid_until is null",
        (code,),
    ).fetchone()
    return str(row[0]) if row else None


def require(cur, code: str) -> str:
    """Id of an existing project; tools other than the model load never create a project."""
    pid = resolve(cur, code)
    if pid is None:
        raise ProjectError(
            f"Project '{code}' does not exist. A project is created by its first model load "
            f"(python -m etl.main --file <ifc> --project {code}), D-189."
        )
    return pid
