import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { cachedProjectRead } from "@/lib/data/revalidate";
import { documentFolder, referencePage } from "@/lib/data/document-tree";
import { georefV2Wire, type GeorefV2 } from "@/lib/data/georef";
import { disciplineOf, documentMeta, floorDrawing, type DocumentHolder } from "@/lib/data/document-meta";
import { fetchDocumentClassifications, fetchNodes, typeText } from "@/lib/data/object-documents";

/**
 * Data-access layer for the in-viewer document library (D-075): maps
 * `objects` (`object_type='document'`) + the `documents` extension to the wire format
 * of the `DOCUMENTS_LOAD` bridge message (DocumentDescriptorWire in the fork).
 *
 * A sibling of `fetchUnderlayDrawings` (D-072), not a replacement - calibrated
 * drawings go to the viewer in BOTH messages (same documentId) and the panel
 * links them via `storeyGuid`. `meta` (D-104 step 3) carries the data for grouping
 * and searching in the viewer (`document-meta.ts`).
 */

/** Wire format of a document for `DOCUMENTS_LOAD` (mirrors the fork bridge-protocol). */
export interface DocumentWire {
  documentId: string;
  name: string;
  kind: "drawing" | "document" | "image";
  url: string;
  mime?: string;
  storeyGuid?: string;
  /** All storeys the drawing carries (roof: 4NP and 5NP); `storeyGuid` only for a single one (D-176). */
  storeyGuids?: string[];
  /** Discipline from the document code (ASR, PBR...), only for a storey drawing (D-176). */
  discipline?: string;
  folder?: string[];
  /** Underlay calibrations (D-179), same as in `UNDERLAYS_LOAD`: floor plans and sections (`plane`). Absent until the document is calibrated. */
  georefV2?: GeorefV2;
  meta?: Record<string, string>;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const PDF_EXT_RE = /\.pdf($|\?)/i;

/** Mime by the extension of the public URL - the viewer routes viewers by it. */
function mimeFor(location: string): string | null {
  if (PDF_EXT_RE.test(location)) return "application/pdf";
  const m = IMAGE_EXT_RE.exec(location);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return `image/${ext === "jpg" ? "jpeg" : ext === "svg" ? "svg+xml" : ext}`;
}

async function fetchProjectDocumentsImpl(projectId: string): Promise<DocumentWire[]> {
  const supabase = getSupabaseAdmin();

  // Intentionally without pagination (pattern fetchUnderlayDrawings): there are ~54 documents
  // (IFC, D-104), far below the PostgREST cap of 1000. Reconsider for multi-project (D-033).
  const [objsRes, docsRes, partsRes] = await Promise.all([
    supabase
      .from("objects")
      .select("id, name, object_ref, georef:properties->_georef")
      .eq("project_id", projectId)
      .eq("object_type", "document")
      .is("valid_until", null),
    supabase
      .from("documents")
      .select("id, identification, location, document_owner, last_revision_time, electronic_format")
      .eq("storage_type", "supabase"),
    // Documentation tree from IFC (D-104): part -> parent document.
    supabase
      .from("rel_document_information_relationship")
      .select("from_id, to_id")
      .eq("project_id", projectId)
      .is("valid_until", null),
  ]);
  if (objsRes.error) throw new Error(objsRes.error.message);
  if (docsRes.error) throw new Error(docsRes.error.message);
  if (partsRes.error) throw new Error(partsRes.error.message);
  const docById = new Map((docsRes.data ?? []).map((d) => [d.id as string, d]));
  const parentOf = new Map(
    ((partsRes.data ?? []) as { from_id: string; to_id: string }[]).map((r) => [r.from_id, r.to_id])
  );
  const nameOf = new Map(
    (objsRes.data ?? []).map((o) => [o.id as string, (o.name as string | null) ?? (o.id as string)])
  );

  const georefOf = new Map((objsRes.data ?? []).map((o) => [o.id as string, georefV2Wire((o as { georef?: unknown }).georef)]));
  const refOf = new Map((objsRes.data ?? []).map((o) => [o.id as string, (o.object_ref as string | null) ?? null]));

  // Carriers (D-104 step 3): who carries the document (storey, space, zone...) and the kind
  // (information type per ISO 19650) and the media kind (D-131). From them `meta` is built for grouping and
  // the storey floor plan.
  const fileIds = [...docById.keys()].filter((id) => nameOf.has(id));
  const [holdersByDoc, classes] = await Promise.all([fetchHolders(projectId, fileIds), fetchDocumentClassifications(projectId, fileIds)]);

  const out: DocumentWire[] = [];
  for (const obj of objsRes.data ?? []) {
    const id = obj.id as string;
    const doc = docById.get(id);
    const location = (doc?.location as string | null) ?? null;
    if (!doc || !location) continue; // without a public file there is nothing to show
    // D-075 v1 = PDF + images. Other formats (docx, dwg, zip...) are not sent -
    // the viewer would feed them to pdf.js and show a broken card; they remain available
    // via /drawing/[id] or a direct link until their viewer arrives.
    const mime = mimeFor(location);
    if (!mime) continue;
    const name = (obj.name as string | null) ?? id;
    const holders = holdersByDoc.get(id) ?? [];
    const { type, mediaKind } = classes.get(id) ?? {};
    const plan = floorDrawing(holders, type?.code);
    const floorGuids = plan.drawing ? [...new Set(holders.filter((h) => h.objectType === "floor" && h.ifcGuid).map((h) => h.ifcGuid as string))] : [];
    const discipline = plan.drawing ? disciplineOf(refOf.get(id) ?? name) : null;
    const kind: DocumentWire["kind"] = plan.drawing ? "drawing" : mime.startsWith("image/") ? "image" : "document";

    // Folder: documentation tree from IFC (D-104), the PD root is omitted.
    const tree = documentFolder(id, parentOf, nameOf);
    const meta = documentMeta({
      identification: (doc.identification as string | null) ?? null,
      folder: tree,
      type: typeText(type),
      mediaKind: mediaKind?.name ?? mediaKind?.code,
      holders,
      lastRevisionTime: (doc.last_revision_time as string | null) ?? null,
      electronicFormat: (doc.electronic_format as string | null) ?? mime,
      owner: (doc.document_owner as string | null) ?? null,
    });

    out.push({
      documentId: id,
      name,
      kind,
      url: location,
      mime,
      ...(plan.storeyGuid ? { storeyGuid: plan.storeyGuid } : {}),
      ...(floorGuids.length > 1 ? { storeyGuids: floorGuids } : {}),
      ...(discipline ? { discipline } : {}),
      ...(tree.length > 0 ? { folder: tree } : {}),
      ...(georefOf.get(id) ? { georefV2: georefOf.get(id)! } : {}),
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
    });
  }
  // Stable order for the viewer and the cache (name, then id).
  out.sort((a, b) => a.name.localeCompare(b.name) || a.documentId.localeCompare(b.documentId));
  return out;
}

/** Carriers of documents (rel_associates_document -> object), per document. */
async function fetchHolders(projectId: string, documentIds: readonly string[]): Promise<Map<string, DocumentHolder[]>> {
  const out = new Map<string, DocumentHolder[]>();
  if (documentIds.length === 0) return out;
  const supabase = getSupabaseAdmin();
  const { data: rels, error } = await supabase
    .from("rel_associates_document")
    .select("from_id, to_id")
    .eq("project_id", projectId)
    .in("to_id", documentIds)
    .is("valid_until", null)
    .not("from_id", "is", null); // carrier without an AIM node (D-183 K3)
  if (error) throw new Error(error.message);
  const pairs = (rels ?? []) as { from_id: string; to_id: string }[];
  const nodes = await fetchNodes(projectId, pairs.map((r) => r.from_id));
  const { data: guids, error: gErr } = await supabase
    .from("objects")
    .select("id, ifc_guid")
    .eq("project_id", projectId)
    .in("id", nodes.filter((n) => n.object_type === "floor").map((n) => n.id));
  if (gErr) throw new Error(gErr.message);
  const guidOf = new Map(((guids ?? []) as { id: string; ifc_guid: string | null }[]).map((g) => [g.id, g.ifc_guid]));
  const nodeOf = new Map(nodes.map((n) => [n.id, n]));
  for (const r of pairs) {
    const n = nodeOf.get(r.from_id);
    if (!n) continue;
    const list = out.get(r.to_id) ?? [];
    list.push({ objectType: n.object_type, name: n.name, ifcGuid: guidOf.get(n.id) ?? null });
    out.set(r.to_id, list);
  }
  return out;
}

/** Document library for the 3D viewer (ISR, tag `aim`). */
export const fetchProjectDocuments = cachedProjectRead("fetch-project-documents", fetchProjectDocumentsImpl);

/** Target of an IfcDocumentReference (D-104): the document whose part the reference denotes, and the page. */
export interface DocumentReferenceTarget {
  documentId: string;
  page: number | null;
}

async function fetchDocumentReferenceImpl(projectId: string, id: string): Promise<DocumentReferenceTarget | null> {
  const supabase = getSupabaseAdmin();
  const [objRes, docRes] = await Promise.all([
    supabase
      .from("objects")
      .select("id")
      .eq("project_id", projectId)
      .eq("id", id)
      .eq("object_type", "document_reference")
      .limit(1),
    supabase
      .from("documents")
      .select("location, identification, referenced_document_id")
      .eq("id", id)
      .limit(1),
  ]);
  if (objRes.error) throw new Error(objRes.error.message);
  if (docRes.error) throw new Error(docRes.error.message);
  const d = docRes.data?.[0];
  if (!objRes.data?.[0] || !d?.referenced_document_id) return null;
  return {
    documentId: d.referenced_document_id as string,
    page: referencePage(
      (d.location as string | null) ?? null,
      (d.identification as string | null) ?? null
    ),
  };
}

/** Reference to a document part -> document and page (ISR, tag `aim`). */
export const fetchDocumentReference = cachedProjectRead("fetch-document-reference", fetchDocumentReferenceImpl);
