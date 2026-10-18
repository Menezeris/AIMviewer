import "server-only";

import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { GROUP_LIKE_TYPES, type GroupLikeType, type ObjectType } from "@/lib/object-type";
import { AIM_CACHE, PDF_LINK_SOURCE } from "@/lib/data/constants";

/**
 * Data-access pre generický object route (S3, D-029): ľahká meta pre dispatch
 * v `/node/[id]` + detail views pre person / organization / document.
 * Obojsmerné prelinkovanie uzatvára graf (z osoby → firma + jej zodpovednosti;
 * z dokumentu → „pripojené k"). Server-side cez `service_role` (D-026).
 */

export interface ObjectMeta {
  id: string;
  object_type: ObjectType;
  object_ref: string | null;
  name: string | null;
}

/** Skrátený odkaz na ľubovoľný objekt (cieľ `/node/[id]`). */
export interface ObjectLink {
  id: string;
  object_type: ObjectType;
  object_ref: string | null;
  name: string | null;
}

export interface Membership {
  orgId: string;
  orgName: string | null;
  orgRef: string | null;
  /** Rola vo firme (rel_member_of.role, ≠ acting rola). */
  role: string | null;
  validFrom: string | null;
  validUntil: string | null;
}

export interface ResponsibilityOf {
  object: ObjectLink;
  /** Acting rola (rel_assigns_to_actor.role). */
  role: string;
  validFrom: string | null;
  validUntil: string | null;
}

export interface PersonDetail {
  id: string;
  object_ref: string | null;
  name: string | null;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  phone: string | null;
  memberships: Membership[];
  responsibilities: ResponsibilityOf[];
}

export interface OrgMember {
  personId: string;
  personName: string | null;
  personRef: string | null;
  role: string | null;
}

export interface OrganizationDetail {
  id: string;
  object_ref: string | null;
  name: string | null;
  /** Zachytené `_contact` (capture-don't-structure, D-024). */
  contact: Record<string, unknown> | null;
  members: OrgMember[];
  responsibilities: ResponsibilityOf[];
}

export interface DocumentAttachment {
  object: ObjectLink;
  role: string | null;
}

export interface DocumentDetail {
  id: string;
  object_ref: string | null;
  name: string | null;
  identification: string | null;
  description: string | null;
  location: string | null;
  purpose: string | null;
  revision: string | null;
  status: string | null;
  documentOwner: string | null;
  validFrom: string | null;
  validUntil: string | null;
  attachedTo: DocumentAttachment[];
}

/** Priradený dokument prvku pre info-panel (klikateľný na `/node/[id]`). */
export interface SummaryDocument {
  id: string;
  name: string | null;
  objectRef: string | null;
  /** rel_associates_document.role ('drawing', 'manual'…). */
  role: string | null;
  /** True ak ide o auto-prepojený výkres (E4, `source='pdf_link (E4)'`). */
  isDrawing: boolean;
}

/** Kompaktný súhrn prvku pre bočný info-panel prehliadačky výkresov (D-042 D). */
export interface NodeSummary {
  id: string;
  objectType: ObjectType;
  /** Segment route detailu (`asset_type` → type, inak node). */
  route: "node" | "type";
  name: string | null;
  objectRef: string | null;
  ifcType: string | null;
  predefinedType: string | null;
  userDefinedType: string | null;
  /** Typ assetu (occurrence → type, len pri `asset`). */
  type: ObjectLink | null;
  /** Všetky priradené dokumenty (vrátane auto-prepojených výkresov). */
  documents: SummaryDocument[];
  counts: {
    classifications: number;
    /** Počet occurrences (len pri `asset_type`). */
    occurrences: number;
  };
}

async function fetchNodeSummaryImpl(id: string): Promise<NodeSummary | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("objects")
    .select(
      "id, object_type, object_ref, name, ifc_type, predefined_type, user_defined_type"
    )
    .eq("id", id)
    .limit(1);
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) return null;

  const objectType = row.object_type as ObjectType;
  const isAsset = objectType === "asset";
  const isType = objectType === "asset_type";

  // Typ, klasifikácie, dokumenty a počet occurrences — naraz; každá vetva vráti
  // jednoduchý skalárny / pole typ, čím sa vyhneme unsafe `as` castom.
  const [typeId, classificationCount, docRels, occurrenceCount] = await Promise.all([
    isAsset
      ? supabase
          .from("rel_defines_by_type")
          .select("to_id")
          .eq("from_id", id)
          .is("valid_until", null)
          .limit(1)
          .then(({ data: d, error: e }) => {
            if (e) throw new Error(e.message);
            return (d?.[0]?.to_id as string | undefined) ?? null;
          })
      : Promise.resolve<string | null>(null),
    supabase
      .from("rel_associates_classification")
      .select("id", { count: "exact", head: true })
      .eq("from_id", id)
      .is("valid_until", null)
      .then(({ count, error: e }) => {
        if (e) throw new Error(e.message);
        return count ?? 0;
      }),
    supabase
      .from("rel_associates_document")
      .select("to_id, role, source")
      .eq("from_id", id)
      .is("valid_until", null)
      .then(({ data: d, error: e }) => {
        if (e) throw new Error(e.message);
        return (d ?? []) as { to_id: string; role: string | null; source: string | null }[];
      }),
    isType
      ? supabase
          .from("rel_defines_by_type")
          .select("id", { count: "exact", head: true })
          .eq("to_id", id)
          .is("valid_until", null)
          .then(({ count, error: e }) => {
            if (e) throw new Error(e.message);
            return count ?? 0;
          })
      : Promise.resolve<number>(0),
  ]);

  // dedupe per dokument; výkres (E4) má prednosť pri príznaku isDrawing
  const docOrder: string[] = [];
  const docMeta = new Map<string, { role: string | null; isDrawing: boolean }>();
  for (const r of docRels) {
    const isDrawing = r.source === PDF_LINK_SOURCE;
    const prev = docMeta.get(r.to_id);
    if (!prev) {
      docOrder.push(r.to_id);
      docMeta.set(r.to_id, { role: r.role, isDrawing });
    } else if (isDrawing) {
      prev.isDrawing = true;
    }
  }

  const linkIds = [...new Set([...(typeId ? [typeId] : []), ...docOrder])];
  const links = await loadObjectLinks(supabase, linkIds);
  const type: ObjectLink | null = typeId ? (links.get(typeId) ?? null) : null;

  const documents: SummaryDocument[] = docOrder.map((did) => {
    const o = links.get(did);
    const m = docMeta.get(did);
    return {
      id: did,
      name: o?.name ?? null,
      objectRef: o?.object_ref ?? null,
      role: m?.role ?? null,
      isDrawing: m?.isDrawing ?? false,
    };
  });
  documents.sort((a, b) =>
    (a.name ?? a.objectRef ?? "").localeCompare(b.name ?? b.objectRef ?? "", "sk")
  );

  return {
    id: row.id as string,
    objectType,
    route: isType ? "type" : "node",
    name: (row.name as string | null) ?? null,
    objectRef: (row.object_ref as string | null) ?? null,
    ifcType: (row.ifc_type as string | null) ?? null,
    predefinedType: (row.predefined_type as string | null) ?? null,
    userDefinedType: (row.user_defined_type as string | null) ?? null,
    type,
    documents,
    counts: {
      classifications: classificationCount,
      occurrences: occurrenceCount,
    },
  };
}

/** Ľahká identita objektu pre dispatch v route. `null`, ak neexistuje. */
async function fetchObjectMetaImpl(id: string): Promise<ObjectMeta | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("objects")
    .select("id, object_type, object_ref, name")
    .eq("id", id)
    .limit(1);
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) return null;
  return {
    id: row.id as string,
    object_type: row.object_type as ObjectType,
    object_ref: (row.object_ref as string | null) ?? null,
    name: (row.name as string | null) ?? null,
  };
}

/** Načíta `objects` riadky ako odkazy (pre prelinkovanie). */
async function loadObjectLinks(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Map<string, ObjectLink>> {
  const out = new Map<string, ObjectLink>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from("objects")
    .select("id, object_type, object_ref, name")
    .in("id", ids);
  if (error) throw new Error(error.message);
  for (const o of data ?? []) {
    out.set(o.id as string, {
      id: o.id as string,
      object_type: o.object_type as ObjectType,
      object_ref: (o.object_ref as string | null) ?? null,
      name: (o.name as string | null) ?? null,
    });
  }
  return out;
}

/** Za čo aktor (person|organization) zodpovedá — reverz `rel_assigns_to_actor`. */
async function loadResponsibilitiesOf(
  supabase: SupabaseClient,
  actorId: string
): Promise<ResponsibilityOf[]> {
  const { data, error } = await supabase
    .from("rel_assigns_to_actor")
    .select("to_id, role, valid_from, valid_until")
    .eq("from_id", actorId)
    .is("valid_until", null);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as {
    to_id: string;
    role: string;
    valid_from: string | null;
    valid_until: string | null;
  }[];
  const links = await loadObjectLinks(
    supabase,
    rows.map((r) => r.to_id)
  );
  return rows
    .map((r) => ({
      object:
        links.get(r.to_id) ??
        ({ id: r.to_id, object_type: "asset", object_ref: null, name: null } as ObjectLink),
      role: r.role,
      validFrom: r.valid_from,
      validUntil: r.valid_until,
    }))
    .sort((a, b) => a.role.localeCompare(b.role, "sk"));
}

/** Detail osoby: kontakt, členstvá vo firmách, za čo zodpovedá. */
async function fetchPersonImpl(id: string): Promise<PersonDetail | null> {
  const supabase = getSupabaseAdmin();

  // Nezávislé dotazy naraz; orgLinks závisí od členstiev → až potom.
  const [objRes, pRes, memRes, responsibilities] = await Promise.all([
    supabase
      .from("objects")
      .select("id, object_ref, name")
      .eq("id", id)
      .eq("object_type", "person")
      .limit(1),
    supabase
      .from("persons")
      .select("given_name, family_name, email, phone")
      .eq("id", id)
      .limit(1),
    supabase
      .from("rel_member_of")
      .select("to_id, role, valid_from, valid_until")
      .eq("from_id", id)
      .is("valid_until", null),
    loadResponsibilitiesOf(supabase, id),
  ]);

  if (objRes.error) throw new Error(objRes.error.message);
  const obj = objRes.data?.[0];
  if (!obj) return null;

  if (pRes.error) throw new Error(pRes.error.message);
  const p = pRes.data?.[0];

  if (memRes.error) throw new Error(memRes.error.message);
  const memberRows = (memRes.data ?? []) as {
    to_id: string;
    role: string | null;
    valid_from: string | null;
    valid_until: string | null;
  }[];
  const orgLinks = await loadObjectLinks(
    supabase,
    memberRows.map((m) => m.to_id)
  );
  const memberships: Membership[] = memberRows.map((m) => {
    const o = orgLinks.get(m.to_id);
    return {
      orgId: m.to_id,
      orgName: o?.name ?? null,
      orgRef: o?.object_ref ?? null,
      role: m.role,
      validFrom: m.valid_from,
      validUntil: m.valid_until,
    };
  });

  return {
    id: obj.id as string,
    object_ref: (obj.object_ref as string | null) ?? null,
    name: (obj.name as string | null) ?? null,
    givenName: (p?.given_name as string | null) ?? null,
    familyName: (p?.family_name as string | null) ?? null,
    email: (p?.email as string | null) ?? null,
    phone: (p?.phone as string | null) ?? null,
    memberships,
    responsibilities,
  };
}

/** Detail organizácie: zachytený kontakt, členovia, za čo zodpovedá. */
async function fetchOrganizationImpl(
  id: string
): Promise<OrganizationDetail | null> {
  const supabase = getSupabaseAdmin();

  // Objekt, členovia a zodpovednosti sú nezávislé → naraz.
  const [objRes, memRes, responsibilities] = await Promise.all([
    supabase
      .from("objects")
      .select("id, object_ref, name, properties")
      .eq("id", id)
      .eq("object_type", "organization")
      .limit(1),
    supabase
      .from("rel_member_of")
      .select("from_id, role")
      .eq("to_id", id)
      .is("valid_until", null),
    loadResponsibilitiesOf(supabase, id),
  ]);

  if (objRes.error) throw new Error(objRes.error.message);
  const obj = objRes.data?.[0];
  if (!obj) return null;

  const props = (obj.properties ?? {}) as Record<string, unknown>;
  const contactRaw = props["_contact"];
  const contact =
    contactRaw && typeof contactRaw === "object" && !Array.isArray(contactRaw)
      ? (contactRaw as Record<string, unknown>)
      : null;

  if (memRes.error) throw new Error(memRes.error.message);
  const memberRows = (memRes.data ?? []) as { from_id: string; role: string | null }[];
  const personLinks = await loadObjectLinks(
    supabase,
    memberRows.map((m) => m.from_id)
  );
  const members: OrgMember[] = memberRows
    .map((m) => {
      const o = personLinks.get(m.from_id);
      return {
        personId: m.from_id,
        personName: o?.name ?? null,
        personRef: o?.object_ref ?? null,
        role: m.role,
      };
    })
    .sort((a, b) => (a.personName ?? "").localeCompare(b.personName ?? "", "sk"));

  return {
    id: obj.id as string,
    object_ref: (obj.object_ref as string | null) ?? null,
    name: (obj.name as string | null) ?? null,
    contact,
    members,
    responsibilities,
  };
}

/** Detail dokumentu: IfcDocumentInformation polia + „pripojené k" (reverz). */
async function fetchDocumentImpl(id: string): Promise<DocumentDetail | null> {
  const supabase = getSupabaseAdmin();

  // Objekt, metadáta dokumentu a väzby „pripojené k" naraz.
  const [objRes, dRes, relRes] = await Promise.all([
    supabase
      .from("objects")
      .select("id, object_ref, name")
      .eq("id", id)
      .eq("object_type", "document")
      .limit(1),
    supabase
      .from("documents")
      .select(
        "identification, description, location, purpose, revision, document_owner, status, valid_from, valid_until"
      )
      .eq("id", id)
      .limit(1),
    supabase
      .from("rel_associates_document")
      .select("from_id, role")
      .eq("to_id", id)
      .is("valid_until", null),
  ]);

  if (objRes.error) throw new Error(objRes.error.message);
  const obj = objRes.data?.[0];
  if (!obj) return null;

  if (dRes.error) throw new Error(dRes.error.message);
  const d = dRes.data?.[0];

  // Pripojené k (rel_associates_document, kde to_id = tento dokument).
  if (relRes.error) throw new Error(relRes.error.message);
  const rels = (relRes.data ?? []) as { from_id: string; role: string | null }[];
  const links = await loadObjectLinks(
    supabase,
    rels.map((r) => r.from_id)
  );
  const attachedTo: DocumentAttachment[] = rels
    .map((r) => ({
      object:
        links.get(r.from_id) ??
        ({ id: r.from_id, object_type: "asset", object_ref: null, name: null } as ObjectLink),
      role: r.role,
    }))
    .sort((a, b) =>
      (a.object.name ?? "").localeCompare(b.object.name ?? "", "sk")
    );

  return {
    id: obj.id as string,
    object_ref: (obj.object_ref as string | null) ?? null,
    name: (obj.name as string | null) ?? null,
    identification: (d?.identification as string | null) ?? null,
    description: (d?.description as string | null) ?? null,
    location: (d?.location as string | null) ?? null,
    purpose: (d?.purpose as string | null) ?? null,
    revision: (d?.revision as string | null) ?? null,
    status: (d?.status as string | null) ?? null,
    documentOwner: (d?.document_owner as string | null) ?? null,
    validFrom: (d?.valid_from as string | null) ?? null,
    validUntil: (d?.valid_until as string | null) ?? null,
    attachedTo,
  };
}

/** Skupina členov systému podľa IFC typu (D-047) — pre systémovú kartu. */
export interface SystemMemberGroup {
  ifcType: string | null;
  count: number;
  /** Členovia (odkazy) — orezané na `SYSTEM_MEMBER_LIST_CAP`. */
  members: ObjectLink[];
}

export interface SystemDetail {
  id: string;
  /** Systém, projekt, zóna, priestorová zóna alebo skupina (D-047, D-088). */
  objectType: GroupLikeType;
  object_ref: string | null;
  name: string | null;
  /** IfcDistributionSystemEnum (VENTILATION/EXHAUST…), IfcSpatialZoneTypeEnum… */
  predefinedType: string | null;
  memberCount: number;
  groups: SystemMemberGroup[];
}

/** Koľko členov na skupinu vypíšeme ako odkazy (zvyšok len počet — VZT má stovky). */
const SYSTEM_MEMBER_LIST_CAP = 60;

/** Hrany "člen / časť → skupinový uzol" (to_id = uzol): členstvo, dekompozícia, referencia. */
const MEMBER_RELATIONS = [
  "rel_assigns_to_group",
  "rel_aggregates",
  "rel_referenced_in_spatial_structure",
] as const;

/**
 * Detail systému (D-047) a ďalších skupinových uzlov (D-088): členovia
 * (`rel_assigns_to_group`), časti (`rel_aggregates`) a prvky v priestorovej zóne
 * (`rel_referenced_in_spatial_structure`) zoskupení podľa IFC typu.
 */
async function fetchSystemImpl(id: string): Promise<SystemDetail | null> {
  const supabase = getSupabaseAdmin();

  const [objRes, ...memRes] = await Promise.all([
    supabase
      .from("objects")
      .select("id, object_type, object_ref, name, predefined_type")
      .eq("id", id)
      .in("object_type", GROUP_LIKE_TYPES as unknown as string[])
      .limit(1),
    ...MEMBER_RELATIONS.map((rel) =>
      supabase.from(rel).select("from_id").eq("to_id", id).is("valid_until", null)
    ),
  ]);

  if (objRes.error) throw new Error(objRes.error.message);
  const obj = objRes.data?.[0];
  if (!obj) return null;

  const memberIds = [
    ...new Set(
      memRes.flatMap((res) => {
        if (res.error) throw new Error(res.error.message);
        return (res.data ?? []).map((r) => (r as { from_id: string }).from_id);
      })
    ),
  ];

  // Členské objekty s IFC typom (loadObjectLinks nemá ifc_type → vlastný dotaz).
  const members =
    memberIds.length > 0
      ? await supabase
          .from("objects")
          .select("id, object_type, object_ref, name, ifc_type")
          .in("id", memberIds)
          .then(({ data, error }) => {
            if (error) throw new Error(error.message);
            return (data ?? []) as {
              id: string;
              object_type: string;
              object_ref: string | null;
              name: string | null;
              ifc_type: string | null;
            }[];
          })
      : [];

  // Zoskup podľa IFC typu; skupiny podľa počtu zostupne, členovia orezaní.
  const byType = new Map<string, SystemMemberGroup>();
  for (const m of members) {
    const key = m.ifc_type ?? "—";
    let g = byType.get(key);
    if (!g) {
      g = { ifcType: m.ifc_type ?? null, count: 0, members: [] };
      byType.set(key, g);
    }
    g.count += 1;
    if (g.members.length < SYSTEM_MEMBER_LIST_CAP) {
      g.members.push({
        id: m.id,
        object_type: m.object_type as ObjectType,
        object_ref: m.object_ref ?? null,
        name: m.name ?? null,
      });
    }
  }
  for (const g of byType.values())
    g.members.sort((a, b) =>
      (a.object_ref ?? a.name ?? "").localeCompare(b.object_ref ?? b.name ?? "", "sk")
    );
  const groups = [...byType.values()].sort((a, b) => b.count - a.count);

  return {
    id: obj.id as string,
    objectType: obj.object_type as GroupLikeType,
    object_ref: (obj.object_ref as string | null) ?? null,
    name: (obj.name as string | null) ?? null,
    predefinedType: (obj.predefined_type as string | null) ?? null,
    memberCount: members.length,
    groups,
  };
}

// Cachované per id (ISR, D-029 perf) — render uzlov je tým eligible pre Full Route Cache.
export const fetchObjectMeta = unstable_cache(
  fetchObjectMetaImpl,
  ["fetch-object-meta"],
  AIM_CACHE
);
export const fetchPerson = unstable_cache(fetchPersonImpl, ["fetch-person"], AIM_CACHE);
export const fetchOrganization = unstable_cache(
  fetchOrganizationImpl,
  ["fetch-organization"],
  AIM_CACHE
);
export const fetchDocument = unstable_cache(
  fetchDocumentImpl,
  ["fetch-document"],
  AIM_CACHE
);
export const fetchNodeSummary = unstable_cache(
  fetchNodeSummaryImpl,
  ["fetch-node-summary"],
  AIM_CACHE
);
export const fetchSystem = unstable_cache(fetchSystemImpl, ["fetch-system"], AIM_CACHE);
