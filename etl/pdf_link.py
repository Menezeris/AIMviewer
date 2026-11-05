"""PDF výkres auto-linking — element ↔ výkres z obsahu PDF (E4, D-032/D-033).

CDE názov dokumentu (E3, D-036) zámerne **nenesie** väzbu na konkrétny prvok —
tá sa získa až z **obsahu výkresu**. Tu skenujeme PDF pôdorysy, detegujeme SNIM
kódy (`scheme.py`) a vytvoríme `rel_associates_document(prvok → výkres)`. Pôdorys 1NP sa
tak automaticky prepojí na typy/inštancie prvkov v ňom.

Pipeline (D-033):
  1. PyMuPDF (`fitz`) — slová + bounding boxy z každej strany.
  2. Detekcia kódov regexom **odvodeným zo schémy** (platné TSP prefixy z `SNIM`).
     Bublina na výkrese nie je vždy jeden reťazec (`SN11` a `01` zvlášť) → **proximity
     match**: holý Assembly Code sa spojí s blízkym číselným fragmentom.
  3. Match na `object_ref` v DB (typové `DD01.06` aj inštančné `DD01.06.03`).
  4. `rel_associates_document(from=prvok, to=výkres, role='drawing', source='pdf_link (E4)')`.
  5. Link regióny (D-042): per zhoda sa uloží bbox + cieľ do `objects.properties.
     _drawing_links` (JSONB, `_`-kľúč = konvencia D-022, BEZ migrácie). Súradnice
     v PDF bottom-left (y-flip raz, na zdroji). **Jeden pipeline** — tá istá detekcia
     plní hrany (E4) aj regióny (D-042), žiadna druhá detekčná logika.

Vstup = mapovanie výkres-PDF → dokument (`object_ref` z E3). Berie sa z `docs.csv`
(riadky s TypSouboru `VD`); cesta k PDF = `source_path`, cieľový dokument = `container_name`.

`--dry-run` = detekcia + coverage report (žiadny zápis). Idempotentné
(deterministické UUID hrán, `ids.py`). NIE je to IDS validácia — len pokrytie.
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

# Proximity práh pre spojenie holého kódu s číselným fragmentom (v bodoch PDF,
# 1 pt ≈ 0.35 mm). Bublina prvku má kód a Mark blízko seba; ladí sa na výkrese.
PROXIMITY_PT = 28.0

# ── Skladby (kompozičné značky S#, D-043) ─────────────────────────────────────
# Výkresy nesú aj **skladbové značky** (`S1`–`S9`, hexagónové bubliny) — odkazy na
# skladby konštrukcií definované vo „Výpise skladieb" (jeden dokument, každá skladba
# = jedna strana). Nemajú vlastný prvok v DB (D-043 možnosť C): bublina sa nelinkuje
# na objekt, ale **na dokument Výpis skladieb otvorený na strane danej skladby**
# (`target_route='drawing'`, `target_page`). Žiadna hrana — čistý navigačný región.
_VYPIS_CONTAINER = "OCB_DPS_SO01_ARS_VV_109_Vypis-skladieb"
_SKLADBA_RE = re.compile(r"^S[1-9]$")
# Názov skladby vo Výpise vždy začína „Skladba …" hneď vedľa značky — kotva, ktorá
# odlíši pravú značku od textových výskytov „S4" v špecifikácii materiálu (napr. pás
# „PV 200 S4 N"). Mark = ten `S#`, ktorý má v tom istom riadku napravo token „Skladba".
_SKLADBA_NAME_PREFIX = "Skladba"
SKLADBA_LAYER = "skladba"
SKLADBA_ROUTE = "drawing"


@dataclass(frozen=True)
class CodeMatcher:
    """Detektor SNIM kódov odvodený z `CodingScheme` (žiadny hardcode mimo schémy)."""

    scheme: CodingScheme

    @property
    def tsp_prefixes(self) -> set[str]:
        return set(self.scheme.categories.keys())

    @property
    def _full_re(self) -> re.Pattern:
        # Assembly Code (2 písmená + číslice) + aspoň jedna `.číslica` skupina.
        return re.compile(r"^[A-Z]{2}\d{2}(?:\.\d+)+$")

    @property
    def _bare_re(self) -> re.Pattern:
        # Holý Assembly Code bez Type Mark (napr. `DD01`, `SN11`).
        return re.compile(r"^[A-Z]{2}\d{2}$")

    @property
    def _frag_re(self) -> re.Pattern:
        # Číselný fragment (Type Mark / Mark), príp. zložený `06.03`.
        return re.compile(r"^\d{1,2}(?:\.\d{1,2})*$")

    def valid_tsp(self, code: str) -> bool:
        return code[:2] in self.tsp_prefixes


@dataclass
class Hit:
    """Jeden detegovaný kód na strane + jeho pôvod (pre report/debug).

    `origin` určuje **dôverovú vrstvu matchu** (D-041):
      • ``full``      — celý kód s vytlačenou bodkou (`PD02.31`, `DD01.06.03`); dôveryhodný
                        dôkaz zámeru → exact match, bez zhody = reálna medzera (reportuj).
      • ``proximity`` — poskladaný z dvoch blízkych tokenov (holý kód + číselný fragment);
                        **heuristický odhad** → exact match, bez zhody = šum (kóty/osi) → zahoď.
      • ``bare``      — holý Assembly Code bez Marku (`SN11`, `FS01`); **prefix-match** na
                        typy `SN11.*` (výkres ukazuje typ prvku, nie konkrétnu inštanciu).
    """

    code: str
    page: int
    origin: str          # "full" | "proximity" | "bare"
    bbox: tuple[float, float, float, float]   # PyMuPDF top-left coords (x0, y0, x1, y1)
    page_size: tuple[float, float]            # (width, height) v bodoch


# Slovo strany: text + bbox (x0, y0, x1, y1) v PyMuPDF top-left súradniciach.
Word = tuple[str, float, float, float, float]


@dataclass
class PageWords:
    """Slová strany s bbox (x0, y0, x1, y1) + rozmer strany — vstup proximity matchu."""

    words: list[Word] = field(default_factory=list)
    width: float = 0.0
    height: float = 0.0


def _center(w: Word) -> tuple[float, float]:
    return ((w[1] + w[3]) / 2, (w[2] + w[4]) / 2)


def _page_words(page: "fitz.Page") -> PageWords:
    rect = page.rect      # reflektuje rotáciu strany; words sú v rovnakom priestore
    out: list[Word] = []
    for x0, y0, x1, y1, text, *_ in page.get_text("words"):
        out.append((text, x0, y0, x1, y1))
    return PageWords(out, rect.width, rect.height)


def detect_codes(page: "fitz.Page", page_no: int, m: CodeMatcher) -> list[Hit]:
    """Deteguje kódy na strane: priame (s bodkou) + proximity (holý + fragment).

    Každý `Hit` nesie bbox (top-left) + rozmer strany — z toho sa neskôr (na zdroji)
    spraví y-flip do PDF bottom-left pre `_drawing_links` (D-042).
    """
    pw = _page_words(page)
    ps = (pw.width, pw.height)
    hits: list[Hit] = []

    # 1) priame celé kódy (`PD02.31`, `PH01.10`)
    for w in pw.words:
        text = w[0]
        if m._full_re.match(text) and m.valid_tsp(text):
            hits.append(Hit(text, page_no, "full", (w[1], w[2], w[3], w[4]), ps))

    # 2) proximity — holý Assembly Code + najbližší číselný fragment
    bares = [w for w in pw.words if m._bare_re.match(w[0]) and m.valid_tsp(w[0])]
    frags = [w for w in pw.words if m._frag_re.match(w[0])]
    for bw in bares:
        bx, by = _center(bw)
        # najbližší fragment v okruhu PROXIMITY_PT
        best: Optional[tuple[Word, float]] = None
        for fw in frags:
            fx, fy = _center(fw)
            dist = ((fx - bx) ** 2 + (fy - by) ** 2) ** 0.5
            if dist <= PROXIMITY_PT and (best is None or dist < best[1]):
                best = (fw, dist)
        if best is not None:
            fw = best[0]
            # bbox = zjednotenie bublinového kódu a jeho fragmentu (Mark)
            ubbox = (min(bw[1], fw[1]), min(bw[2], fw[2]),
                     max(bw[3], fw[3]), max(bw[4], fw[4]))
            hits.append(Hit(f"{bw[0]}.{fw[0]}", page_no, "proximity", ubbox, ps))
        else:
            # holý kód bez fragmentu — prefix-match na typy `bt.*` (D-041)
            hits.append(Hit(bw[0], page_no, "bare", (bw[1], bw[2], bw[3], bw[4]), ps))
    return hits


# ── Skladbové značky (S#) ─────────────────────────────────────────────────────


@dataclass
class SkladbaHit:
    """Jedna detegovaná skladbová značka (`S#`) na strane výkresu (D-043 C)."""

    mark: str
    page: int
    bbox: tuple[float, float, float, float]    # PyMuPDF top-left (x0, y0, x1, y1)
    page_size: tuple[float, float]


def detect_skladby(page: "fitz.Page", page_no: int, marks: set[str]) -> list[SkladbaHit]:
    """Nájde výskyty známych skladbových značiek (`marks`) ako samostatné tokeny.

    `marks` = množina platných značiek z Výpisu (napr. `{S1, S2, …}`) → bez whitelistu
    by sa chytali aj `S#` z textu. Každý výskyt = vlastný klikací región (ako pri kódoch).
    """
    pw = _page_words(page)
    ps = (pw.width, pw.height)
    out: list[SkladbaHit] = []
    for w in pw.words:
        if w[0] in marks:
            out.append(SkladbaHit(w[0], page_no, (w[1], w[2], w[3], w[4]), ps))
    return out


# ── Manifest (výkres PDF → dokument object_ref) ───────────────────────────────


@dataclass(frozen=True)
class DrawingRow:
    source_path: str
    container_name: str    # object_ref dokumentu (z E3)


def read_drawings() -> list[DrawingRow]:
    """Riadky manifestu, ktoré sú výkresy (TypSouboru = VD)."""
    if not _MANIFEST.exists():
        raise SystemExit(f"Chýba manifest {_MANIFEST}")
    out: list[DrawingRow] = []
    with _MANIFEST.open(encoding="utf-8-sig") as fh:
        # utf-8-sig kvôli prípadnému BOM z Excelu (rovnako ako doc_upload.read_manifest)
        reader = csv.DictReader(line for line in fh if not line.startswith("#"))
        for r in reader:
            cn = r["container_name"].strip()
            if parse_container_name(cn).doc_type == "VD":
                out.append(DrawingRow(r["source_path"].strip(), cn))
    return out


def read_skladby() -> dict[str, int]:
    """Mapa skladbová značka → strana vo „Výpise skladieb" (`S#` → 1-based page, D-043).

    Vyhľadá Výpis v manifeste, otvorí PDF a na každej strane nájde značku `S#`, ktorá
    má napravo v tom istom riadku token „Skladba" (kotva — odlíši pravú značku od `S4`
    v špecifikácii materiálu). Prázdna mapa = Výpis chýba (skladby sa proste nelinkujú).
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
            # Pravá značka má názov „Skladba …" vo svojej hlavičke (ten istý alebo
            # tesne nasledujúci riadok). Textové výskyty „S4" v tabuľke materiálov sú
            # od „Skladba" ďaleko → vertikálny pás ich spoľahlivo odfiltruje.
            if any(
                name.startswith(_SKLADBA_NAME_PREFIX) and abs((b0 + b1) / 2 - cy) < 18
                for name, a0, b0, a1, b1 in words
            ):
                out[text] = i + 1
    return out


# ── Matching na DB + zápis hrán ───────────────────────────────────────────────


def _load_refs(cur, project_id: str = project_mod.OCB_ID) -> dict[str, tuple[str, str]]:
    """Plain ref (SNIM code as printed on the drawing) → (id, object_type) pre asset/asset_type projektu.
    Outside OCB the object_ref carries `<code>:` and the plain ref is `properties._ref` (D-189)."""
    rows = cur.execute(
        "select coalesce(properties->>'_ref', object_ref), id, object_type from objects "
        "where object_type in ('asset','asset_type') and project_id = %s",
        (project_id,),
    ).fetchall()
    return {r[0]: (r[1], r[2]) for r in rows}


def _types_by_assembly(refs: dict[str, tuple[str, str]]) -> dict[str, list[str]]:
    """Assembly Code (`OV01`) → id-čka typov `OV01.*` — pre prefix-match holých kódov.

    Assembly Code je vždy prvý dot-segment `object_ref`; prefix-match cieli **len typy**
    (`asset_type`), lebo holý kód na výkrese identifikuje typ prvku, nie konkrétnu
    inštanciu (tá by vyžadovala Mark, ktorý na bubline chýba).
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
    """PyMuPDF top-left bbox → PDF bottom-left (y rastie hore). Rieši y-flip raz, na zdroji."""
    x0, y0, x1, y1 = bbox
    _w, h = page_size
    return [round(x0, 2), round(h - y1, 2), round(x1, 2), round(h - y0, 2)]


def _route_for(object_type: str) -> str:
    """object_type → segment route (zladené s appkou: `asset_type` → /type, inak /node)."""
    return "type" if object_type == "asset_type" else "node"


def _write_links(cur, doc_id: str, regions: list[dict]) -> None:
    """Prepíše `_drawing_links` blob dokumentu (idempotentné, ostatné properties netknuté)."""
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
    # rel_associates_document(from=prvok, to=výkres) — zachováva smer D-014 (objekt → dokument).
    # D-051: zapisujeme do generickej `relationships` (rel_type), nie do kanonického view.
    # psycopg vracia UUID stĺpce ako uuid.UUID → edge_id pracuje so stringami
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
    matched: int                     # počet previazaných prvkov (= počet regiónov)
    regions: int                     # počet link-regiónov v `_drawing_links` (vrátane skladieb)
    unmatched_codes: set[str]        # reálne medzery: `full`/`bare` bez zhody (reportuj)
    dropped_proximity: set[str]      # proximity odhad bez cieľa v DB (šum/mimo scope) → zahodené
    skladba_regions: int = 0         # z toho navigačné regióny skladieb (S#, D-043 C)


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

    # zber zhôd s bbox; poradie podľa dôvery (full > proximity > bare), nech pri tom
    # istom **fyzickom výskyte** vyhrá najdôveryhodnejšia vrstva
    doc = fitz.open(pdf_path)
    hits: list[Hit] = []
    for i in range(doc.page_count):
        hits.extend(detect_codes(doc[i], i + 1, m))
    _order = {"full": 0, "proximity": 1, "bare": 2}
    hits.sort(key=lambda h: _order[h.origin])

    # Región = jeden **fyzický výskyt** kódu (klikací hotspot), NIE jeden prvok:
    # ten istý `object_ref` sa na výkrese opakuje (napr. `ST01.21` 4×) a každý výskyt
    # má byť klikateľný. Dedupe preto na úrovni (strana, bbox, cieľ) — nie cieľa.
    # `rel_associates_document` ostáva 1 hrana na prvok (sémantická väzba) → `matched_ids`.
    regions: list[dict] = []
    seen: set[tuple] = set()          # (page, bbox, target_id) — proti exaktným duplicitám
    matched_ids: set[str] = set()     # cieľe pre hrany (dedupe na úrovni prvku)
    unmatched: set[str] = set()
    dropped: set[str] = set()

    def add_region(target_id: str, object_type: str, hit: Hit) -> None:
        tid = str(target_id)
        matched_ids.add(tid)          # hrana vznikne raz na prvok (nech regiónov koľko chce)
        bbox = _to_bottom_left(hit.bbox, hit.page_size)
        key = (hit.page, tuple(bbox), tid)
        if key in seen:
            return                    # ten istý výskyt už má región (full pred proximity)
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
            # prefix-match holého Assembly Code na typy `code.*` (D-041)
            type_ids = types_by_assembly.get(hit.code)
            if type_ids:
                for tid in type_ids:
                    add_region(tid, "asset_type", hit)
            else:
                unmatched.add(hit.code)       # neznámy Assembly Code bez typu v DB
        else:
            # exact match (full + proximity); pri nezhode rozhoduje pôvod
            ref = refs.get(hit.code)
            if ref is not None:
                add_region(ref[0], ref[1], hit)
            elif hit.origin == "full":
                unmatched.add(hit.code)       # vytlačený kód bez prvku = reálna medzera
            else:
                dropped.add(hit.code)         # proximity odhad bez zhody = šum → zahoď

    # Skladbové značky (S#) → navigačné regióny na Výpis skladieb (D-043 C). Bez hrán
    # (skladba nemá vlastný uzol): cieľ = dokument Výpis, otvorený na strane skladby.
    skladba_count = 0
    if skladby and vypis_doc_id:
        marks = set(skladby)
        for i in range(doc.page_count):
            for sh in detect_skladby(doc[i], i + 1, marks):
                bbox = _to_bottom_left(sh.bbox, sh.page_size)
                key = (sh.page, tuple(bbox), sh.mark)   # mark v kľúči (cieľ je 1 dokument)
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
