"""Load vrstva — idempotentný upsert staged modelu do Supabase Postgresu (D-031).

Poradie rešpektuje FK závislosti. `objects` sa upsertujú cez `object_ref`
(`id` ostáva DB-generované, verné D-010); ostatné tabuľky bez prirodzeného
unique používajú deterministické UUID (`ids.py`). Všetko v jednej transakcii.
"""

from __future__ import annotations

from typing import Optional

import psycopg
from psycopg.types.json import Json

from . import documents, ids
from . import project as project_mod
from .manifest import _SPECS, EDGE_TYPE_TO_REL_TYPE, FROM_REVISION_COPY
from .model import GuidAlias, StagedModel

# D-051: hrany už nemajú per-vzťah tabuľku — všetky idú do generickej `relationships`
# (diskriminátor `rel_type`). Interný ETL `edge_type` → kanonický `rel_type` drží
# manifest (`etl/manifest.py`, jeden zdroj pravdy). Zapisujeme BASE tabuľku, nie
# kanonické views (tie sú len na čítanie).

# rel_type s parciálnym unique indexom "1 aktívny rodič na from_id" (manifest).
UNIQUE_ACTIVE_FROM = frozenset(s.rel_type for s in _SPECS if s.unique_active_from)

# D-183 K3 krok 3: typy hrán, ktoré pohľady čítajú z kópie revízie; ETL ich nezapisuje ani neuzatvára.
COPY_REL_TYPES = sorted(FROM_REVISION_COPY)


def writes_edge(edge_type: str, source: Optional[str]) -> bool:
    """Zapisuje ETL grafu túto hranu do `relationships`? Nie, ak je to IFC vzťah zo súboru (zdroj `etl`,
    `etl:<model>`), ktorý pohľad číta z kópie revízie. Hrana AIM vrstvy (iný zdroj) sa zapíše vždy,
    rovnako ako ju pohľady čítajú (`rel_is_aim_layer`)."""
    if EDGE_TYPE_TO_REL_TYPE[edge_type] not in FROM_REVISION_COPY:
        return True
    return not (source == LEGACY_EDGE_SOURCE or (source or "").startswith(LEGACY_EDGE_SOURCE + ":"))


def reset_data(cur, project_id: str) -> None:
    """Empty the AIM graph of ONE project before a load (D-189; originally E2, replacing the seed).

    Other projects are never touched, so nothing is truncated: the project's edges and GUID aliases go first,
    then its nodes except the project node (the cascade removes appendices and GUID history). The project node,
    its model revisions, containers and runs stay; classification tables and actors are global and stay too.
    Never run against production (AGENTS.md)."""
    cur.execute("delete from relationships where project_id = %s", (project_id,))
    cur.execute("delete from ifc_guid_aliases where project_id = %s", (project_id,))
    cur.execute("delete from objects where project_id = %s and id <> %s", (project_id, project_id))


def load_model(
    url: str, model: StagedModel, reset: bool = False, scope: str | None = None,
    storage_base: Optional[str] = None, project_code: Optional[str] = None,
) -> dict[str, int]:
    """Zapíše celý staged model v jednej transakcii (commit na konci).

    `reset=True` najprv vyprázdni AIM dáta (nahradenie seedu, E2) — stále v tej
    istej transakcii, takže pri chybe sa nič nezahodí.

    `scope` = meno modelu federácie (`ASR`, `VZT`; D-086). Hrany a GUID história
    dostanú zdroj tohto modelu (`etl:ASR`, `IFC import:ASR`) a čo tento beh už
    nevydal, sa uzavrie (`valid_until = now()`) — zmazaný prvok, presunutý prvok,
    zmenený typ či klasifikácia. Vzor `etl.derive` (D-080). Objekt bez aktívneho GUID
    dostane `valid_until` (D-088); riadok ostáva (D-010) a pri návrate do modelu ožije.
    Vráti počty uzavretých záznamov.

    `storage_base` = `SUPABASE_URL`: `Location` dokumentov sa preloží na URL súboru v
    buckete `documents`, ak tam je (D-104, `documents.resolve_locations`).

    `project_code` (default the code staged from the file, else OCB): every row is written into that project
    (D-189). The first main-model load of a new code creates the project node from the file's IfcProject.
    """
    closed = {"edges": 0, "guids": 0, "objects": 0, "documents": 0, "repointed": 0}
    if scope:
        scope_sources(model, scope)
        documents.mark_model(model, scope)
    code = project_code or model.project_code or project_mod.OCB_CODE
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            documents.resolve_locations(model, documents.bucket_names(cur), storage_base)
            project_id = load_project(cur, model, code)
            if reset:
                reset_data(cur, project_id)
            sys_ids = _load_systems(cur, model)
            ref_ids = _load_refs(cur, model, sys_ids)
            obj_ids = _load_objects(cur, model, project_id)
            _load_appendices(cur, model, obj_ids)
            _load_guid_history(cur, model, obj_ids)
            alias_ids = _load_guid_aliases(cur, model, obj_ids, project_id)
            _load_edges(cur, model, obj_ids, project_id)
            _load_class_links(cur, model, obj_ids, ref_ids)
            if scope:
                closed = close_stale(cur, model, scope, project_id, alias_ids)
        conn.commit()
    return closed


def load_project(cur, model: StagedModel, code: str) -> str:
    """Resolve (or create) the project node of the run and map this file's IfcProject onto it (D-189).

    - Node missing: the main model creates it from its IfcProject row (the trigger sets `project_id = id`);
      a discipline model (`--federate`) cannot, the main model is loaded first.
    - Node present and this file's IfcProject has another GlobalId (IFC defines IfcProject per exchange): the
      node keeps its GUID and the file's GlobalId becomes an alias of the node.
    Returns the project id."""
    row = next((o for o in model.objects if o.object_type == "project" and o.object_ref == code), None)
    found = cur.execute(
        "select id, ifc_guid from objects where object_type = 'project' and object_ref = %s",
        (code,),
    ).fetchone()
    if found is None:
        if row is None:
            raise project_mod.ProjectError(
                f"Project '{code}' does not exist yet; load the main model of the project first "
                f"(without --federate), it creates the project node (D-189)."
            )
        created = cur.execute(
            "insert into objects (object_type, object_ref, name, ifc_guid, ifc_type) "
            "values ('project', %s, %s, %s, %s) returning id",
            (code, row.name, row.ifc_guid, row.ifc_type),
        ).fetchone()
        return str(created[0])
    project_id, node_guid = str(found[0]), found[1]
    file_guid = model.project_guid
    if row is not None and file_guid and node_guid and file_guid != node_guid:
        row.ifc_guid = node_guid
        for g in model.guid_history:
            if g.object_ref == code and g.ifc_guid == file_guid:
                g.ifc_guid = node_guid
        if not any(a.object_ref == code and a.ifc_guid == file_guid for a in model.guid_aliases):
            source = next((g.source for g in model.guid_history if g.object_ref == code), LEGACY_GUID_SOURCE)
            model.guid_aliases.append(GuidAlias(object_ref=code, ifc_guid=file_guid,
                                                reason=project_mod.ALIAS_REASON, source=source))
    return project_id


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
    for a in model.guid_aliases:
        if a.source == LEGACY_GUID_SOURCE:
            a.source = guid_source(scope)


def emitted_ids(model: StagedModel) -> tuple[list[str], list[str]]:
    """Id hrán (vrátane klasifikačných) a aktívnych GUID záznamov, ktoré tento beh zapísal.
    Hrany typov z kópie revízie (D-183 K3) ETL nezapisuje, preto tu nie sú."""
    edges = [ids.edge_id(e.from_ref, e.to_ref, e.edge_type) for e in model.edges
             if writes_edge(e.edge_type, e.source)]
    edges += [
        ids.edge_id(c.from_ref, f"{c.system_name}:{c.identification}", c.edge_type)
        for c in model.class_links
        if writes_edge(c.edge_type, c.source)
    ]
    guids = [
        ids.guid_history_id(g.object_ref, g.ifc_guid)
        for g in model.guid_history
        if g.valid_until is None
    ]
    return edges, guids


# Objekt zanikol (D-088): mal GUID zo zdroja `source`, ale už nemá žiadny aktívny GUID.
_RETIRE_OBJECTS = (
    "update objects o set valid_until = now() "
    "where o.valid_until is null and o.ifc_guid is not null "
    "and exists (select 1 from ifc_guid_history h where h.object_id = o.id and h.source = %s) "
    "and not exists (select 1 from ifc_guid_history h "
    "where h.object_id = o.id and h.valid_until is null) and o.project_id = %s returning o.id"
)


def close_stale(cur, model: StagedModel, scope: str, project_id: str = project_mod.OCB_ID,
                alias_ids: Optional[list[str]] = None) -> dict[str, int]:
    """Uzavrie aktívne hrany, GUID záznamy a objekty modelu `scope`, ktoré tento beh nevydal.

    Hrany typov z kópie revízie (D-183 K3 krok 3) sa nechajú, ako sú: ETL ich už nevydáva a ich
    ukončenie je samostatný krok na Samuelovo slovo (`supabase/pending/`), nie vedľajší účinok re-ETL."""
    # The model code (source `etl:ASR`) is unique only within a project (D-189), so every statement is
    # scoped to the run's project.
    edges, guids = emitted_ids(model)
    closed_edges = cur.execute(
        "update relationships set valid_until = now() "
        "where source = %s and project_id = %s and valid_until is null and not (rel_type = any(%s)) "
        "and not (id = any(%s)) returning id",
        (edge_source(scope), project_id, COPY_REL_TYPES, edges),
    ).fetchall()
    closed_guids = cur.execute(
        "update ifc_guid_history h set valid_until = now() "
        "where h.source = %s and h.valid_until is null and not (h.id = any(%s)) "
        "and exists (select 1 from objects o where o.id = h.object_id and o.project_id = %s) returning h.id",
        (guid_source(scope), guids, project_id),
    ).fetchall()
    aliases = alias_ids if alias_ids is not None else [
        ids.guid_alias_id(a.object_ref, a.ifc_guid) for a in model.guid_aliases]
    closed_guids += cur.execute(
        "update ifc_guid_aliases set valid_until = now() "
        "where source = %s and project_id = %s and valid_until is null and not (id = any(%s)) returning id",
        (guid_source(scope), project_id, aliases),
    ).fetchall()
    retired = cur.execute(_RETIRE_OBJECTS, (guid_source(scope), project_id)).fetchall()
    # Dokumenty nemajú GUID: model ich značí `_model`, čo už nevydal, zaniká (D-104).
    docs = [o.object_ref for o in model.objects if o.object_type in documents.DOCUMENT_TYPES]
    retired_docs = cur.execute(
        documents.RETIRE_DOCUMENTS, (list(documents.DOCUMENT_TYPES), scope, project_id, docs)
    ).fetchall()
    return {"edges": len(closed_edges), "guids": len(closed_guids), "objects": len(retired),
            "documents": len(retired_docs), "repointed": repoint_to_successors(cur, project_id)}


# Ručné väzby (výkresy E4, dokumenty E3, fotky D-073) na zaniknutý objekt prejdú na
# platný objekt s rovnakým GUID: premenovaný object_ref je ten istý prvok (D-088).
# Väzby ETL a derive si model vydá sám, tie sa nepresúvajú.
_REPOINT = """
    update relationships r set {end}_id = s.new_id
    from (select o.id as old_id, n.id as new_id
          from objects o join objects n
            on n.ifc_guid = o.ifc_guid and n.project_id = o.project_id
           and n.valid_until is null and n.id <> o.id
          where o.valid_until is not null and o.ifc_guid is not null and o.project_id = %s) s
    where r.{end}_id = s.old_id and r.valid_until is null
      and r.source not like 'etl%%' and r.source not like 'derive:%%'
    returning r.id
"""


def repoint_to_successors(cur, project_id: str = project_mod.OCB_ID) -> int:
    """Presmeruje aktívne ručné väzby zo zaniknutých objektov na nástupcu s rovnakým GUID.
    A GUID is unique only within a project (D-189): the successor is searched in the same project."""
    moved = 0
    for end in ("from", "to"):
        moved += len(cur.execute(_REPOINT.format(end=end), (project_id,)).fetchall())
    return moved


def close_legacy(cur, project_id: str = project_mod.OCB_ID) -> dict[str, int]:
    """Jednorazovo po prvom loade všetkých modelov so `scope` (D-086): čo ostalo aktívne
    so starým zdrojom bez mena modelu, už žiadny model nevydal → uzavrieť. Only within one project (D-189)."""
    closed_edges = cur.execute(
        "update relationships set valid_until = now() "
        "where source = %s and project_id = %s and valid_until is null returning id",
        (LEGACY_EDGE_SOURCE, project_id),
    ).fetchall()
    closed_guids = cur.execute(
        "update ifc_guid_history h set valid_until = now() "
        "where h.source = %s and h.valid_until is null "
        "and exists (select 1 from objects o where o.id = h.object_id and o.project_id = %s) returning h.id",
        (LEGACY_GUID_SOURCE, project_id),
    ).fetchall()
    retired = cur.execute(_RETIRE_OBJECTS, (LEGACY_GUID_SOURCE, project_id)).fetchall()
    return {"edges": len(closed_edges), "guids": len(closed_guids), "objects": len(retired),
            "repointed": repoint_to_successors(cur, project_id)}


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


# Kľúče `objects.properties`, ktoré nezapisuje ETL, ale hostiteľ, a re-ETL ich nesmie
# zmazať: kalibrácia podkladu výkresu (`_georef`, PATCH /api/underlay, D-072; D-104).
HOST_PROPERTY_KEYS = ("_georef",)


def _load_objects(cur, model: StagedModel, project_id: str) -> dict[str, str]:
    """Upsert `objects` cez object_ref; vráti mapu object_ref → DB id.

    Every row is written into `project_id` (D-189; the trigger nulls it for person and organization). An
    `object_ref` held by another project is never taken over: the update only applies within the same
    project (or to the project node itself), and a refused row aborts the load."""
    out: dict[str, str] = {}
    foreign: list[str] = []
    for o in model.objects:
        if not o.object_ref:
            raise ValueError(f"objekt bez object_ref (typ {o.object_type}) — D-031 vyžaduje stabilný ref")
        row = cur.execute(
            """
            insert into objects
              (object_type, object_ref, name, ifc_guid, ifc_type,
               predefined_type, user_defined_type, properties, project_id)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (object_ref) do update set
              object_type = excluded.object_type, name = excluded.name,
              ifc_guid = excluded.ifc_guid, ifc_type = excluded.ifc_type,
              predefined_type = excluded.predefined_type,
              user_defined_type = excluded.user_defined_type,
              -- model prepíše svoje vlastnosti, kľúče hostiteľa (HOST_PROPERTY_KEYS) ostanú
              properties = excluded.properties || (
                select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                from jsonb_each(objects.properties) e
                where e.key = any(%s)
              ),
              updated_at = now(),
              valid_until = null    -- objekt je znova v modeli (D-088)
            where objects.project_id is not distinct from excluded.project_id
               or (objects.object_type = 'project' and excluded.object_type = 'project')
            returning id
            """,
            (
                o.object_type, o.object_ref, o.name, o.ifc_guid, o.ifc_type,
                o.predefined_type, o.user_defined_type, Json(o.properties or {}),
                project_id, list(HOST_PROPERTY_KEYS),
            ),
        ).fetchone()
        if row is None:
            foreign.append(o.object_ref)
            continue
        out[o.object_ref] = row[0]
    if foreign:
        raise project_mod.ProjectError(
            f"{len(foreign)} object_ref already belong to another project (QR tags are unique across the "
            f"platform, D-189): {sorted(foreign)[:20]}"
        )
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
            referenced = obj_ids[d.referenced_document_ref] if d.referenced_document_ref else None
            cur.execute(
                """
                insert into documents
                  (id, identification, description, location, purpose, revision,
                   document_owner, status, valid_from, valid_until, storage_type,
                   creation_time, last_revision_time, electronic_format, referenced_document_id)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (id) do update set
                  identification = excluded.identification, description = excluded.description,
                  location = excluded.location, purpose = excluded.purpose,
                  revision = excluded.revision, document_owner = excluded.document_owner,
                  status = excluded.status, valid_from = excluded.valid_from,
                  valid_until = excluded.valid_until, storage_type = excluded.storage_type,
                  creation_time = excluded.creation_time,
                  last_revision_time = excluded.last_revision_time,
                  electronic_format = excluded.electronic_format,
                  referenced_document_id = excluded.referenced_document_id
                """,
                (
                    oid, d.identification, d.description, d.location, d.purpose,
                    d.revision, d.document_owner, d.status, d.valid_from, d.valid_until,
                    d.storage_type, d.creation_time, d.last_revision_time,
                    d.electronic_format, referenced,
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


def existing_alias(cur, project_id: str, ifc_guid: str, object_id: str, reason: str) -> Optional[str]:
    """Id of an active alias that already says the same (project, GUID, node, reason), e.g. one backfilled by
    a migration under another id. A re-run keeps it instead of closing and re-inserting it (D-189)."""
    row = cur.execute(
        "select id from ifc_guid_aliases where project_id = %s and ifc_guid = %s and object_id = %s "
        "and reason = %s and valid_until is null",
        (project_id, ifc_guid, object_id, reason),
    ).fetchone()
    return str(row[0]) if row else None


def _load_guid_aliases(cur, model: StagedModel, obj_ids: dict[str, str], project_id: str) -> list[str]:
    """GUID zlúčených IFC typov -> `asset_type` (D-033 ako údaj, D-183 K3 krok 3). Aktívny alias GUID
    je najviac jeden (`uniq_active_guid_alias`): iný aktívny alias toho GUID (napr. spätné doplnenie
    migráciou, typ prešiel pod iný kód) sa najprv uzavrie.

    D-189: aliases belong to the run's project and only that project's aliases are closed. The IfcProject of
    another file is an alias of the project node. An active alias with the same meaning (backfilled by a
    migration under another id: the type aliases of 31 Oct, OCB's VZT IfcProject) is kept as it is.
    Returns the ids of the aliases this run holds active, for `close_stale`."""
    active: list[str] = []
    for a in model.guid_aliases:
        aid = ids.guid_alias_id(a.object_ref, a.ifc_guid)
        object_id = obj_ids.get(a.object_ref) or (project_id if a.object_ref == model.project_code else None)
        if object_id is None:
            raise ValueError(f"GUID alias {a.ifc_guid} points at unknown object_ref {a.object_ref}")
        kept = existing_alias(cur, project_id, a.ifc_guid, str(object_id), a.reason)
        if kept is not None:
            active.append(kept)
            continue
        active.append(aid)
        cur.execute(
            "update ifc_guid_aliases set valid_until = now() "
            "where ifc_guid = %s and project_id = %s and valid_until is null and id <> %s",
            (a.ifc_guid, project_id, aid),
        )
        cur.execute(
            """
            insert into ifc_guid_aliases (id, object_id, ifc_guid, reason, valid_until, source, project_id)
            values (%s, %s, %s, %s, null, %s, %s)
            on conflict (id) do update set
              object_id = excluded.object_id, reason = excluded.reason,
              valid_until = null, source = excluded.source
            """,
            (aid, object_id, a.ifc_guid, a.reason, a.source, project_id),
        )
    return active


def _resolve_cross_file_refs(cur, model: StagedModel, obj_ids: dict[str, str], project_id: str) -> None:
    """Doplní `obj_ids` o endpointy hrán, ktoré už existujú v DB (nie v tomto behu).

    Federate load (D-049): VZT MEP containment ukazuje na **existujúce** floor uzly,
    ktoré tento beh neemitoval. Dohľadáme ich id cez `object_ref`. Chýbajúci ref
    (ani v behu, ani v DB) = tvrdá chyba (zlá federačná väzba)."""
    missing = {
        ref
        for e in model.edges
        if writes_edge(e.edge_type, e.source)
        for ref in (e.from_ref, e.to_ref)
        if ref not in obj_ids
    }
    if not missing:
        return
    rows = cur.execute(
        "select object_ref, id from objects where object_ref = any(%s) "
        "and (project_id = %s or project_id is null)",
        (list(missing), project_id),
    ).fetchall()
    for object_ref, oid in rows:
        obj_ids[object_ref] = oid
    still = missing - obj_ids.keys()
    if still:
        raise ValueError(
            f"Hrany odkazujú na neexistujúce object_ref (federácia, D-049): {sorted(still)}"
        )


def _load_edges(cur, model: StagedModel, obj_ids: dict[str, str], project_id: str) -> None:
    # `relationships.project_id` is set by the validation trigger from the endpoints; an edge across
    # projects is rejected there (D-189).
    _resolve_cross_file_refs(cur, model, obj_ids, project_id)
    for e in model.edges:
        if not writes_edge(e.edge_type, e.source):
            continue  # IFC vzťah zo súboru, pohľad ho číta z kópie revízie (D-183 K3 krok 3)
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
    # (`to_is_classification` v manifeste); trigger to zohľadní. Typ dokumentu (D-104) ide
    # tou istou cestou s iným `rel_type`.
    for c in model.class_links:
        if not writes_edge(c.edge_type, c.source):
            continue  # IfcRelAssociatesClassification zo súboru: pohľad z kópie revízie (D-183 K3 krok 3)
        rel_type = EDGE_TYPE_TO_REL_TYPE[c.edge_type]
        ref_id = ref_ids[(c.system_name, c.identification)]
        cid = ids.edge_id(c.from_ref, f"{c.system_name}:{c.identification}", c.edge_type)
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
