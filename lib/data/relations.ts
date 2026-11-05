import "server-only";

import { unstable_cache } from "next/cache";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { AIM_CACHE, PDF_LINK_SOURCE } from "@/lib/data/constants";

/**
 * Data-access vrstva pre generické sekcie uzla (S3, D-029): dokumenty,
 * zodpovednosti a história IFC GUID. Všetko nad ľubovoľným `objects` uzlom —
 * sekcie sa zobrazia na asset karte aj na priestorových uzloch.
 *
 * Zobrazujú sa len **aktívne** väzby (`valid_until IS NULL`), konzistentne s
 * S1/S2. Všetko server-side cez `service_role` (D-026).
 */

export interface DocumentRef {
  /** Document `objects.id` — cieľ odkazu `/node/[id]`. */
  id: string;
  objectRef: string | null;
  name: string | null;
  /** rel_associates_document.role: 'manual','certificate','as-built'… */
  role: string | null;
  identification: string | null;
  description: string | null;
  location: string | null;
  revision: string | null;
  status: string | null;
  validFrom: string | null;
  validUntil: string | null;
}

/** Výkres, v ktorom je prvok zobrazený (E4, D-041) — s verejným PDF URL. */
export interface DrawingLink {
  /** Document `objects.id` — cieľ odkazu `/node/[id]`. */
  id: string;
  objectRef: string | null;
  name: string | null;
  /** Verejné URL PDF (`documents.location`) — priamy odkaz na výkres. */
  location: string | null;
}

/** Prvok zobrazený vo výkrese (E4, D-041) — pre kartu podlažia. */
export interface ElementInDrawing {
  id: string;
  objectType: "asset" | "asset_type";
  objectRef: string | null;
  name: string | null;
}

/** Výkres podlažia + zoznam prvkov, ktoré sú v ňom zobrazené (E4, D-041). */
export interface FloorDrawing {
  drawing: DrawingLink;
  elements: ElementInDrawing[];
}

/** Systém, ktorého je prvok členom (`rel_assigns_to_group`, D-047) — pre asset kartu. */
export interface SystemRef {
  /** System `objects.id` — cieľ odkazu `/node/[id]`. */
  id: string;
  objectRef: string | null;
  name: string | null;
  /** IfcDistributionSystemEnum (VENTILATION/EXHAUST…). */
  predefinedType: string | null;
}

export interface ActorOrg {
  id: string;
  name: string | null;
}

export interface Responsibility {
  actorId: string;
  actorType: "person" | "organization";
  actorName: string | null;
  actorRef: string | null;
  /** Acting rola (rel_assigns_to_actor.role): 'operator','maintainer'… */
  role: string;
  validFrom: string | null;
  validUntil: string | null;
  /** Firma osoby (rel_member_of) — len pri person actoroch. */
  org: ActorOrg | null;
}

export interface GuidHistoryEntry {
  id: string;
  ifcGuid: string;
  validFrom: string | null;
  /** NULL = aktuálny GUID. */
  validUntil: string | null;
  source: string | null;
  active: boolean;
}

export interface NodeSectionsData {
  documents: DocumentRef[];
  /** Výkresy, v ktorých je tento prvok zobrazený (E4) — vlastná sekcia. */
  drawings: DrawingLink[];
  responsibilities: Responsibility[];
  guidHistory: GuidHistoryEntry[];
}

/** Generické sekcie uzla naraz (paralelne) — jeden vstupný bod pre Viewer. */
async function fetchNodeSectionsImpl(
  objectId: string
): Promise<NodeSectionsData> {
  const [documents, drawings, responsibilities, guidHistory] = await Promise.all([
    fetchDocuments(objectId),
    fetchElementDrawings(objectId),
    fetchResponsibilities(objectId),
    fetchGuidHistory(objectId),
  ]);
  return { documents, drawings, responsibilities, guidHistory };
}

/** Cachované per id (ISR, D-029 perf). */
export const fetchNodeSections = unstable_cache(
  fetchNodeSectionsImpl,
  ["fetch-node-sections"],
  AIM_CACHE
);

/** Dokumenty pripojené na uzol (`rel_associates_document` → `documents`, D-014). */
export async function fetchDocuments(objectId: string): Promise<DocumentRef[]> {
  const supabase = getSupabaseAdmin();

  const { data: rels, error } = await supabase
    .from("rel_associates_document")
    .select("to_id, role, source")
    .eq("from_id", objectId)
    .is("valid_until", null)
    .not("to_id", "is", null); // dokument bez uzla AIM (D-183 K3)
  if (error) throw new Error(error.message);

  // E4 výkres-väzby (prvok zobrazený vo výkrese) idú do vlastnej sekcie, nie sem.
  const relRows = ((rels ?? []) as {
    to_id: string;
    role: string | null;
    source: string | null;
  }[]).filter((r) => r.source !== PDF_LINK_SOURCE);
  if (relRows.length === 0) return [];

  const docIds = [...new Set(relRows.map((r) => r.to_id))];

  const [objsRes, docsRes] = await Promise.all([
    supabase.from("objects").select("id, object_ref, name").in("id", docIds),
    supabase
      .from("documents")
      .select(
        "id, identification, description, location, revision, status, valid_from, valid_until"
      )
      .in("id", docIds),
  ]);
  if (objsRes.error) throw new Error(objsRes.error.message);
  if (docsRes.error) throw new Error(docsRes.error.message);

  const objById = new Map((objsRes.data ?? []).map((o) => [o.id as string, o]));
  const docById = new Map((docsRes.data ?? []).map((d) => [d.id as string, d]));

  return relRows
    .map((r) => {
      const o = objById.get(r.to_id);
      const d = docById.get(r.to_id);
      return {
        id: r.to_id,
        objectRef: (o?.object_ref as string | null) ?? null,
        name: (o?.name as string | null) ?? null,
        role: r.role,
        identification: (d?.identification as string | null) ?? null,
        description: (d?.description as string | null) ?? null,
        location: (d?.location as string | null) ?? null,
        revision: (d?.revision as string | null) ?? null,
        status: (d?.status as string | null) ?? null,
        validFrom: (d?.valid_from as string | null) ?? null,
        validUntil: (d?.valid_until as string | null) ?? null,
      };
    })
    .sort((a, b) =>
      (a.name ?? a.objectRef ?? "").localeCompare(b.name ?? b.objectRef ?? "", "sk")
    );
}

/**
 * Výkresy, v ktorých je prvok (asset/asset_type) **zobrazený** — E4 auto-linking
 * (`rel_associates_document` so `source='pdf_link (E4)'`, smer prvok → výkres, D-041).
 * Vracia priame verejné PDF URL (`documents.location`).
 */
export async function fetchElementDrawings(
  objectId: string
): Promise<DrawingLink[]> {
  const supabase = getSupabaseAdmin();

  const { data: rels, error } = await supabase
    .from("rel_associates_document")
    .select("to_id")
    .eq("from_id", objectId)
    .eq("source", PDF_LINK_SOURCE)
    .is("valid_until", null);
  if (error) throw new Error(error.message);

  const docIds = [...new Set((rels ?? []).map((r) => r.to_id as string))];
  if (docIds.length === 0) return [];

  const [objsRes, docsRes] = await Promise.all([
    supabase.from("objects").select("id, object_ref, name").in("id", docIds),
    supabase.from("documents").select("id, location").in("id", docIds),
  ]);
  if (objsRes.error) throw new Error(objsRes.error.message);
  if (docsRes.error) throw new Error(docsRes.error.message);

  const locById = new Map(
    (docsRes.data ?? []).map((d) => [d.id as string, (d.location as string | null) ?? null])
  );

  return (objsRes.data ?? [])
    .map((o) => ({
      id: o.id as string,
      objectRef: (o.object_ref as string | null) ?? null,
      name: (o.name as string | null) ?? null,
      location: locById.get(o.id as string) ?? null,
    }))
    .sort((a, b) =>
      (a.name ?? a.objectRef ?? "").localeCompare(b.name ?? b.objectRef ?? "", "sk")
    );
}

/**
 * Výkresy uzla (E3, `role='drawing'`) + prvky v každom z nich (E4). Pre kartu
 * podlažia/budovy: „ktoré prvky sú zobrazené v tomto výkrese" (D-041). Výkres bez
 * detegovaných prvkov sa **nezobrazí** (prázdny zoznam nemá výpovednú hodnotu).
 */
export async function fetchFloorDrawings(
  objectId: string
): Promise<FloorDrawing[]> {
  const supabase = getSupabaseAdmin();

  // 1) výkresy pripojené na uzol (E3 floor→drawing); E4 element-väzby vynechané
  const { data: drawRels, error } = await supabase
    .from("rel_associates_document")
    .select("to_id, source")
    .eq("from_id", objectId)
    .eq("role", "drawing")
    .is("valid_until", null);
  if (error) throw new Error(error.message);

  const drawingIds = [
    ...new Set(
      ((drawRels ?? []) as { to_id: string; source: string | null }[])
        .filter((r) => r.source !== PDF_LINK_SOURCE)
        .map((r) => r.to_id)
    ),
  ];
  if (drawingIds.length === 0) return [];

  // 2) výkres-meta + prvky zobrazené v každom výkrese (E4, smer element→výkres)
  const [objsRes, docsRes, elemRelsRes] = await Promise.all([
    supabase.from("objects").select("id, object_ref, name").in("id", drawingIds),
    supabase.from("documents").select("id, location").in("id", drawingIds),
    supabase
      .from("rel_associates_document")
      .select("from_id, to_id")
      .in("to_id", drawingIds)
      .eq("source", PDF_LINK_SOURCE)
      .is("valid_until", null),
  ]);
  if (objsRes.error) throw new Error(objsRes.error.message);
  if (docsRes.error) throw new Error(docsRes.error.message);
  if (elemRelsRes.error) throw new Error(elemRelsRes.error.message);

  const drawObjById = new Map((objsRes.data ?? []).map((o) => [o.id as string, o]));
  const locById = new Map(
    (docsRes.data ?? []).map((d) => [d.id as string, (d.location as string | null) ?? null])
  );
  const elemRels = (elemRelsRes.data ?? []) as { from_id: string; to_id: string }[];

  // prvky (asset/asset_type) jedným dotazom
  const elemIds = [...new Set(elemRels.map((r) => r.from_id))];
  const elemById = new Map<string, ElementInDrawing>();
  if (elemIds.length > 0) {
    const { data: elems, error: elErr } = await supabase
      .from("objects")
      .select("id, object_type, object_ref, name")
      .in("id", elemIds)
      .in("object_type", ["asset", "asset_type"]);
    if (elErr) throw new Error(elErr.message);
    for (const e of elems ?? []) {
      elemById.set(e.id as string, {
        id: e.id as string,
        objectType: e.object_type as "asset" | "asset_type",
        objectRef: (e.object_ref as string | null) ?? null,
        name: (e.name as string | null) ?? null,
      });
    }
  }

  // zoskup prvky podľa výkresu
  const elementsByDrawing = new Map<string, ElementInDrawing[]>();
  for (const r of elemRels) {
    const el = elemById.get(r.from_id);
    if (!el) continue;
    const list = elementsByDrawing.get(r.to_id) ?? [];
    list.push(el);
    elementsByDrawing.set(r.to_id, list);
  }

  return drawingIds
    .map((did) => {
      const o = drawObjById.get(did);
      const elements = (elementsByDrawing.get(did) ?? []).sort((a, b) =>
        (a.objectRef ?? a.name ?? "").localeCompare(b.objectRef ?? b.name ?? "", "sk")
      );
      return {
        drawing: {
          id: did,
          objectRef: (o?.object_ref as string | null) ?? null,
          name: (o?.name as string | null) ?? null,
          location: locById.get(did) ?? null,
        },
        elements,
      };
    })
    .filter((fd) => fd.elements.length > 0)
    .sort((a, b) =>
      (a.drawing.name ?? a.drawing.objectRef ?? "").localeCompare(
        b.drawing.name ?? b.drawing.objectRef ?? "",
        "sk"
      )
    );
}

/** Cachovaný variant pre kartu podlažia/budovy (ISR, D-029 perf). */
export const fetchFloorDrawingsCached = unstable_cache(
  fetchFloorDrawings,
  ["fetch-floor-drawings"],
  AIM_CACHE
);

/**
 * Zodpovednosti za uzol (`rel_assigns_to_actor`, D-020). Actor je person alebo
 * organization; pri osobe doplníme jej firmu (`rel_member_of`, D-024).
 */
export async function fetchResponsibilities(
  objectId: string
): Promise<Responsibility[]> {
  const supabase = getSupabaseAdmin();

  const { data: rels, error } = await supabase
    .from("rel_assigns_to_actor")
    .select("from_id, role, valid_from, valid_until")
    .eq("to_id", objectId)
    .is("valid_until", null);
  if (error) throw new Error(error.message);

  const relRows = (rels ?? []) as {
    from_id: string;
    role: string;
    valid_from: string | null;
    valid_until: string | null;
  }[];
  if (relRows.length === 0) return [];

  const actorIds = [...new Set(relRows.map((r) => r.from_id))];

  // Aktori + ich členstvá paralelne — `rel_member_of` vychádza len z osôb, takže
  // filter cez všetky actorIds vráti presne to, čo filter cez persons (organizácie
  // žiadne riadky nemajú), ušetrí ale jeden sekvenčný round-trip.
  const [actorsRes, memberRes] = await Promise.all([
    supabase
      .from("objects")
      .select("id, object_type, object_ref, name")
      .in("id", actorIds),
    supabase
      .from("rel_member_of")
      .select("from_id, to_id")
      .in("from_id", actorIds)
      .is("valid_until", null),
  ]);
  if (actorsRes.error) throw new Error(actorsRes.error.message);
  if (memberRes.error) throw new Error(memberRes.error.message);

  const actorById = new Map(
    (actorsRes.data ?? []).map((a) => [a.id as string, a])
  );
  const memberRows = memberRes.data ?? [];

  const orgByPerson = new Map<string, ActorOrg>();
  if (memberRows.length > 0) {
    const orgIds = [...new Set((memberRows ?? []).map((m) => m.to_id as string))];
    const orgName = new Map<string, string | null>();
    if (orgIds.length > 0) {
      const { data: orgs, error: orgErr } = await supabase
        .from("objects")
        .select("id, name")
        .in("id", orgIds);
      if (orgErr) throw new Error(orgErr.message);
      for (const o of orgs ?? [])
        orgName.set(o.id as string, (o.name as string | null) ?? null);
    }
    for (const m of memberRows ?? []) {
      // Prvá firma na osobu (B model: 1 členstvo v seede).
      if (!orgByPerson.has(m.from_id as string)) {
        orgByPerson.set(m.from_id as string, {
          id: m.to_id as string,
          name: orgName.get(m.to_id as string) ?? null,
        });
      }
    }
  }

  return relRows
    .map((r) => {
      const a = actorById.get(r.from_id);
      const actorType =
        (a?.object_type as "person" | "organization") ?? "organization";
      return {
        actorId: r.from_id,
        actorType,
        actorName: (a?.name as string | null) ?? null,
        actorRef: (a?.object_ref as string | null) ?? null,
        role: r.role,
        validFrom: r.valid_from,
        validUntil: r.valid_until,
        org: actorType === "person" ? orgByPerson.get(r.from_id) ?? null : null,
      };
    })
    .sort((a, b) => a.role.localeCompare(b.role, "sk"));
}

/**
 * Systémy, ktorých je prvok členom (`rel_assigns_to_group`, smer člen → systém,
 * D-047). Pre asset kartu: „súčasť systému" (vetranie/odvod…). Aktívne väzby.
 */
export async function fetchSystemMembership(
  objectId: string
): Promise<SystemRef[]> {
  const supabase = getSupabaseAdmin();

  const { data: rels, error } = await supabase
    .from("rel_assigns_to_group")
    .select("to_id")
    .eq("from_id", objectId)
    .is("valid_until", null)
    .not("to_id", "is", null);
  if (error) throw new Error(error.message);

  const systemIds = [...new Set((rels ?? []).map((r) => r.to_id as string))];
  if (systemIds.length === 0) return [];

  const { data: systems, error: sysErr } = await supabase
    .from("objects")
    .select("id, object_ref, name, predefined_type")
    .in("id", systemIds);
  if (sysErr) throw new Error(sysErr.message);

  return (systems ?? [])
    .map((s) => ({
      id: s.id as string,
      objectRef: (s.object_ref as string | null) ?? null,
      name: (s.name as string | null) ?? null,
      predefinedType: (s.predefined_type as string | null) ?? null,
    }))
    .sort((a, b) =>
      (a.name ?? a.objectRef ?? "").localeCompare(b.name ?? b.objectRef ?? "", "sk")
    );
}

/**
 * História IFC GUIDov uzla (`ifc_guid_history`, D-010). Aktívny (valid_until
 * NULL) hore, potom zostupne podľa `valid_from`.
 */
export async function fetchGuidHistory(
  objectId: string
): Promise<GuidHistoryEntry[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("ifc_guid_history")
    .select("id, ifc_guid, valid_from, valid_until, source")
    .eq("object_id", objectId);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as {
    id: string;
    ifc_guid: string;
    valid_from: string | null;
    valid_until: string | null;
    source: string | null;
  }[];

  return rows
    .map((r) => ({
      id: r.id,
      ifcGuid: r.ifc_guid,
      validFrom: r.valid_from,
      validUntil: r.valid_until,
      source: r.source,
      active: r.valid_until === null,
    }))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return (b.validFrom ?? "").localeCompare(a.validFrom ?? "");
    });
}
