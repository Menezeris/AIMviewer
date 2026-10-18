"""Load vrstva — idempotentný upsert staged modelu do Supabase Postgresu (D-031).

Poradie rešpektuje FK závislosti. `objects` sa upsertujú cez `object_ref`
(`id` ostáva DB-generované, verné D-010); ostatné tabuľky bez prirodzeného
unique používajú deterministické UUID (`ids.py`). Všetko v jednej transakcii.
"""

from __future__ import annotations

import psycopg
from psycopg.types.json import Json

from . import ids
from .manifest import _SPECS, EDGE_TYPE_TO_REL_TYPE
from .model import StagedModel

# D-051: hrany už nemajú per-vzťah tabuľku — všetky idú do generickej `relationships`
# (diskriminátor `rel_type`). Interný ETL `edge_type` → kanonický `rel_type` drží
# manifest (`etl/manifest.py`, jeden zdroj pravdy). Zapisujeme BASE tabuľku, nie
# kanonické views (tie sú len na čítanie).

# rel_type s parciálnym unique indexom "1 aktívny rodič na from_id" (manifest).
UNIQUE_ACTIVE_FROM = frozenset(s.rel_type for s in _SPECS if s.unique_active_from)


def fetch_existing_floors(url: str) -> list[tuple[str, object, object]]:
    """Existujúce floor uzly `(object_ref, elevation, name)` — vstup pre federačné
    mapovanie podlaží (D-049). Volá `main.py` pred VZT federate loadom."""
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select o.object_ref, f.elevation, o.name from objects o "
                "join floors f on f.id = o.id where o.object_type = 'floor'"
            )
            return [
                (r[0], float(r[1]) if r[1] is not None else None, r[2])
                for r in cur.fetchall()
            ]


def reset_data(cur) -> None:
    """Vyprázdni AIM dátové tabuľky (napr. pred nahradením seedu reálnymi dátami, E2).

    `TRUNCATE ... CASCADE` na koreňových tabuľkách zmaže aj všetko závislé cez FK
    (prípony, hrany `rel_*`, GUID história, klasifikačné referencie). Seed je
    reprodukovateľný z `supabase/seed.sql`, takže je to bezpečné a vratné.
    Schéma (tabuľky/views/migrácie) ostáva nedotknutá — len riadky.
    """
    cur.execute(
        "truncate table objects, classification_systems, classification_references "
        "restart identity cascade"
    )


def load_model(
    url: str, model: StagedModel, reset: bool = False, scope: str | None = None
) -> dict[str, int]:
    """Zapíše celý staged model v jednej transakcii (commit na konci).

    `reset=True` najprv vyprázdni AIM dáta (nahradenie seedu, E2) — stále v tej
    istej transakcii, takže pri chybe sa nič nezahodí.

    `scope` = meno modelu federácie (`ASR`, `VZT`; D-086). Hrany a GUID história
    dostanú zdroj tohto modelu (`etl:ASR`, `IFC import:ASR`) a čo tento beh už
    nevydal, sa uzavrie (`valid_until = now()`) — zmazaný prvok, presunutý prvok,
    zmenený typ či klasifikácia. Vzor `etl.derive` (D-080). Objekt bez aktívneho GUID
    dostane `valid_until` (D-087); riadok ostáva (D-010) a pri návrate do modelu ožije.
    Vráti počty uzavretých záznamov.
    """
    closed = {"edges": 0, "guids": 0, "objects": 0, "repointed": 0}
    if scope:
        scope_sources(model, scope)
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            if reset:
                reset_data(cur)
            sys_ids = _load_systems(cur, model)
            ref_ids = _load_refs(cur, model, sys_ids)
            obj_ids = _load_objects(cur, model)
            _load_appendices(cur, model, obj_ids)
            _load_guid_history(cur, model, obj_ids)
            _load_edges(cur, model, obj_ids)
            _load_class_links(cur, model, obj_ids, ref_ids)
            if scope:
                closed = close_stale(cur, model, scope)
        conn.commit()
    return closed


# Zdroje, ktoré ETL zapisoval pred D-086 (bez mena modelu).
LEGACY_EDGE_SOURCE = "etl"
LEGACY_GUID_SOURCE = "IFC import"


def edge_source(scope: str) -> str:
    return f"{LEGACY_EDGE_SOURCE}:{scope}"


def guid_source(scope: str) -> str:
    return f"{LEGACY_GUID_SOURCE}:{scope}"


def scope_sources(model: StagedModel, scope: str) -> None:
    """Prepíše predvolené zdroje ETL na zdroje modelu `scope` (explicitné iné zdroje ostávajú)."""
    for e in model.edges:
        if e.source == LEGACY_EDGE_SOURCE:
            e.source = edge_source(scope)
    for c in model.class_links:
        if c.source == LEGACY_EDGE_SOURCE:
            c.source = edge_source(scope)
    for g in model.guid_history:
        if g.source == LEGACY_GUID_SOURCE:
            g.source = guid_source(scope)


def emitted_ids(model: StagedModel) -> tuple[list[str], list[str]]:
    """Id hrán (vrátane klasifikačných) a aktívnych GUID záznamov, ktoré tento beh zapísal."""
    edges = [ids.edge_id(e.from_ref, e.to_ref, e.edge_type) for e in model.edges]
    edges += [
        ids.edge_id(c.from_ref, f"{c.system_name}:{c.identification}", "has_classification")
        for c in model.class_links
    ]
    guids = [
        ids.guid_history_id(g.object_ref, g.ifc_guid)
        for g in model.guid_history
        if g.valid_until is None
    ]
    return edges, guids


# Objekt zanikol (D-087): mal GUID zo zdroja `source`, ale už nemá žiadny aktívny GUID.
_RETIRE_OBJECTS = (
    "update objects o set valid_until = now() "
    "where o.valid_until is null and o.ifc_guid is not null "
    "and exists (select 1 from ifc_guid_history h where h.object_id = o.id and h.source = %s) "
    "and not exists (select 1 from ifc_guid_history h "
    "where h.object_id = o.id and h.valid_until is null) returning o.id"
)


def close_stale(cur, model: StagedModel, scope: str) -> dict[str, int]:
    """Uzavrie aktívne hrany, GUID záznamy a objekty modelu `scope`, ktoré tento beh nevydal."""
    edges, guids = emitted_ids(model)
    closed_edges = cur.execute(
        "update relationships set valid_until = now() "
        "where source = %s and valid_until is null and not (id = any(%s)) returning id",
        (edge_source(scope), edges),
    ).fetchall()
    closed_guids = cur.execute(
        "update ifc_guid_history set valid_until = now() "
        "where source = %s and valid_until is null and not (id = any(%s)) returning id",
        (guid_source(scope), guids),
    ).fetchall()
    retired = cur.execute(_RETIRE_OBJECTS, (guid_source(scope),)).fetchall()
    return {"edges": len(closed_edges), "guids": len(closed_guids), "objects": len(retired),
            "repointed": repoint_to_successors(cur)}


# Ručné väzby (výkresy E4, dokumenty E3, fotky D-073) na zaniknutý objekt prejdú na
# platný objekt s rovnakým GUID: premenovaný object_ref je ten istý prvok (D-087).
# Väzby ETL a derive si model vydá sám, tie sa nepresúvajú.
_REPOINT = """
    update relationships r set {end}_id = s.new_id
    from (select o.id as old_id, n.id as new_id
          from objects o join objects n
            on n.ifc_guid = o.ifc_guid and n.valid_until is null and n.id <> o.id
          where o.valid_until is not null and o.ifc_guid is not null) s
    where r.{end}_id = s.old_id and r.valid_until is null
      and r.source not like 'etl%' and r.source not like 'derive:%'
    returning r.id
"""


def repoint_to_successors(cur) -> int:
    """Presmeruje aktívne ručné väzby zo zaniknutých objektov na nástupcu s rovnakým GUID."""
    moved = 0
    for end in ("from", "to"):
        moved += len(cur.execute(_REPOINT.format(end=end)).fetchall())
    return moved


def close_legacy(cur) -> dict[str, int]:
    """Jednorazovo po prvom loade všetkých modelov so `scope` (D-086): čo ostalo aktívne
    so starým zdrojom bez mena modelu, už žiadny model nevydal → uzavrieť."""
    closed_edges = cur.execute(
        "update relationships set valid_until = now() "
        "where source = %s and valid_until is null returning id",
        (LEGACY_EDGE_SOURCE,),
    ).fetchall()
    closed_guids = cur.execute(
        "update ifc_guid_history set valid_until = now() "
        "where source = %s and valid_until is null returning id",
        (LEGACY_GUID_SOURCE,),
    ).fetchall()
    retired = cur.execute(_RETIRE_OBJECTS, (LEGACY_GUID_SOURCE,)).fetchall()
    return {"edges": len(closed_edges), "guids": len(closed_guids), "objects": len(retired),
            "repointed": repoint_to_successors(cur)}


def _load_systems(cur, model: StagedModel) -> dict[str, str]:
    out: dict[str, str] = {}
    for s in model.systems:
        sid = ids.system_id(s.name)
        cur.execute(
            """
            insert into classification_systems
              (id, name, source, edition, edition_date, location)
            values (%s, %s, %s, %s, %s, %s)
            on conflict (id) do update set
              name = excluded.name, source = excluded.source,
              edition = excluded.edition, edition_date = excluded.edition_date,
              location = excluded.location, updated_at = now()
            """,
            (sid, s.name, s.source, s.edition, s.edition_date, s.location),
        )
        out[s.name] = sid
    return out


def _load_refs(cur, model: StagedModel, sys_ids: dict[str, str]) -> dict[tuple[str, str], str]:
    out: dict[tuple[str, str], str] = {}
    for r in model.refs:
        system_id = sys_ids[r.system_name]
        row = cur.execute(
            """
            insert into classification_references
              (system_id, identification, name, location)
            values (%s, %s, %s, %s)
            on conflict (system_id, identification) do update set
              name = excluded.name, location = excluded.location, updated_at = now()
            returning id
            """,
            (system_id, r.identification, r.name, r.location),
        ).fetchone()
        out[(r.system_name, r.identification)] = row[0]
    return out


def _load_objects(cur, model: StagedModel) -> dict[str, str]:
    """Upsert `objects` cez object_ref; vráti mapu object_ref → DB id."""
    out: dict[str, str] = {}
    for o in model.objects:
        if not o.object_ref:
            raise ValueError(f"objekt bez object_ref (typ {o.object_type}) — D-031 vyžaduje stabilný ref")
        row = cur.execute(
            """
            insert into objects
              (object_type, object_ref, name, ifc_guid, ifc_type,
               predefined_type, user_defined_type, properties)
            values (%s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (object_ref) do update set
              object_type = excluded.object_type, name = excluded.name,
              ifc_guid = excluded.ifc_guid, ifc_type = excluded.ifc_type,
              predefined_type = excluded.predefined_type,
              user_defined_type = excluded.user_defined_type,
              properties = excluded.properties, updated_at = now(),
              valid_until = null    -- objekt je znova v modeli (D-087)
            returning id
            """,
            (
                o.object_type, o.object_ref, o.name, o.ifc_guid, o.ifc_type,
                o.predefined_type, o.user_defined_type, Json(o.properties or {}),
            ),
        ).fetchone()
        out[o.object_ref] = row[0]
    return out


def _load_appendices(cur, model: StagedModel, obj_ids: dict[str, str]) -> None:
    for o in model.objects:
        oid = obj_ids[o.object_ref]
        if o.elevation is not None:
            cur.execute(
                "insert into floors (id, elevation) values (%s, %s) "
                "on conflict (id) do update set elevation = excluded.elevation",
                (oid, o.elevation),
            )
        if o.long_name is not None:
            cur.execute(
                "insert into spaces (id, long_name) values (%s, %s) "
                "on conflict (id) do update set long_name = excluded.long_name",
                (oid, o.long_name),
            )
        if o.document is not None:
            d = o.document
            cur.execute(
                """
                insert into documents
                  (id, identification, description, location, purpose, revision,
                   document_owner, status, valid_from, valid_until)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (id) do update set
                  identification = excluded.identification, description = excluded.description,
                  location = excluded.location, purpose = excluded.purpose,
                  revision = excluded.revision, document_owner = excluded.document_owner,
                  status = excluded.status, valid_from = excluded.valid_from,
                  valid_until = excluded.valid_until
                """,
                (
                    oid, d.identification, d.description, d.location, d.purpose,
                    d.revision, d.document_owner, d.status, d.valid_from, d.valid_until,
                ),
            )
        if o.person is not None:
            p = o.person
            cur.execute(
                """
                insert into persons (id, given_name, family_name, email, phone)
                values (%s, %s, %s, %s, %s)
                on conflict (id) do update set
                  given_name = excluded.given_name, family_name = excluded.family_name,
                  email = excluded.email, phone = excluded.phone
                """,
                (oid, p.given_name, p.family_name, p.email, p.phone),
            )


def _load_guid_history(cur, model: StagedModel, obj_ids: dict[str, str]) -> None:
    for g in model.guid_history:
        hid = ids.guid_history_id(g.object_ref, g.ifc_guid)
        if g.valid_until is None:
            # Rotácia GUID (D-010): pred insertom nového aktívneho záznamu uzavri
            # predošlý aktívny s iným GUID — inak partial unique index
            # uniq_active_guid (object_id WHERE valid_until IS NULL) zhodí celý load.
            cur.execute(
                """
                update ifc_guid_history
                set valid_until = now()
                where object_id = %s and valid_until is null and ifc_guid <> %s
                """,
                (obj_ids[g.object_ref], g.ifc_guid),
            )
        cur.execute(
            """
            insert into ifc_guid_history
              (id, object_id, ifc_guid, valid_from, valid_until, source)
            values (%s, %s, %s, coalesce(%s, now()), %s, %s)
            on conflict (id) do update set
              valid_until = excluded.valid_until, source = excluded.source
            """,
            (hid, obj_ids[g.object_ref], g.ifc_guid, g.valid_from, g.valid_until, g.source),
        )


def _resolve_cross_file_refs(cur, model: StagedModel, obj_ids: dict[str, str]) -> None:
    """Doplní `obj_ids` o endpointy hrán, ktoré už existujú v DB (nie v tomto behu).

    Federate load (D-049): VZT MEP containment ukazuje na **existujúce** floor uzly,
    ktoré tento beh neemitoval. Dohľadáme ich id cez `object_ref`. Chýbajúci ref
    (ani v behu, ani v DB) = tvrdá chyba (zlá federačná väzba)."""
    missing = {
        ref
        for e in model.edges
        for ref in (e.from_ref, e.to_ref)
        if ref not in obj_ids
    }
    if not missing:
        return
    rows = cur.execute(
        "select object_ref, id from objects where object_ref = any(%s)",
        (list(missing),),
    ).fetchall()
    for object_ref, oid in rows:
        obj_ids[object_ref] = oid
    still = missing - obj_ids.keys()
    if still:
        raise ValueError(
            f"Hrany odkazujú na neexistujúce object_ref (federácia, D-049): {sorted(still)}"
        )


def _load_edges(cur, model: StagedModel, obj_ids: dict[str, str]) -> None:
    _resolve_cross_file_refs(cur, model, obj_ids)
    for e in model.edges:
        rel_type = EDGE_TYPE_TO_REL_TYPE[e.edge_type]
        # `edge_id` (deterministické UUIDv5 z edge_type, D-031) sa NEmení → re-run
        # idempotentný cez `ON CONFLICT (id)`. `role` je nullable pre všetky typy.
        eid = ids.edge_id(e.from_ref, e.to_ref, e.edge_type)
        from_id, to_id = obj_ids[e.from_ref], obj_ids[e.to_ref]
        if rel_type in UNIQUE_ACTIVE_FROM and e.valid_until is None:
            # Nový rodič (presun prvku, zlúčenie priestorov; D-086): pred insertom uzavri
            # iný aktívny záznam toho istého from_id — inak parciálny unique index
            # uniq_active_* zhodí celý load. Vzor rotácie GUID (D-010).
            cur.execute(
                "update relationships set valid_until = now() "
                "where rel_type = %s and from_id = %s and valid_until is null and id <> %s",
                (rel_type, from_id, eid),
            )
        cur.execute(
            """
            insert into relationships
              (id, rel_type, from_id, to_id, role, valid_from, valid_until, source)
            values (%s, %s, %s, %s, %s, coalesce(%s, now()), %s, %s)
            on conflict (id) do update set
              rel_type = excluded.rel_type, role = excluded.role,
              valid_until = excluded.valid_until, source = excluded.source
            """,
            (eid, rel_type, from_id, to_id, e.role, e.valid_from, e.valid_until, e.source),
        )


def _load_class_links(
    cur, model: StagedModel, obj_ids: dict[str, str], ref_ids: dict[tuple[str, str], str]
) -> None:
    # rel_associates_classification je výnimka: to_id → classification_references
    # (nie objects). V generickej `relationships` je to len iný `rel_type`
    # (`to_is_classification` v manifeste); trigger to zohľadní.
    rel_type = EDGE_TYPE_TO_REL_TYPE["has_classification"]
    for c in model.class_links:
        ref_id = ref_ids[(c.system_name, c.identification)]
        cid = ids.edge_id(c.from_ref, f"{c.system_name}:{c.identification}", "has_classification")
        cur.execute(
            """
            insert into relationships
              (id, rel_type, from_id, to_id, valid_from, valid_until, source)
            values (%s, %s, %s, %s, coalesce(%s, now()), %s, %s)
            on conflict (id) do update set
              rel_type = excluded.rel_type,
              valid_until = excluded.valid_until, source = excluded.source
            """,
            (cid, rel_type, obj_ids[c.from_ref], ref_id, c.valid_from, c.valid_until, c.source),
        )
