import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { PDF_LINK_SOURCE } from "@/lib/data/constants";
import { cachedProjectRead } from "@/lib/data/revalidate";

/**
 * Data-access layer for the generic sections of a node (S3, D-029): documents,
 * responsibilities and the history of the IFC GUID. All over an arbitrary `objects` node -
 * the sections are shown on the asset card and on spatial nodes.
 *
 * Only **active** links are shown (`valid_until IS NULL`), consistently with
 * S1/S2. All server-side via `service_role` (D-026).
 */

export interface DocumentRef {
  /** Document `objects.id` - target of the link `/node/[id]`. */
  id: string;
  objectRef: string | null;
  name: string | null;
  /** rel_associates_document.role: 'manual','certificate','as-built'... */
  role: string | null;
  identification: string | null;
  description: string | null;
  location: string | null;
  revision: string | null;
  status: string | null;
  validFrom: string | null;
  validUntil: string | null;
}

/** Drawing in which an element is shown (E4, D-041) - with a public PDF URL. */
export interface DrawingLink {
  /** Document `objects.id` - target of the link `/node/[id]`. */
  id: string;
  objectRef: string | null;
  name: string | null;
  /** Public PDF URL (`documents.location`) - a direct link to the drawing. */
  location: string | null;
}

/** Element shown in a drawing (E4, D-041) - for the storey card. */
export interface ElementInDrawing {
  id: string;
  objectType: "asset" | "asset_type";
  objectRef: string | null;
  name: string | null;
}

/** Storey drawing + the list of elements shown in it (E4, D-041). */
export interface FloorDrawing {
  drawing: DrawingLink;
  elements: ElementInDrawing[];
}

/** System of which an element is a member (`rel_assigns_to_group`, D-047) - for the asset card. */
export interface SystemRef {
  /** System `objects.id` - target of the link `/node/[id]`. */
  id: string;
  objectRef: string | null;
  name: string | null;
  /** IfcDistributionSystemEnum (VENTILATION/EXHAUST...). */
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
  /** Acting role (rel_assigns_to_actor.role): 'operator','maintainer'... */
  role: string;
  validFrom: string | null;
  validUntil: string | null;
  /** Company of the person (rel_member_of) - only for person actors. */
  org: ActorOrg | null;
}

export interface GuidHistoryEntry {
  id: string;
  ifcGuid: string;
  validFrom: string | null;
  /** NULL = the current GUID. */
  validUntil: string | null;
  source: string | null;
  active: boolean;
}

export interface NodeSectionsData {
  documents: DocumentRef[];
  /** Drawings in which this element is shown (E4) - its own section. */
  drawings: DrawingLink[];
  responsibilities: Responsibility[];
  guidHistory: GuidHistoryEntry[];
}

/** Generic sections of a node at once (in parallel) - a single entry point for the Viewer. */
async function fetchNodeSectionsImpl(
  projectId: string,
  objectId: string
): Promise<NodeSectionsData> {
  const [documents, drawings, responsibilities, guidHistory] = await Promise.all([
    fetchDocuments(projectId, objectId),
    fetchElementDrawings(projectId, objectId),
    fetchResponsibilities(projectId, objectId),
    fetchGuidHistory(objectId),
  ]);
  return { documents, drawings, responsibilities, guidHistory };
}

/** Cached per id (ISR, D-029 perf). */
export const fetchNodeSections = cachedProjectRead("fetch-node-sections", fetchNodeSectionsImpl);

/** Documents attached to a node (`rel_associates_document` -> `documents`, D-014). */
export async function fetchDocuments(projectId: string, objectId: string): Promise<DocumentRef[]> {
  const supabase = getSupabaseAdmin();

  const { data: rels, error } = await supabase
    .from("rel_associates_document")
    .select("to_id, role, source")
    .eq("project_id", projectId)
    .eq("from_id", objectId)
    .is("valid_until", null)
    .not("to_id", "is", null); // a document without an AIM node (D-183 K3)
  if (error) throw new Error(error.message);

  // E4 drawing links (an element shown in a drawing) go to their own section, not here.
  const relRows = ((rels ?? []) as {
    to_id: string;
    role: string | null;
    source: string | null;
  }[]).filter((r) => r.source !== PDF_LINK_SOURCE);
  if (relRows.length === 0) return [];

  const docIds = [...new Set(relRows.map((r) => r.to_id))];

  const [objsRes, docsRes] = await Promise.all([
    supabase.from("objects").select("id, object_ref, name").eq("project_id", projectId).in("id", docIds),
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
 * Drawings in which an element (asset/asset_type) is **shown** - E4 auto-linking
 * (`rel_associates_document` with `source='pdf_link (E4)'`, direction element -> drawing, D-041).
 * Returns the direct public PDF URL (`documents.location`).
 */
export async function fetchElementDrawings(
  projectId: string,
  objectId: string
): Promise<DrawingLink[]> {
  const supabase = getSupabaseAdmin();

  const { data: rels, error } = await supabase
    .from("rel_associates_document")
    .select("to_id")
    .eq("project_id", projectId)
    .eq("from_id", objectId)
    .eq("source", PDF_LINK_SOURCE)
    .is("valid_until", null);
  if (error) throw new Error(error.message);

  const docIds = [...new Set((rels ?? []).map((r) => r.to_id as string))];
  if (docIds.length === 0) return [];

  const [objsRes, docsRes] = await Promise.all([
    supabase.from("objects").select("id, object_ref, name").eq("project_id", projectId).in("id", docIds),
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
 * Drawings of a node (E3, `role='drawing'`) + the elements in each of them (E4). For the storey/building
 * card: "which elements are shown in this drawing" (D-041). A drawing without
 * detected elements is **not shown** (an empty list has no informative value).
 */
export async function fetchFloorDrawings(
  projectId: string,
  objectId: string
): Promise<FloorDrawing[]> {
  const supabase = getSupabaseAdmin();

  // 1) drawings attached to a node (E3 floor->drawing); E4 element links omitted
  const { data: drawRels, error } = await supabase
    .from("rel_associates_document")
    .select("to_id, source")
    .eq("project_id", projectId)
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

  // 2) drawing meta + elements shown in each drawing (E4, direction element->drawing)
  const [objsRes, docsRes, elemRelsRes] = await Promise.all([
    supabase.from("objects").select("id, object_ref, name").eq("project_id", projectId).in("id", drawingIds),
    supabase.from("documents").select("id, location").in("id", drawingIds),
    supabase
      .from("rel_associates_document")
      .select("from_id, to_id")
      .eq("project_id", projectId)
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

  // elements (asset/asset_type) in a single query
  const elemIds = [...new Set(elemRels.map((r) => r.from_id))];
  const elemById = new Map<string, ElementInDrawing>();
  if (elemIds.length > 0) {
    const { data: elems, error: elErr } = await supabase
      .from("objects")
      .select("id, object_type, object_ref, name")
      .eq("project_id", projectId)
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

  // group elements by drawing
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

/** Cached variant for the storey/building card (ISR, D-029 perf). */
export const fetchFloorDrawingsCached = cachedProjectRead("fetch-floor-drawings", fetchFloorDrawings);

/**
 * Responsibilities for a node (`rel_assigns_to_actor`, D-020). An actor is a person or
 * organization; for a person we add their company (`rel_member_of`, D-024).
 */
export async function fetchResponsibilities(
  projectId: string,
  objectId: string
): Promise<Responsibility[]> {
  const supabase = getSupabaseAdmin();

  const { data: rels, error } = await supabase
    .from("rel_assigns_to_actor")
    .select("from_id, role, valid_from, valid_until")
    .eq("project_id", projectId)
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

  // Actors + their memberships in parallel - `rel_member_of` originates only from persons, so a
  // filter over all actorIds returns exactly what a filter over persons would (organizations have
  // no rows), but saves one sequential round-trip.
  const [actorsRes, memberRes] = await Promise.all([
    supabase
      .from("objects")
      .select("id, object_type, object_ref, name")
      .eq("project_id", projectId)
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
        .eq("project_id", projectId)
        .in("id", orgIds);
      if (orgErr) throw new Error(orgErr.message);
      for (const o of orgs ?? [])
        orgName.set(o.id as string, (o.name as string | null) ?? null);
    }
    for (const m of memberRows ?? []) {
      // The first company per person (model B: 1 membership in the seed).
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
 * Systems of which an element is a member (`rel_assigns_to_group`, direction member -> system,
 * D-047). For the asset card: "part of a system" (ventilation/exhaust...). Active links.
 */
export async function fetchSystemMembership(
  projectId: string,
  objectId: string
): Promise<SystemRef[]> {
  const supabase = getSupabaseAdmin();

  const { data: rels, error } = await supabase
    .from("rel_assigns_to_group")
    .select("to_id")
    .eq("project_id", projectId)
    .eq("from_id", objectId)
    .is("valid_until", null)
    .not("to_id", "is", null);
  if (error) throw new Error(error.message);

  const systemIds = [...new Set((rels ?? []).map((r) => r.to_id as string))];
  if (systemIds.length === 0) return [];

  const { data: systems, error: sysErr } = await supabase
    .from("objects")
    .select("id, object_ref, name, predefined_type")
    .eq("project_id", projectId)
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
 * History of the IFC GUIDs of a node (`ifc_guid_history`, D-010). Active (valid_until
 * NULL) on top, then descending by `valid_from`.
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
