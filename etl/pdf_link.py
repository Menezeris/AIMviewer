"""PDF drawing auto-linking - element <-> drawing from the PDF content (E4, D-032/D-033).

The CDE name of a document (E3, D-036) deliberately **does not carry** a link to a specific element -
that comes only from the **content of the drawing**. Here we scan the PDF floor plans, detect SNIM
codes (`scheme.py`) and create `rel_associates_document(element -> drawing)`. The 1NP floor plan is
thus automatically linked to the types/instances of the elements in it.

Pipeline (D-033):
  1. PyMuPDF (`fitz`) - words + bounding boxes from every page.
  2. Code detection by a regex **derived from the scheme** (valid TSP prefixes from `SNIM`).
     A bubble on the drawing is not always a single string (`SN11` and `01` separately) -> **proximity
     match**: a bare Assembly Code is joined with a nearby numeric fragment.
  3. Match to `object_ref` in the DB (type `DD01.06` and instance `DD01.06.03` alike).
  4. `rel_associates_document(from=element, to=drawing, role='drawing', source='pdf_link (E4)')`.
  5. Link regions (D-042): per match a bbox + target is stored in `objects.properties.
     _drawing_links` (JSONB, `_` key = the D-022 convention, NO migration). Coordinates
     in PDF bottom-left (y-flip once, at the source). **One pipeline** - the same detection
     fills the edges (E4) and the regions (D-042), no second detection logic.

Input = the drawing PDF -> document mapping (`object_ref` from E3). Taken from `docs.csv`
(rows with TypSouboru `VD`); path to the PDF = `source_path`, target document = `container_name`.

`--dry-run` = detection + coverage report (no write). Idempotent
(deterministic edge UUIDs, `ids.py`). This is NOT an IDS validation - only coverage.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
import psycopg

from . import ids
from . import project as project_mod
from .config import database_url, project_code
from .doc_scheme import parse_container_name
from .scheme import SNIM, CodingScheme

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SOURCE_ROOT = _REPO_ROOT / "podklady" / "FINAL"
_MANIFEST = _REPO_ROOT / "podklady" / "docs.csv"

LINK_ROLE = "drawing"
LINK_SOURCE = "pdf_link (E4)"

# Proximity threshold for joining a bare code with a numeric fragment (in PDF points,
# 1 pt ~ 0.35 mm). An element bubble has the code and the Mark close together; tuned on the drawing.
PROXIMITY_PT = 28.0

# -- Assemblies (composition marks S#, D-043) -----------------------------------
# Drawings also carry **assembly marks** (`S1`-`S9`, hexagonal bubbles) - references to the
# construction assemblies defined in the "Výpis skladieb" (the assembly schedule; one document, each assembly
# = one page). They have no element of their own in the DB (D-043 option C): the bubble is not linked
# to an object but **to the schedule document opened on the page of that assembly**
# (`target_route='drawing'`, `target_page`). No edge - a pure navigation region.
_VYPIS_CONTAINER = "OCB_DPS_SO01_ARS_VV_109_Vypis-skladieb"
_SKLADBA_RE = re.compile(r"^S[1-9]$")
# The assembly name in the schedule always starts with "Skladba ..." right next to the mark - an anchor that
# tells the true mark from textual occurrences of "S4" in the material specification (e.g. the strip
# "PV 200 S4 N"). Mark = the `S#` that has the token "Skladba" to its right on the same line.
_SKLADBA_NAME_PREFIX = "Skladba"
SKLADBA_LAYER = "skladba"
SKLADBA_ROUTE = "drawing"


@dataclass(frozen=True)
class CodeMatcher:
    """Detector of SNIM codes derived from `CodingScheme` (no hardcode outside the scheme)."""

    scheme: CodingScheme

    @property
    def tsp_prefixes(self) -> set[str]:
        return set(self.scheme.categories.keys())

    @property
    def _full_re(self) -> re.Pattern:
        # Assembly Code (2 letters + digits) + at least one `.digit` group.
        return re.compile(r"^[A-Z]{2}\d{2}(?:\.\d+)+$")

    @property
    def _bare_re(self) -> re.Pattern:
        # Bare Assembly Code without a Type Mark (e.g. `DD01`, `SN11`).
        return re.compile(r"^[A-Z]{2}\d{2}$")

    @property
    def _frag_re(self) -> re.Pattern:
        # Numeric fragment (Type Mark / Mark), possibly composed `06.03`.
        return re.compile(r"^\d{1,2}(?:\.\d{1,2})*$")

    def valid_tsp(self, code: str) -> bool:
        return code[:2] in self.tsp_prefixes


@dataclass
class Hit:
    """One detected code on a page + its origin (for report/debug).

    `origin` sets the **trust tier of the match** (D-041):
      - ``full``      - the whole code with the printed dot (`PD02.31`, `DD01.06.03`); trustworthy
                        evidence of intent -> exact match, no match = a real gap (report it).
      - ``proximity`` - assembled from two nearby tokens (bare code + numeric fragment);
                        **a heuristic guess** -> exact match, no match = noise (dimensions/axes) -> drop it.
      - ``bare``      - a bare Assembly Code without a Mark (`SN11`, `FS01`); **prefix match** on
                        types `SN11.*` (the drawing shows an element type, not a specific instance).
    """

    code: str
    page: int
    origin: str          # "full" | "proximity" | "bare"
    bbox: tuple[float, float, float, float]   # PyMuPDF top-left coords (x0, y0, x1, y1)
    page_size: tuple[float, float]            # (width, height) v bodoch


# Page word: text + bbox (x0, y0, x1, y1) in PyMuPDF top-left coordinates.
Word = tuple[str, float, float, float, float]


@dataclass
class PageWords:
    """Words of a page with bbox (x0, y0, x1, y1) + the page size - the input of proximity match."""

    words: list[Word] = field(default_factory=list)
    width: float = 0.0
    height: float = 0.0


def _center(w: Word) -> tuple[float, float]:
    return ((w[1] + w[3]) / 2, (w[2] + w[4]) / 2)


def _page_words(page: "fitz.Page") -> PageWords:
    rect = page.rect      # reflects the page rotation; words are in the same space
    out: list[Word] = []
    for x0, y0, x1, y1, text, *_ in page.get_text("words"):
        out.append((text, x0, y0, x1, y1))
    return PageWords(out, rect.width, rect.height)


def detect_codes(page: "fitz.Page", page_no: int, m: CodeMatcher) -> list[Hit]:
    """Detects codes on a page: direct (with a dot) + proximity (bare + fragment).

    Every `Hit` carries a bbox (top-left) + the page size - from it the y-flip to PDF bottom-left
    for `_drawing_links` is done later (at the source) (D-042).
    """
    pw = _page_words(page)
    ps = (pw.width, pw.height)
    hits: list[Hit] = []

    # 1) direct whole codes (`PD02.31`, `PH01.10`)
    for w in pw.words:
        text = w[0]
        if m._full_re.match(text) and m.valid_tsp(text):
            hits.append(Hit(text, page_no, "full", (w[1], w[2], w[3], w[4]), ps))

    # 2) proximity - bare Assembly Code + the nearest numeric fragment
    bares = [w for w in pw.words if m._bare_re.match(w[0]) and m.valid_tsp(w[0])]
    frags = [w for w in pw.words if m._frag_re.match(w[0])]
    for bw in bares:
        bx, by = _center(bw)
        # the nearest fragment within PROXIMITY_PT
        best: Optional[tuple[Word, float]] = None
        for fw in frags:
            fx, fy = _center(fw)
            dist = ((fx - bx) ** 2 + (fy - by) ** 2) ** 0.5
            if dist <= PROXIMITY_PT and (best is None or dist < best[1]):
                best = (fw, dist)
        if best is not None:
            fw = best[0]
            # bbox = union of the bubble code and its fragment (Mark)
            ubbox = (min(bw[1], fw[1]), min(bw[2], fw[2]),
                     max(bw[3], fw[3]), max(bw[4], fw[4]))
            hits.append(Hit(f"{bw[0]}.{fw[0]}", page_no, "proximity", ubbox, ps))
        else:
            # bare code without a fragment - prefix match on types `bt.*` (D-041)
            hits.append(Hit(bw[0], page_no, "bare", (bw[1], bw[2], bw[3], bw[4]), ps))
    return hits


# -- Assembly marks (S#) ---------------------------------------------------------


@dataclass
class SkladbaHit:
    """One detected assembly mark (`S#`) on a drawing page (D-043 C)."""

    mark: str
    page: int
    bbox: tuple[float, float, float, float]    # PyMuPDF top-left (x0, y0, x1, y1)
    page_size: tuple[float, float]


def detect_skladby(page: "fitz.Page", page_no: int, marks: set[str]) -> list[SkladbaHit]:
    """Finds occurrences of the known assembly marks (`marks`) as separate tokens.

    `marks` = the set of valid marks from the schedule (e.g. `{S1, S2, ...}`) -> without a whitelist
    `S#` from the text would be caught too. Every occurrence = its own clickable region (as with codes).
    """
    pw = _page_words(page)
    ps = (pw.width, pw.height)
    out: list[SkladbaHit] = []
    for w in pw.words:
        if w[0] in marks:
            out.append(SkladbaHit(w[0], page_no, (w[1], w[2], w[3], w[4]), ps))
    return out


# -- Manifest (drawing PDF -> document object_ref) -----------------------------


@dataclass(frozen=True)
class DrawingRow:
    source_path: str
    container_name: str    # object_ref dokumentu (z E3)


def read_drawings() -> list[DrawingRow]:
    """Manifest rows that are drawings (TypSouboru = VD)."""
    if not _MANIFEST.exists():
        raise SystemExit(f"Chýba manifest {_MANIFEST}")
    out: list[DrawingRow] = []
    with _MANIFEST.open(encoding="utf-8-sig") as fh:
        # utf-8-sig because of a possible BOM from Excel (same as doc_upload.read_manifest)
        reader = csv.DictReader(line for line in fh if not line.startswith("#"))
        for r in reader:
            cn = r["container_name"].strip()
            if parse_container_name(cn).doc_type == "VD":
                out.append(DrawingRow(r["source_path"].strip(), cn))
    return out


def read_skladby() -> dict[str, int]:
    """Map assembly mark -> page in the "Výpis skladieb" (`S#` -> 1-based page, D-043).

    Finds the schedule in the manifest, opens the PDF and on every page finds the mark `S#` that
    has the token "Skladba" to its right on the same line (an anchor - tells the true mark from `S4`
    in the material specification). An empty map = the schedule is missing (assemblies are simply not linked).
    """
    src: Optional[str] = None
    if _MANIFEST.exists():
        with _MANIFEST.open(encoding="utf-8") as fh:
            reader = csv.DictReader(line for line in fh if not line.startswith("#"))
            for r in reader:
                if r["container_name"].strip() == _VYPIS_CONTAINER:
                    src = r["source_path"].strip()
                    break
    if not src:
        return {}
    pdf_path = _SOURCE_ROOT / src
    if not pdf_path.exists():
        return {}
    out: dict[str, int] = {}
    doc = fitz.open(pdf_path)
    for i in range(doc.page_count):
        # PyMuPDF word = (x0, y0, x1, y1, text, block, line, word_no)
        words = [(w[4], w[0], w[1], w[2], w[3]) for w in doc[i].get_text("words")]
        for text, x0, y0, x1, y1 in words:
            if not _SKLADBA_RE.match(text):
                continue
            cy = (y0 + y1) / 2
            # The true mark has the name "Skladba ..." in its header (the same or
            # the immediately following line). Textual occurrences of "S4" in the materials table are
            # far from "Skladba" -> a vertical band filters them out reliably.
            if any(
                name.startswith(_SKLADBA_NAME_PREFIX) and abs((b0 + b1) / 2 - cy) < 18
                for name, a0, b0, a1, b1 in words
            ):
                out[text] = i + 1
    return out


# -- Matching to the DB + writing edges ---------------------------------------


def _load_refs(cur, project_id: str = project_mod.OCB_ID) -> dict[str, tuple[str, str]]:
    """Plain ref (SNIM code as printed on the drawing) -> (id, object_type) for the project's asset/asset_type.
    Outside OCB the object_ref carries `<code>:` and the plain ref is `properties._ref` (D-189)."""
    rows = cur.execute(
        "select coalesce(properties->>'_ref', object_ref), id, object_type from objects "
        "where object_type in ('asset','asset_type') and project_id = %s",
        (project_id,),
    ).fetchall()
    return {r[0]: (r[1], r[2]) for r in rows}


def _types_by_assembly(refs: dict[str, tuple[str, str]]) -> dict[str, list[str]]:
    """Assembly Code (`OV01`) -> ids of types `OV01.*` - for prefix match of bare codes.

    The Assembly Code is always the first dot segment of `object_ref`; the prefix match targets **only types**
    (`asset_type`), because a bare code on a drawing identifies an element type, not a specific
    instance (that would need a Mark, which is missing on the bubble).
    """
    out: dict[str, list[str]] = {}
    for ref, (oid, otype) in refs.items():
        if otype != "asset_type":
            continue
        assembly = ref.split(".", 1)[0]
        out.setdefault(assembly, []).append(oid)
    return out


def _doc_id(cur, container_name: str) -> Optional[str]:
    row = cur.execute(
        "select id from objects where object_ref = %s and object_type = 'document'",
        (container_name,),
    ).fetchone()
    return row[0] if row else None


def _to_bottom_left(bbox: tuple[float, float, float, float],
                    page_size: tuple[float, float]) -> list[float]:
    """PyMuPDF top-left bbox -> PDF bottom-left (y grows up). Does the y-flip once, at the source."""
    x0, y0, x1, y1 = bbox
    _w, h = page_size
    return [round(x0, 2), round(h - y1, 2), round(x1, 2), round(h - y0, 2)]


def _route_for(object_type: str) -> str:
    """object_type -> route segment (in line with the app: `asset_type` -> /type, otherwise /node)."""
    return "type" if object_type == "asset_type" else "node"


def _write_links(cur, doc_id: str, regions: list[dict]) -> None:
    """Rewrites the document's `_drawing_links` blob (idempotent, other properties untouched)."""
    cur.execute(
        """
        update objects
        set properties = jsonb_set(coalesce(properties, '{}'::jsonb),
                                   '{_drawing_links}', %s::jsonb, true),
            updated_at = now()
        where id = %s
        """,
        (json.dumps(regions, ensure_ascii=False), doc_id),
    )


def _link(cur, from_id: str, doc_id: str, dry: bool) -> None:
    if dry:
        return
    # rel_associates_document(from=element, to=drawing) - keeps the D-014 direction (object -> document).
    # D-051: we write into the generic `relationships` (rel_type), not into the canonical view.
    # psycopg returns UUID columns as uuid.UUID -> edge_id works with strings
    eid = ids.edge_id(str(from_id), str(doc_id), "has_document")
    cur.execute(
        """
        insert into relationships
          (id, rel_type, from_id, to_id, role, valid_from, valid_until, source)
        values (%s, 'rel_associates_document', %s, %s, %s, now(), null, %s)
        on conflict (id) do update set role = excluded.role, source = excluded.source
        """,
        (eid, from_id, doc_id, LINK_ROLE, LINK_SOURCE),
    )


@dataclass
class DrawingResult:
    container_name: str
    detected: int
    matched: int                     # number of linked elements (= number of regions)
    regions: int                     # number of link regions in `_drawing_links` (including assemblies)
    unmatched_codes: set[str]        # real gaps: `full`/`bare` without a match (report)
    dropped_proximity: set[str]      # proximity guess without a target in the DB (noise/out of scope) -> dropped
    skladba_regions: int = 0         # of which navigation regions of assemblies (S#, D-043 C)


def process_drawing(
    cur, row: DrawingRow, m: CodeMatcher, refs: dict, types_by_assembly: dict, dry: bool,
    skladby: Optional[dict] = None, vypis_doc_id: Optional[str] = None,
    code: str = project_mod.OCB_CODE,
) -> DrawingResult:
    pdf_path = _SOURCE_ROOT / row.source_path
    if not pdf_path.exists():
        raise SystemExit(f"PDF chýba: {row.source_path}")
    doc_id = _doc_id(cur, project_mod.qualify(row.container_name, code))
    if doc_id is None:
        raise SystemExit(
            f"dokument '{row.container_name}' nie je v DB — najprv spusti doc_upload (E3)."
        )

    # collecting matches with bbox; ordered by trust (full > proximity > bare), so that for the same
    # **physical occurrence** the most trustworthy tier wins
    doc = fitz.open(pdf_path)
    hits: list[Hit] = []
    for i in range(doc.page_count):
        hits.extend(detect_codes(doc[i], i + 1, m))
    _order = {"full": 0, "proximity": 1, "bare": 2}
    hits.sort(key=lambda h: _order[h.origin])

    # A region = one **physical occurrence** of a code (a clickable hotspot), NOT one element:
    # the same `object_ref` repeats on a drawing (e.g. `ST01.21` 4x) and every occurrence
    # must be clickable. So dedupe at the level (page, bbox, target) - not the target.
    # `rel_associates_document` stays 1 edge per element (a semantic link) -> `matched_ids`.
    regions: list[dict] = []
    seen: set[tuple] = set()          # (page, bbox, target_id) - against exact duplicates
    matched_ids: set[str] = set()     # targets for edges (dedupe at the element level)
    unmatched: set[str] = set()
    dropped: set[str] = set()

    def add_region(target_id: str, object_type: str, hit: Hit) -> None:
        tid = str(target_id)
        matched_ids.add(tid)          # the edge is created once per element (however many regions)
        bbox = _to_bottom_left(hit.bbox, hit.page_size)
        key = (hit.page, tuple(bbox), tid)
        if key in seen:
            return                    # the same occurrence already has a region (full before proximity)
        seen.add(key)
        regions.append({
            "page": hit.page,
            "bbox": bbox,
            "page_size": [round(hit.page_size[0], 2), round(hit.page_size[1], 2)],
            "target_id": tid,
            "target_route": _route_for(object_type),
            "layer": hit.origin,
            "label": hit.code,
        })

    for hit in hits:
        if hit.origin == "bare":
            # prefix match of a bare Assembly Code on types `code.*` (D-041)
            type_ids = types_by_assembly.get(hit.code)
            if type_ids:
                for tid in type_ids:
                    add_region(tid, "asset_type", hit)
            else:
                unmatched.add(hit.code)       # unknown Assembly Code without a type in the DB
        else:
            # exact match (full + proximity); on a mismatch the origin decides
            ref = refs.get(hit.code)
            if ref is not None:
                add_region(ref[0], ref[1], hit)
            elif hit.origin == "full":
                unmatched.add(hit.code)       # a printed code without an element = a real gap
            else:
                dropped.add(hit.code)         # a proximity guess without a match = noise -> drop

    # Assembly marks (S#) -> navigation regions to the "Výpis skladieb" (D-043 C). No edges
    # (an assembly has no node of its own): target = the schedule document, opened on the assembly page.
    skladba_count = 0
    if skladby and vypis_doc_id:
        marks = set(skladby)
        for i in range(doc.page_count):
            for sh in detect_skladby(doc[i], i + 1, marks):
                bbox = _to_bottom_left(sh.bbox, sh.page_size)
                key = (sh.page, tuple(bbox), sh.mark)   # mark in the key (the target is one document)
                if key in seen:
                    continue
                seen.add(key)
                regions.append({
                    "page": sh.page,
                    "bbox": bbox,
                    "page_size": [round(sh.page_size[0], 2), round(sh.page_size[1], 2)],
                    "target_id": str(vypis_doc_id),
                    "target_route": SKLADBA_ROUTE,
                    "target_page": skladby[sh.mark],
                    "layer": SKLADBA_LAYER,
                    "label": sh.mark,
                })
                skladba_count += 1

    if not dry:
        for from_id in matched_ids:
            _link(cur, from_id, doc_id, dry)
        _write_links(cur, doc_id, regions)

    detected = len({h.code for h in hits})
    return DrawingResult(
        row.container_name, detected, len(matched_ids), len(regions), unmatched, dropped,
        skladba_count,
    )


# ── CLI ───────────────────────────────────────────────────────────────────────


def main(argv: Optional[list[str]] = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser(description="PDF výkres auto-linking (E4, D-033).")
    ap.add_argument("--dry-run", action="store_true",
                    help="detekcia + coverage, žiadny zápis do DB.")
    ap.add_argument("--show-unmatched", action="store_true",
                    help="vypíš kódy detegované vo výkrese bez zhody v DB (ladenie).")
    ap.add_argument("--project", metavar="CODE", help="project code (D-189); default env AIM_PROJECT or OCB")
    args = ap.parse_args(argv)
    code = project_code(args.project)

    matcher = CodeMatcher(SNIM)
    drawings = read_drawings()
    skladby = read_skladby()
    print(f"Výkresy v manifeste (VD): {len(drawings)}")
    print(f"Skladby z Výpisu (S# → strana): {skladby or '— (Výpis nenájdený)'}")

    total_links = 0
    total_regions = 0
    total_skladby = 0
    with psycopg.connect(database_url()) as conn:
        with conn.cursor() as cur:
            refs = _load_refs(cur, project_mod.require(cur, code))
            types_by_assembly = _types_by_assembly(refs)
            vypis_doc_id = _doc_id(cur, project_mod.qualify(_VYPIS_CONTAINER, code)) if skladby else None
            if skladby and vypis_doc_id is None:
                print(f"  ! Výpis '{_VYPIS_CONTAINER}' nie je v DB — skladby sa nelinkujú.")
            print(f"object_ref v DB (asset/type): {len(refs)}\n")
            for row in drawings:
                res = process_drawing(
                    cur, row, matcher, refs, types_by_assembly, args.dry_run,
                    skladby, vypis_doc_id, code,
                )
                total_links += res.matched
                total_regions += res.regions
                total_skladby += res.skladba_regions
                print(f"  {res.container_name:46s} detegovaných {res.detected:3d} "
                      f"→ zhoda {res.matched:3d} prvkov | regiónov {res.regions:3d} "
                      f"(z toho skladby {res.skladba_regions:2d})")
                if args.show_unmatched and res.unmatched_codes:
                    print(f"      bez zhody (medzera): {sorted(res.unmatched_codes)}")
                if args.show_unmatched and res.dropped_proximity:
                    print(f"      ignorované proximity (bez prvku v DB): "
                          f"{sorted(res.dropped_proximity)}")
        if args.dry_run:
            conn.rollback()
            print(f"\nSúčet: {total_links} prvkov / {total_regions} regiónov "
                  f"(z toho {total_skladby} skladbových) (--dry-run → do DB sa nezapisuje).")
        else:
            conn.commit()
            print(f"\nHotovo: {total_links} element-väzieb (role='{LINK_ROLE}') + "
                  f"{total_regions} link-regiónov ({total_skladby} skladbových) "
                  f"v _drawing_links zapísaných.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
