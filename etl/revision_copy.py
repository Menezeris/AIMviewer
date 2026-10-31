"""Úplná kópia informácií revízie modelu v DB (D-183 K2).

Kontajner revízie (archív `ifc/archive/<model>/vNNN.ifc.gz`) je pravda; DB nesie jeho úplnú kópiu bez
geometrie, vyrobenú vždy tým istým generickým pravidlom (nič sa nevyberá ručne):

* `ifc_rev_objects`: každý IfcRoot okrem vzťahov a sád vlastností (prvky, priestory, typy, systémy, projekt,
  šablóny psetov) s atribútmi bez geometrie a OwnerHistory (tá je len informačne v `file_owner_history`),
* `ifc_rev_relationships`: každá dvojica (nositeľ = Relating*, druhá strana = Related*) z každého IfcRel*
  okrem IfcRelDefinesByProperties, kľúč (trieda, nositeľ, druhá strana),
* `ifc_rev_property_sets`: každý pset, Qto a preddefinovaná sada na výskyte aj na type, kľúč
  (nositeľ, meno psetu).

Vlastné GlobalId psetov a vzťahov sa ukladá len informačne (Revit ich pri exporte mení). Každý riadok má
`content_hash` = sha256 kanonického zápisu (`HASH_VERSION`). Import beží v jednej transakcii, kontrola
úplnosti (počty zo súboru = DB) je jej súčasťou a až potom vznikne `ifc_rev_imports.status = 'done'`.
Graf AIM (`objects`, `relationships`) sa nemení.

Spustenie z koreňa repa:
    python -m etl.revision_copy --model ASR                 # aktuálna revízia
    python -m etl.revision_copy --model VZT --revision 11   # konkrétna revízia
    python -m etl.revision_copy --model VZT --archive-file v011.ifc.gz --dry-run   # bez DB zápisu
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Optional

import ifcopenshell

HASH_VERSION = 1

# Atribúty, ktoré nie sú informácia kópie: identita, história (zvlášť), geometria a psety typu (vlastná tabuľka).
_SKIP_ATTRS = {"GlobalId", "OwnerHistory", "ObjectPlacement", "Representation", "RepresentationMaps",
               "HasPropertySets", "RepresentationContexts"}
# Geometria a jej kontext: do DB nejde nikdy (D-183 bod 6).
_GEOMETRY = ("IfcRepresentationItem", "IfcProductRepresentation", "IfcRepresentation", "IfcObjectPlacement",
             "IfcRepresentationContext", "IfcRepresentationMap", "IfcShapeAspect", "IfcConnectionGeometry")
_MAX_DEPTH = 6


class Skip:
    """Hodnota, ktorá do kópie nepatrí (geometria)."""


SKIP = Skip()


# ── kanonický zápis ───────────────────────────────────────────────────────────

def _num(x: float) -> Any:
    """Pevná presnosť 12 platných číslic: zmena hodnoty je vidieť, šum zápisu (2.4 vs 2.4000000000001) nie."""
    if math.isnan(x) or math.isinf(x):
        return str(x)
    v = float(f"{x:.12g}")
    return int(v) if v.is_integer() and abs(v) < 1e15 else v


def is_geometry(e: ifcopenshell.entity_instance) -> bool:
    return any(e.is_a(c) for c in _GEOMETRY)


def natural_key(e: ifcopenshell.entity_instance) -> str:
    """Kľúč strany vzťahu: GlobalId, inak `Trieda:Identification|Name|...`, inak hash obsahu (P14)."""
    gid = getattr(e, "GlobalId", None) if hasattr(e, "GlobalId") else None
    if gid:
        return gid
    info = e.get_info(include_identifier=False, recursive=False)
    for attr in ("Identification", "ItemReference", "DocumentId", "Name", "Location"):
        v = info.get(attr)
        if isinstance(v, str) and v:
            return f"{e.is_a()}:{v}"
    return f"{e.is_a()}:#{digest(value(e))[:16]}"


def value(v: Any, depth: int = 0) -> Any:
    """Hodnota atribútu v kanonickom tvare: IfcRoot = odkaz GlobalId, geometria = SKIP, ostatné entity vnorene."""
    if isinstance(v, ifcopenshell.entity_instance):
        if v.id() == 0 and hasattr(v, "wrappedValue"):          # IfcLabel, IfcLengthMeasure...
            return value(v.wrappedValue, depth)
        if is_geometry(v):
            return SKIP
        if v.is_a("IfcRoot"):
            return {"ref": v.GlobalId}
        if depth >= _MAX_DEPTH:
            return {"_class": v.is_a(), "ref": natural_key(v)}
        out: dict[str, Any] = {"_class": v.is_a()}
        for k, x in v.get_info(include_identifier=False, recursive=False).items():
            if k == "type" or k in _SKIP_ATTRS:
                continue
            cv = value(x, depth + 1)
            if cv is not SKIP and cv is not None:
                out[k] = cv
        return out
    if isinstance(v, (tuple, list)):
        items = [value(x, depth + 1) for x in v]
        return [x for x in items if x is not SKIP]
    if isinstance(v, float):
        return _num(v)
    return v


def canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def digest(obj: Any) -> str:
    return hashlib.sha256(f"{HASH_VERSION}|{canonical(obj)}".encode("utf-8")).hexdigest()


def attributes(e: ifcopenshell.entity_instance) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in e.get_info(include_identifier=False, recursive=False).items():
        if k == "type" or k in _SKIP_ATTRS:
            continue
        cv = value(v)
        if cv is not SKIP and cv is not None:
            out[k] = cv
    return out


def _actor(a: Any) -> Optional[str]:
    if a is None:
        return None
    if a.is_a("IfcPersonAndOrganization"):
        p, o = _actor(a.ThePerson), _actor(a.TheOrganization)
        return " / ".join(x for x in (p, o) if x) or None
    if a.is_a("IfcPerson"):
        name = " ".join(x for x in (getattr(a, "GivenName", None), getattr(a, "FamilyName", None)) if x)
        return name or getattr(a, "Identification", None) or None
    return getattr(a, "Name", None)


def owner_history(oh: Any) -> Optional[dict[str, Any]]:
    """IfcOwnerHistory zo súboru, len informačne (D-183 bod 7: nikdy sa z neho nepočíta zmena)."""
    if oh is None:
        return None
    app = lambda a: a.ApplicationFullName if a is not None else None  # noqa: E731
    out = {
        "OwningUser": _actor(oh.OwningUser),
        "OwningApplication": app(oh.OwningApplication),
        "State": oh.State,
        "ChangeAction": oh.ChangeAction,
        "LastModifiedDate": oh.LastModifiedDate,
        "LastModifyingUser": _actor(oh.LastModifyingUser),
        "LastModifyingApplication": app(oh.LastModifyingApplication),
        "CreationDate": oh.CreationDate,
    }
    return {k: v for k, v in out.items() if v is not None}


# ── psety ─────────────────────────────────────────────────────────────────────

def property_value(p: ifcopenshell.entity_instance) -> Any:
    """Hodnota IfcProperty alebo IfcPhysicalQuantity."""
    if p.is_a("IfcPropertySingleValue"):
        v = value(p.NominalValue)
        return {"value": v, "unit": value(p.Unit)} if p.Unit is not None else v
    if p.is_a("IfcPropertyEnumeratedValue"):
        return [value(x) for x in (p.EnumerationValues or ())]
    if p.is_a("IfcPropertyListValue"):
        return [value(x) for x in (p.ListValues or ())]
    if p.is_a("IfcPropertyBoundedValue"):
        return {k: value(getattr(p, a)) for k, a in (("upper", "UpperBoundValue"), ("lower", "LowerBoundValue"),
                                                     ("set", "SetPointValue")) if getattr(p, a) is not None}
    if p.is_a("IfcPropertyTableValue"):
        return {"defining": [value(x) for x in (p.DefiningValues or ())],
                "defined": [value(x) for x in (p.DefinedValues or ())]}
    if p.is_a("IfcComplexProperty"):
        return {sub.Name: property_value(sub) for sub in (p.HasProperties or ())}
    if p.is_a("IfcPhysicalComplexQuantity"):
        return {q.Name: property_value(q) for q in (p.HasQuantities or ())}
    if p.is_a("IfcPhysicalSimpleQuantity"):
        # 4. atribút je hodnota (LengthValue, AreaValue, CountValue...), ostatné sú Name, Description, Unit
        info = p.get_info(include_identifier=False, recursive=False)
        vals = {k: value(v) for k, v in info.items() if k.endswith("Value")}
        return next(iter(vals.values())) if len(vals) == 1 else vals
    out = {k: value(v) for k, v in p.get_info(include_identifier=False, recursive=False).items()
           if k not in ("type", "Name", "Description", "Specification")}
    return {k: v for k, v in out.items() if v is not SKIP and v is not None}


def pset_properties(ps: ifcopenshell.entity_instance) -> dict[str, Any]:
    if ps.is_a("IfcPropertySet"):
        return {p.Name: property_value(p) for p in (ps.HasProperties or ())}
    if ps.is_a("IfcElementQuantity"):
        return {q.Name: property_value(q) for q in (ps.Quantities or ())}
    return attributes(ps)  # IfcPreDefinedPropertySet: vlastné atribúty


def _flatten_psets(defn: Any) -> list[ifcopenshell.entity_instance]:
    """IfcPropertySetDefinitionSelect: jedna sada alebo IfcPropertySetDefinitionSet (zoznam)."""
    if defn is None:
        return []
    if isinstance(defn, (tuple, list)):
        return [d for d in defn if isinstance(d, ifcopenshell.entity_instance)]
    if isinstance(defn, ifcopenshell.entity_instance) and defn.id() == 0 and hasattr(defn, "wrappedValue"):
        return _flatten_psets(defn.wrappedValue)
    return [defn]


# ── extrakcia ─────────────────────────────────────────────────────────────────

@dataclass
class RevisionCopy:
    objects: list[dict[str, Any]] = field(default_factory=list)
    relationships: list[dict[str, Any]] = field(default_factory=list)
    property_sets: list[dict[str, Any]] = field(default_factory=list)
    expected: dict[str, Any] = field(default_factory=dict)       # počty zo súboru (kontrola úplnosti)
    warnings: list[str] = field(default_factory=list)
    schema: str = ""
    header: dict[str, Any] = field(default_factory=dict)
    applications: dict[str, Any] = field(default_factory=dict)  # OwningApplication / LastModifyingApplication projektu


def duplicate_guids(f: ifcopenshell.file) -> list[str]:
    c = Counter(e.GlobalId for e in f.by_type("IfcRoot"))
    return sorted(g for g, n in c.items() if n > 1)


def file_header(f: ifcopenshell.file) -> dict[str, Any]:
    h = f.header
    fn, fd = h.file_name, h.file_description
    return {
        "FILE_DESCRIPTION": {"description": list(fd.description), "implementation_level": fd.implementation_level},
        "FILE_NAME": {"name": fn.name, "time_stamp": fn.time_stamp, "author": list(fn.author),
                      "organization": list(fn.organization), "preprocessor_version": fn.preprocessor_version,
                      "originating_system": fn.originating_system, "authorization": fn.authorization},
        "FILE_SCHEMA": list(h.file_schema.schema_identifiers),
    }


def _application(a: Any) -> Optional[dict[str, Any]]:
    if a is None:
        return None
    dev = a.ApplicationDeveloper
    return {"application_developer": getattr(dev, "Name", None) if dev is not None else None,
            "version": a.Version, "application_full_name": a.ApplicationFullName,
            "application_identifier": a.ApplicationIdentifier}


def extract(f: ifcopenshell.file) -> RevisionCopy:
    out = RevisionCopy(schema=f.schema_identifier if hasattr(f, "schema_identifier") else f.schema)
    out.header = file_header(f)
    oh_cache: dict[int, Optional[dict[str, Any]]] = {}

    # objekty: každý IfcRoot okrem vzťahov a sád vlastností (tie majú vlastné tabuľky)
    obj_counts: Counter[str] = Counter()
    for e in f.by_type("IfcRoot"):
        if e.is_a("IfcRelationship") or e.is_a("IfcPropertySetDefinition"):
            continue
        attrs = attributes(e)
        oh = getattr(e, "OwnerHistory", None)
        if oh is not None and oh.id() not in oh_cache:
            oh_cache[oh.id()] = owner_history(oh)
        out.objects.append({
            "global_id": e.GlobalId, "ifc_class": e.is_a(), "attributes": attrs,
            "file_owner_history": oh_cache.get(oh.id()) if oh is not None else None,
            "content_hash": digest({"class": e.is_a(), "attributes": attrs}),
        })
        obj_counts[e.is_a()] += 1

    projects = f.by_type("IfcProject")
    if projects and getattr(projects[0], "OwnerHistory", None) is not None:
        oh = projects[0].OwnerHistory
        out.applications = {"owning": _application(oh.OwningApplication),
                            "last_modifying": _application(oh.LastModifyingApplication)}

    # vzťahy (bez IfcRelDefinesByProperties: to sú psety)
    pairs: dict[tuple[str, str, str], dict[str, Any]] = {}
    pair_counts: Counter[str] = Counter()
    for rel in f.by_type("IfcRelationship"):
        if rel.is_a("IfcRelDefinesByProperties"):
            continue
        info = rel.get_info(include_identifier=False, recursive=False)
        relating: list[ifcopenshell.entity_instance] = []
        related: list[ifcopenshell.entity_instance] = []
        rest: dict[str, Any] = {}
        for k, v in info.items():
            if k in ("type", "GlobalId", "OwnerHistory"):
                continue
            ents = [x for x in (v if isinstance(v, (tuple, list)) else (v,))
                    if isinstance(x, ifcopenshell.entity_instance) and x.id() != 0]
            if k.startswith("Relating") and ents and not relating:
                relating = ents
            elif k.startswith("Related") and ents and not related:
                related = ents
            else:
                cv = value(v)
                if cv is not SKIP and cv is not None:
                    rest[k] = cv
        if not relating or not related:
            out.warnings.append(f"{rel.is_a()} {rel.GlobalId}: bez dvojice Relating/Related")
            continue
        for a in relating:
            for b in related:
                key = (rel.is_a(), natural_key(a), natural_key(b))
                row = pairs.get(key)
                if row is None:
                    row = pairs[key] = {"rel_class": key[0], "relating": key[1], "related": key[2],
                                        "relating_class": a.is_a(), "related_class": b.is_a(),
                                        "variants": [], "multiplicity": 0, "rel_global_ids": []}
                row["multiplicity"] += 1
                row["rel_global_ids"].append(rel.GlobalId)
                if rest not in row["variants"]:
                    row["variants"].append(rest)
                pair_counts[rel.is_a()] += 1
    for row in pairs.values():
        variants = sorted(row.pop("variants"), key=canonical)
        row["attributes"] = variants
        row["rel_global_ids"] = sorted(row["rel_global_ids"])
        row["content_hash"] = digest({"rel": row["rel_class"], "relating": row["relating"],
                                      "related": row["related"], "attributes": variants})
        out.relationships.append(row)

    # psety na výskytoch (IfcRelDefinesByProperties) a na typoch (HasPropertySets)
    attachments: list[tuple[ifcopenshell.entity_instance, ifcopenshell.entity_instance]] = []
    for rel in f.by_type("IfcRelDefinesByProperties"):
        for ps in _flatten_psets(rel.RelatingPropertyDefinition):
            for o in rel.RelatedObjects or ():
                attachments.append((o, ps))
    for t in f.by_type("IfcTypeObject"):
        for ps in t.HasPropertySets or ():
            attachments.append((t, ps))
    psets: dict[tuple[str, str], dict[str, Any]] = {}
    attached: set[int] = set()
    pset_counts: Counter[str] = Counter()
    for holder, ps in attachments:
        attached.add(ps.id())
        name = ps.Name or f"{ps.is_a()}:{ps.GlobalId}"
        key = (holder.GlobalId, name)
        row = psets.get(key)
        props = pset_properties(ps)
        if row is None:
            row = psets[key] = {"global_id": holder.GlobalId, "pset_name": name, "pset_class": ps.is_a(),
                                "properties": {}, "pset_global_ids": []}
        elif ps.GlobalId not in row["pset_global_ids"]:
            out.warnings.append(f"{holder.GlobalId}: viac sád s menom {name}, vlastnosti zlúčené")
        if ps.GlobalId not in row["pset_global_ids"]:
            row["pset_global_ids"].append(ps.GlobalId)
            row["properties"].update(props)
            pset_counts[ps.is_a()] += 1
    for row in psets.values():
        row["pset_global_ids"] = sorted(row["pset_global_ids"])
        row["content_hash"] = digest({"class": row["pset_class"], "properties": row["properties"]})
        out.property_sets.append(row)
    orphans = [ps for ps in f.by_type("IfcPropertySetDefinition") if ps.id() not in attached
               and not ps.is_a("IfcPropertySetTemplate")]
    if orphans:
        out.warnings.append(f"{len(orphans)} sád vlastností bez nositeľa (nie sú v kópii)")

    rel_entities = len(f.by_type("IfcRelationship"))
    pset_entities = len(f.by_type("IfcPropertySetDefinition"))
    out.expected = {
        "objects": dict(sorted(obj_counts.items())),
        "relationship_pairs": dict(sorted(pair_counts.items())),
        "pset_attachments": dict(sorted(pset_counts.items())),
        "ifc_root": len(f.by_type("IfcRoot")),
        # každý IfcRoot je objekt, vzťah alebo sada vlastností (kontrola, že pravidlo nič nevynecháva)
        "ifc_root_accounted": sum(obj_counts.values()) + rel_entities + pset_entities,
        "pset_orphans": len(orphans),
    }
    return out


# ── zápis do DB ───────────────────────────────────────────────────────────────

def _copy(cur, table: str, columns: Iterable[str], rows: Iterable[tuple]) -> None:
    cols = list(columns)
    with cur.copy(f"copy {table} ({', '.join(cols)}) from stdin") as cp:
        for r in rows:
            cp.write_row(r)


def _db_counts(cur, model: str, revision: int) -> dict[str, Any]:
    q = lambda sql: dict(cur.execute(sql, (model, revision)).fetchall())  # noqa: E731
    return {
        "objects": q("select ifc_class, count(*)::int from ifc_rev_objects where model = %s and revision = %s "
                     "group by 1 order by 1"),
        "relationship_pairs": q("select rel_class, sum(multiplicity)::int from ifc_rev_relationships "
                                "where model = %s and revision = %s group by 1 order by 1"),
        "pset_attachments": q("select pset_class, sum(cardinality(pset_global_ids))::int from ifc_rev_property_sets "
                              "where model = %s and revision = %s group by 1 order by 1"),
    }


def completeness(expected: dict[str, Any], db: dict[str, Any]) -> list[str]:
    """Rozdiely počtov súbor vs DB po triedach; prázdne = úplné."""
    diffs = []
    if expected.get("ifc_root") != expected.get("ifc_root_accounted"):
        diffs.append(f"IfcRoot: súbor {expected.get('ifc_root')}, započítané {expected.get('ifc_root_accounted')}")
    for part in ("objects", "relationship_pairs", "pset_attachments"):
        e, d = expected.get(part, {}), db.get(part, {})
        for k in sorted(set(e) | set(d)):
            if e.get(k, 0) != d.get(k, 0):
                diffs.append(f"{part}.{k}: súbor {e.get(k, 0)}, DB {d.get(k, 0)}")
    return diffs


def _application_id(cur, app: Optional[dict[str, Any]]) -> Optional[str]:
    if not app or not app.get("application_full_name") or not app.get("application_identifier"):
        return None
    row = cur.execute(
        "insert into ifc_application (application_developer, version, application_full_name, application_identifier) "
        "values (%(application_developer)s, coalesce(%(version)s, ''), %(application_full_name)s, %(application_identifier)s) "
        "on conflict (application_identifier, version) do update set application_full_name = excluded.application_full_name "
        "returning id", app).fetchone()
    return row[0]


def write(cur, model: str, revision: int, sha256: str, copy: RevisionCopy, started: float) -> dict[str, Any]:
    """Zapíše kópiu revízie v jednej transakcii (volajúci commitne); pri neúplnosti vyhodí chybu."""
    from psycopg.types.json import Jsonb

    cur.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"ifc_rev_imports:{model}",))
    cur.execute("delete from ifc_rev_imports where model = %s and revision = %s", (model, revision))
    cur.execute(
        "insert into ifc_rev_imports (model, revision, sha256, status, hash_version, schema_identifier, engine, "
        "started_at) values (%s, %s, %s, 'done', %s, %s, %s, to_timestamp(%s))",
        (model, revision, sha256, HASH_VERSION, copy.schema, f"ifcopenshell {ifcopenshell.version}", started),
    )
    _copy(cur, "ifc_rev_objects",
          ("model", "revision", "global_id", "ifc_class", "attributes", "file_owner_history", "content_hash"),
          ((model, revision, o["global_id"], o["ifc_class"], Jsonb(o["attributes"]),
            Jsonb(o["file_owner_history"]) if o["file_owner_history"] is not None else None, o["content_hash"])
           for o in copy.objects))
    _copy(cur, "ifc_rev_relationships",
          ("model", "revision", "rel_class", "relating", "related", "relating_class", "related_class", "attributes",
           "multiplicity", "rel_global_ids", "content_hash"),
          ((model, revision, r["rel_class"], r["relating"], r["related"], r["relating_class"], r["related_class"],
            Jsonb(r["attributes"]), r["multiplicity"], r["rel_global_ids"], r["content_hash"])
           for r in copy.relationships))
    _copy(cur, "ifc_rev_property_sets",
          ("model", "revision", "global_id", "pset_name", "pset_class", "properties", "pset_global_ids", "content_hash"),
          ((model, revision, p["global_id"], p["pset_name"], p["pset_class"], Jsonb(p["properties"]),
            p["pset_global_ids"], p["content_hash"]) for p in copy.property_sets))

    db = _db_counts(cur, model, revision)
    diffs = completeness(copy.expected, db)
    if diffs:
        raise RuntimeError("Kópia nie je úplná: " + "; ".join(diffs[:20]))
    counts = {"file": copy.expected, "db": db}
    cur.execute("update ifc_rev_imports set counts = %s, warnings = %s, finished_at = now() "
                "where model = %s and revision = %s", (Jsonb(counts), Jsonb(copy.warnings), model, revision))

    # Hlavička a aplikácia patria k revízii kontajnera (K1); doplnia sa, nič sa neprepisuje.
    owning = _application_id(cur, (copy.applications or {}).get("owning"))
    last = _application_id(cur, (copy.applications or {}).get("last_modifying"))
    cur.execute(
        "update container_revisions cr set file_header = coalesce(cr.file_header, %s), "
        "electronic_format = coalesce(cr.electronic_format, %s), "
        "owning_application_id = coalesce(cr.owning_application_id, %s), "
        "last_modifying_application_id = coalesce(cr.last_modifying_application_id, %s) "
        "from model_revisions m where cr.model_revision_id = m.id and m.model = %s and m.revision = %s",
        (Jsonb(copy.header), copy.schema, owning, last, model, revision),
    )
    return counts


def _fail(db_url: str, model: str, revision: int, sha256: str, error: str) -> None:
    import psycopg

    with psycopg.connect(db_url) as conn, conn.cursor() as cur:
        cur.execute(
            "insert into ifc_rev_imports (model, revision, sha256, status, hash_version, error, finished_at) "
            "values (%s, %s, %s, 'failed', %s, %s, now()) on conflict (model, revision) do update "
            "set status = 'failed', error = excluded.error, finished_at = now() "
            "where ifc_rev_imports.status <> 'done'",
            (model, revision, sha256, HASH_VERSION, error[:2000]),
        )


# ── vstup ─────────────────────────────────────────────────────────────────────

def revision_row(cur, model: str, revision: Optional[int]) -> tuple[int, str]:
    if revision is None:
        row = cur.execute("select revision, sha256 from model_revisions where model = %s and is_current",
                          (model,)).fetchone()
    else:
        row = cur.execute("select revision, sha256 from model_revisions where model = %s and revision = %s",
                          (model, revision)).fetchone()
    if row is None:
        raise SystemExit(f"{model}: revízia {revision if revision is not None else '(aktuálna)'} nie je v model_revisions")
    return row[0], row[1]


def load_bytes(model: str, revision: int, archive_file: Optional[Path]) -> bytes:
    """Rozbalený obsah archívu revízie (zo Storage, alebo lokálny súbor .ifc.gz / .ifc)."""
    if archive_file is not None:
        raw = archive_file.read_bytes()
        return gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw
    from etl.model_publish import _get, archive_key

    return gzip.decompress(_get(archive_key(model, revision)))


def open_verified(data: bytes, expected_sha: Optional[str]) -> tuple[ifcopenshell.file, str]:
    sha = hashlib.sha256(data).hexdigest()
    if expected_sha is not None and sha != expected_sha:
        raise SystemExit(f"sha256 archívu {sha} nesedí s model_revisions {expected_sha}; revízia sa neindexuje")
    return ifcopenshell.file.from_string(data.decode("utf-8", errors="strict")), sha


def run(model: str, revision: Optional[int], archive_file: Optional[Path], dry_run: bool, force: bool,
        db_url: Optional[str] = None) -> dict[str, Any]:
    started = time.time()
    if dry_run and db_url is None:
        data = load_bytes(model, revision if revision is not None else -1, archive_file) if archive_file else None
        if data is None:
            raise SystemExit("--dry-run bez DB potrebuje --archive-file")
        f, sha = open_verified(data, None)
        rev, expected_sha = revision, None
    else:
        import psycopg

        from etl import config

        db_url = db_url or config.database_url()
        with psycopg.connect(db_url) as conn, conn.cursor() as cur:
            rev, expected_sha = revision_row(cur, model, revision)
            done = cur.execute("select sha256, hash_version from ifc_rev_imports where model = %s and revision = %s "
                               "and status = 'done'", (model, rev)).fetchone()
        if done and done[0] == expected_sha and done[1] == HASH_VERSION and not force and not dry_run:
            return {"model": model, "revision": rev, "status": "already_done"}
        f, sha = open_verified(load_bytes(model, rev, archive_file), expected_sha)

    dups = duplicate_guids(f)
    if dups:
        raise SystemExit(f"Duplicitné GlobalId v súbore ({len(dups)}, napr. {dups[:3]}); revízia sa neindexuje")
    t0 = time.time()
    copy = extract(f)
    result: dict[str, Any] = {
        "model": model, "revision": rev, "sha256": sha, "schema": copy.schema,
        "objects": len(copy.objects), "relationship_pairs": len(copy.relationships),
        "property_sets": len(copy.property_sets), "warnings": copy.warnings,
        "extract_s": round(time.time() - t0, 1),
    }
    if dry_run:
        result["status"] = "dry_run"
        result["expected"] = copy.expected
        return result

    import psycopg

    assert db_url is not None and rev is not None
    try:
        t1 = time.time()
        with psycopg.connect(db_url) as conn:
            with conn.cursor() as cur:
                counts = write(cur, model, rev, sha, copy, started)
            conn.commit()
        result.update(status="done", write_s=round(time.time() - t1, 1), counts=counts["db"])
    except Exception as err:  # zápis sa vrátil celý; stav failed ide samostatne
        _fail(db_url, model, rev, sha, str(err))
        raise
    return result


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m etl.revision_copy", description=__doc__.split("\n\n")[0])
    ap.add_argument("--model", required=True, help="model federácie (ASR, VZT)")
    ap.add_argument("--revision", type=int, help="číslo revízie (predvolene aktuálna)")
    ap.add_argument("--archive-file", type=Path, help="lokálny archív .ifc.gz namiesto Storage (sha256 sa overí)")
    ap.add_argument("--dry-run", action="store_true", help="len extrakcia a počty, nič sa nezapíše")
    ap.add_argument("--force", action="store_true", help="znova zapísať aj hotovú revíziu s rovnakým sha256")
    args = ap.parse_args(argv)
    res = run(args.model, args.revision, args.archive_file, args.dry_run, args.force)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
