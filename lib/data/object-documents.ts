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
 * Druh dokumentov z klasifikácie (`rel_external_reference_relationship`, migrácia
 * `20261020150000`). Bez migrácie alebo bez klasifikácie vráti prázdnu mapu:
 * druh je doplnok, nie podmienka zoznamu.
 */
export async function fetchDocumentTypes(documentIds: readonly string[]): Promise<Map<string, DocumentType>> {
  const out = new Map<string, DocumentType>();
  if (documentIds.length === 0) return out;
  const supabase = getSupabaseAdmin();
  const rels: { from_id: string; to_id: string }[] = [];
  for (let i = 0; i < documentIds.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from("rel_external_reference_relationship")
      .select("from_id, to_id")
      .in("from_id", documentIds.slice(i, i + IN_CHUNK))
      .is("valid_until", null);
    if (error) return out;
    rels.push(...((data ?? []) as { from_id: string; to_id: string }[]));
  }
  const refIds = [...new Set(rels.map((r) => r.to_id))];
  if (refIds.length === 0) return out;
  const { data: refs, error } = await supabase
    .from("classification_references")
    .select("id, identification, name")
    .in("id", refIds);
  if (error) return out;
  const refById = new Map(
    ((refs ?? []) as { id: string; identification: string; name: string | null }[]).map((r) => [r.id, r]),
  );
  for (const r of rels) {
    const ref = refById.get(r.to_id);
    if (ref && !out.has(r.from_id)) out.set(r.from_id, { code: ref.identification, name: ref.name });
  }
  return out;
}
