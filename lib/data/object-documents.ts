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
 * Dokumenty objektu cez vzťahy (D-104, pohľad `v_object_documents`) na jednom
 * mieste: číta ich tool `get_object(include=documents)` aj AIM karta vo vieweri
 * (`/api/element`), aby karta a konektor ukazovali to isté.
 *
 * Čítanie z DB; čisté funkcie (zlúčenie ciest, texty pre kartu) sú v
 * `object-documents-core.ts`, ktoré smie načítať aj klient.
 */

const IN_CHUNK = 200;

/** Uzly podľa id (dokumenty, nositelia), po dávkach kvôli dĺžke URL. */
export async function fetchNodes(ids: Iterable<string>): Promise<ObjectDocumentNode[]> {
  const unique = [...new Set(ids)];
  const supabase = getSupabaseAdmin();
  const out: ObjectDocumentNode[] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from("objects")
      .select("id, object_type, object_ref, name")
      .in("id", unique.slice(i, i + IN_CHUNK));
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as ObjectDocumentNode[]));
  }
  return out;
}

/** Dokumenty objektu s cestou a uzly, ktoré sa pri tom načítali. */
export async function fetchObjectDocuments(
  objectId: string,
): Promise<{ documents: ObjectDocument[]; nodes: ObjectDocumentNode[] }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("v_object_documents")
    .select("document_id, page, via, via_id, via_nearest_id, depth")
    .eq("object_id", objectId)
    .order("depth")
    .limit(500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ViewRow[];
  const nodes = await fetchNodes(
    rows.flatMap((r) => [r.document_id, r.via_id, r.via_nearest_id].filter(Boolean) as string[]),
  );
  return { documents: dedupeObjectDocuments(rows, new Map(nodes.map((n) => [n.id, n]))), nodes };
}

/** Riadok `v_object_documents` z pohľadu dokumentu: objekt, ktorého sa dokument týka. */
export interface DocumentObjectRow {
  object_id: string;
  object_type: string;
  via: string;
  via_id: string | null;
  depth: number;
  page: number | null;
}

/**
 * Objekty, ktorých sa dokument týka (D-104 krok 4), aj zdedené cez nositeľa
 * (podlažie, zóna, skupina, typ). `document_reference` = len cez ten odkaz na
 * časť dokumentu, `page` = len odkazy na tú stranu. Zoradené podľa `depth`, takže
 * prvý riadok objektu je jeho najbližšia cesta. Stránkuje: pôdorys podlažia
 * presahuje strop odpovede PostgREST (1000 riadkov).
 */
export async function fetchDocumentObjectRows(
  doc: { id: string; object_type: string },
  page?: number,
): Promise<DocumentObjectRow[]> {
  const supabase = getSupabaseAdmin();
  const column = doc.object_type === "document_reference" ? "reference_id" : "document_id";
  return fetchAllPages<DocumentObjectRow>((from, to) => {
    let q = supabase
      .from("v_object_documents")
      .select("object_id, object_type, via, via_id, depth, page")
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
 * Klasifikácie dokumentov (`rel_external_reference_relationship`, migrácia
 * `20261020150000`) po osiach: typ informácie ISO 19650 a druh média (D-131).
 * Bez migrácie alebo bez klasifikácie vráti prázdnu mapu: druh je doplnok, nie
 * podmienka zoznamu.
 */
export async function fetchDocumentClassifications(
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

/** Typ informácie dokumentov (ISO 19650), bez druhu média (D-104, D-131). */
export async function fetchDocumentTypes(documentIds: readonly string[]): Promise<Map<string, DocumentType>> {
  const out = new Map<string, DocumentType>();
  for (const [id, c] of await fetchDocumentClassifications(documentIds)) if (c.type) out.set(id, c.type);
  return out;
}
