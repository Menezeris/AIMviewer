import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/data/pagination";
import {
  dedupeObjectDocuments,
  type DocumentType,
  type ObjectDocument,
  type ObjectDocumentNode,
  type ViewRow,
} from "@/lib/data/object-documents-core";
import { splitDocumentClassifications, type DocumentClassification } from "@/lib/data/media-kind";

export * from "@/lib/data/object-documents-core";

/**
 * Documents of an object via relations (D-104, view `v_object_documents`) in one
 * place: read by the tool `get_object(include=documents)` and by the AIM card in the viewer
 * (`/api/element`), so that the card and the connector show the same thing.
 *
 * Reads from the DB; the pure functions (merging of paths, texts for the card) are in
 * `object-documents-core.ts`, which the client may also load.
 */

const IN_CHUNK = 200;

/** Nodes by id (documents, carriers), in batches because of the URL length. */
export async function fetchNodes(projectId: string, ids: Iterable<string>): Promise<ObjectDocumentNode[]> {
  const unique = [...new Set(ids)];
  const supabase = getSupabaseAdmin();
  const out: ObjectDocumentNode[] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from("objects")
      .select("id, object_type, object_ref, name")
      .eq("project_id", projectId)
      .in("id", unique.slice(i, i + IN_CHUNK));
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as ObjectDocumentNode[]));
  }
  return out;
}

/** Documents of an object with the path and the nodes that were loaded along the way. */
export async function fetchObjectDocuments(
  projectId: string,
  objectId: string,
): Promise<{ documents: ObjectDocument[]; nodes: ObjectDocumentNode[] }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("v_object_documents")
    .select("document_id, page, via, via_id, via_nearest_id, depth")
    .eq("project_id", projectId)
    .eq("object_id", objectId)
    .order("depth")
    .limit(500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ViewRow[];
  const nodes = await fetchNodes(projectId, 
    rows.flatMap((r) => [r.document_id, r.via_id, r.via_nearest_id].filter(Boolean) as string[]),
  );
  return { documents: dedupeObjectDocuments(rows, new Map(nodes.map((n) => [n.id, n]))), nodes };
}

/** Row of `v_object_documents` from the document's point of view: the object the document concerns. */
export interface DocumentObjectRow {
  object_id: string;
  object_type: string;
  via: string;
  via_id: string | null;
  depth: number;
  page: number | null;
}

/**
 * Objects the document concerns (D-104 step 4), also inherited via a carrier
 * (storey, zone, group, type). `document_reference` = only via that reference to a
 * part of the document, `page` = only references to that page. Sorted by `depth`, so
 * the first row of an object is its nearest path. Paginates: a storey floor plan
 * exceeds the PostgREST response cap (1000 rows).
 */
export async function fetchDocumentObjectRows(
  projectId: string,
  doc: { id: string; object_type: string },
  page?: number,
): Promise<DocumentObjectRow[]> {
  const supabase = getSupabaseAdmin();
  const column = doc.object_type === "document_reference" ? "reference_id" : "document_id";
  return fetchAllPages<DocumentObjectRow>((from, to) => {
    let q = supabase
      .from("v_object_documents")
      .select("object_id, object_type, via, via_id, depth, page")
      .eq("project_id", projectId)
      .eq(column, doc.id);
    if (page) q = q.eq("page", page);
    return q
      .order("depth")
      .order("object_id")
      .order("via_id")
      .order("page")
      .order("via_nearest_id")
      .range(from, to) as unknown as PromiseLike<{ data: DocumentObjectRow[] | null; error: { message: string } | null }>;
  });
}

/**
 * Classifications of documents (`rel_external_reference_relationship`, migration
 * `20261020150000`) by axis: information type ISO 19650 and media kind (D-131).
 * Without the migration or without a classification it returns an empty map: the kind is a supplement, not
 * a condition of the list.
 */
export async function fetchDocumentClassifications(
  projectId: string,
  documentIds: readonly string[],
): Promise<Map<string, DocumentClassification>> {
  const empty = new Map<string, DocumentClassification>();
  if (documentIds.length === 0) return empty;
  const supabase = getSupabaseAdmin();
  const rels: { from_id: string; to_id: string }[] = [];
  for (let i = 0; i < documentIds.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from("rel_external_reference_relationship")
      .select("from_id, to_id")
      .eq("project_id", projectId)
      .in("from_id", documentIds.slice(i, i + IN_CHUNK))
      .is("valid_until", null);
    if (error) return empty;
    rels.push(...((data ?? []) as { from_id: string; to_id: string }[]));
  }
  const refIds = [...new Set(rels.map((r) => r.to_id))];
  if (refIds.length === 0) return empty;
  const { data: refs, error } = await supabase
    .from("classification_references")
    .select("id, identification, name, system_id")
    .in("id", refIds);
  if (error) return empty;
  type RefRow = { id: string; identification: string; name: string | null; system_id: string };
  const refRows = (refs ?? []) as RefRow[];
  const { data: systems, error: sErr } = await supabase
    .from("classification_systems")
    .select("id, name")
    .in("id", [...new Set(refRows.map((r) => r.system_id))]);
  if (sErr) return empty;
  const systemName = new Map(((systems ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  const refById = new Map(refRows.map((r) => [r.id, r]));
  return splitDocumentClassifications(
    rels.flatMap((r) => {
      const ref = refById.get(r.to_id);
      return ref
        ? [{ documentId: r.from_id, code: ref.identification, name: ref.name, system: systemName.get(ref.system_id) ?? null }]
        : [];
    }),
  );
}

/** Information type of documents (ISO 19650), without the media kind (D-104, D-131). */
export async function fetchDocumentTypes(projectId: string, documentIds: readonly string[]): Promise<Map<string, DocumentType>> {
  const out = new Map<string, DocumentType>();
  for (const [id, c] of await fetchDocumentClassifications(projectId, documentIds)) if (c.type) out.set(id, c.type);
  return out;
}
