import "server-only";

import { unstable_cache } from "next/cache";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { AIM_CACHE } from "@/lib/data/constants";
import { documentFolder, referencePage } from "@/lib/data/document-tree";
import { disciplineOf, documentMeta, floorDrawing, type DocumentHolder } from "@/lib/data/document-meta";
import { fetchDocumentClassifications, fetchNodes, typeText } from "@/lib/data/object-documents";

/**
 * Data-access vrstva pre in-viewer knižnicu dokumentov (D-075): mapuje
 * `objects` (`object_type='document'`) + príponu `documents` na wire formát
 * `DOCUMENTS_LOAD` bridge správy (DocumentDescriptorWire vo forku).
 *
 * Súrodenec `fetchUnderlayDrawings` (D-072), nie náhrada — kalibrované
 * výkresy idú do viewera v OBOCH správach (rovnaké documentId) a panel ich
 * prepája cez `storeyGuid`. `meta` (D-104 krok 3) nesie údaje na zoskupenie
 * a hľadanie vo vieweri (`document-meta.ts`).
 */

/** Wire formát dokumentu pre `DOCUMENTS_LOAD` (zrkadlí fork bridge-protocol). */
export interface DocumentWire {
  documentId: string;
  name: string;
  kind: "drawing" | "document" | "image";
  url: string;
  mime?: string;
  storeyGuid?: string;
  /** Všetky podlažia, ktoré výkres nesie (strecha: 4NP aj 5NP); `storeyGuid` je len pri jedinom (D-176). */
  storeyGuids?: string[];
  /** Disciplína z kódu dokumentu (ASR, PBR...), len pri výkrese podlažia (D-176). */
  discipline?: string;
  folder?: string[];
  meta?: Record<string, string>;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const PDF_EXT_RE = /\.pdf($|\?)/i;

/** Mime podľa prípony verejnej URL — viewer podľa neho routuje viewery. */
function mimeFor(location: string): string | null {
  if (PDF_EXT_RE.test(location)) return "application/pdf";
  const m = IMAGE_EXT_RE.exec(location);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return `image/${ext === "jpg" ? "jpeg" : ext === "svg" ? "svg+xml" : ext}`;
}

async function fetchProjectDocumentsImpl(): Promise<DocumentWire[]> {
  const supabase = getSupabaseAdmin();

  // Bez stránkovania zámerne (vzor fetchUnderlayDrawings): dokumentov je ~54
  // (IFC, D-104), hlboko pod PostgREST capom 1000. Pri multi-projekte (D-033) prehodnotiť.
  const [objsRes, docsRes, partsRes] = await Promise.all([
    supabase
      .from("objects")
      .select("id, name, object_ref")
      .eq("object_type", "document")
      .is("valid_until", null),
    supabase
      .from("documents")
      .select("id, identification, location, document_owner, last_revision_time, electronic_format")
      .eq("storage_type", "supabase"),
    // Strom dokumentácie z IFC (D-104): časť → nadradený dokument.
    supabase
      .from("rel_document_information_relationship")
      .select("from_id, to_id")
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

  const refOf = new Map((objsRes.data ?? []).map((o) => [o.id as string, (o.object_ref as string | null) ?? null]));

  // Nositelia (D-104 krok 3): kto dokument nesie (podlažie, miestnosť, zóna...) a druh
  // (typ informácie ISO 19650) a druh média (D-131). Z nich je `meta` na zoskupenie a
  // pôdorys podlažia.
  const fileIds = [...docById.keys()].filter((id) => nameOf.has(id));
  const [holdersByDoc, classes] = await Promise.all([fetchHolders(fileIds), fetchDocumentClassifications(fileIds)]);

  const out: DocumentWire[] = [];
  for (const obj of objsRes.data ?? []) {
    const id = obj.id as string;
    const doc = docById.get(id);
    const location = (doc?.location as string | null) ?? null;
    if (!doc || !location) continue; // bez verejného súboru niet čo zobraziť
    // D-075 v1 = PDF + obrázky. Iné formáty (docx, dwg, zip…) sa neposielajú —
    // viewer by ich kŕmil do pdf.js a ukázal rozbitú kartu; ostávajú dostupné
    // cez /drawing/[id] resp. priamy link, kým nepríde ich viewer.
    const mime = mimeFor(location);
    if (!mime) continue;
    const name = (obj.name as string | null) ?? id;
    const holders = holdersByDoc.get(id) ?? [];
    const { type, mediaKind } = classes.get(id) ?? {};
    const plan = floorDrawing(holders, type?.code);
    const floorGuids = plan.drawing ? [...new Set(holders.filter((h) => h.objectType === "floor" && h.ifcGuid).map((h) => h.ifcGuid as string))] : [];
    const discipline = plan.drawing ? disciplineOf(refOf.get(id) ?? name) : null;
    const kind: DocumentWire["kind"] = plan.drawing ? "drawing" : mime.startsWith("image/") ? "image" : "document";

    // Folder: strom dokumentácie z IFC (D-104), koreň PD sa vynecháva.
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
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
    });
  }
  // Stabilné poradie pre viewer aj cache (názov, potom id).
  out.sort((a, b) => a.name.localeCompare(b.name) || a.documentId.localeCompare(b.documentId));
  return out;
}

/** Nositelia dokumentov (rel_associates_document -> objekt), po dokumentoch. */
async function fetchHolders(documentIds: readonly string[]): Promise<Map<string, DocumentHolder[]>> {
  const out = new Map<string, DocumentHolder[]>();
  if (documentIds.length === 0) return out;
  const supabase = getSupabaseAdmin();
  const { data: rels, error } = await supabase
    .from("rel_associates_document")
    .select("from_id, to_id")
    .in("to_id", documentIds)
    .is("valid_until", null)
    .not("from_id", "is", null); // nositeľ bez uzla AIM (D-183 K3)
  if (error) throw new Error(error.message);
  const pairs = (rels ?? []) as { from_id: string; to_id: string }[];
  const nodes = await fetchNodes(pairs.map((r) => r.from_id));
  const { data: guids, error: gErr } = await supabase
    .from("objects")
    .select("id, ifc_guid")
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

/** Knižnica dokumentov pre 3D viewer (ISR, tag `aim`). */
export const fetchProjectDocuments = unstable_cache(
  fetchProjectDocumentsImpl,
  ["fetch-project-documents"],
  AIM_CACHE
);

/** Cieľ IfcDocumentReference (D-104): dokument, ktorého časť odkaz označuje, a strana. */
export interface DocumentReferenceTarget {
  documentId: string;
  page: number | null;
}

async function fetchDocumentReferenceImpl(id: string): Promise<DocumentReferenceTarget | null> {
  const supabase = getSupabaseAdmin();
  const [objRes, docRes] = await Promise.all([
    supabase
      .from("objects")
      .select("id")
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

/** Odkaz na časť dokumentu → dokument a strana (ISR, tag `aim`). */
export const fetchDocumentReference = unstable_cache(
  fetchDocumentReferenceImpl,
  ["fetch-document-reference"],
  AIM_CACHE
);
