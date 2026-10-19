import "server-only";

import { unstable_cache } from "next/cache";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { AIM_CACHE } from "@/lib/data/constants";
import { documentFolder, referencePage } from "@/lib/data/document-tree";

/**
 * Data-access vrstva pre in-viewer knižnicu dokumentov (D-075): mapuje
 * `objects` (`object_type='document'`) + príponu `documents` na wire formát
 * `DOCUMENTS_LOAD` bridge správy (DocumentDescriptorWire vo forku).
 *
 * Súrodenec `fetchUnderlayDrawings` (D-072), nie náhrada — kalibrované
 * výkresy idú do viewera v OBOCH správach (rovnaké documentId) a panel ich
 * prepája cez `storeyGuid`.
 */

/** Wire formát dokumentu pre `DOCUMENTS_LOAD` (zrkadlí fork bridge-protocol). */
export interface DocumentWire {
  documentId: string;
  name: string;
  kind: "drawing" | "document" | "image";
  url: string;
  mime?: string;
  storeyGuid?: string;
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
  // (IFC, D-101), hlboko pod PostgREST capom 1000. Pri multi-projekte (D-033) prehodnotiť.
  // Tri nezávislé selecty naraz — len rel dotaz nižšie potrebuje floorIds.
  const [objsRes, docsRes, floorsRes, partsRes] = await Promise.all([
    supabase
      .from("objects")
      .select("id, name")
      .eq("object_type", "document")
      .is("valid_until", null),
    supabase
      .from("documents")
      .select("id, location, storage_type, revision, status, purpose")
      .eq("storage_type", "supabase"),
    supabase
      .from("objects")
      .select("id, name, ifc_guid")
      .eq("object_type", "floor")
      .is("valid_until", null),
    // Strom dokumentácie z IFC (D-101): časť → nadradený dokument.
    supabase
      .from("rel_document_information_relationship")
      .select("from_id, to_id")
      .is("valid_until", null),
  ]);
  if (objsRes.error) throw new Error(objsRes.error.message);
  if (docsRes.error) throw new Error(docsRes.error.message);
  if (floorsRes.error) throw new Error(floorsRes.error.message);
  if (partsRes.error) throw new Error(partsRes.error.message);
  const docById = new Map((docsRes.data ?? []).map((d) => [d.id as string, d]));
  const parentOf = new Map(
    ((partsRes.data ?? []) as { from_id: string; to_id: string }[]).map((r) => [r.from_id, r.to_id])
  );
  const nameOf = new Map(
    (objsRes.data ?? []).map((o) => [o.id as string, (o.name as string | null) ?? (o.id as string)])
  );

  // Väzba podlažie → výkres (E3, role='drawing') určuje kind='drawing',
  // storeyGuid (IFC GlobalId podlažia) a folder (názov podlažia).
  const floorById = new Map(
    (floorsRes.data ?? []).map((f) => [
      f.id as string,
      { name: (f.name as string | null) ?? "", guid: (f.ifc_guid as string | null) ?? "" },
    ])
  );

  const floorIds = [...floorById.keys()];
  const drawingFloorByDocId = new Map<string, { name: string; guid: string }>();
  if (floorIds.length > 0) {
    const { data: rels, error: rErr } = await supabase
      .from("rel_associates_document")
      .select("from_id, to_id")
      .in("from_id", floorIds)
      .eq("role", "drawing")
      .is("valid_until", null);
    if (rErr) throw new Error(rErr.message);
    for (const rel of (rels ?? []) as { from_id: string; to_id: string }[]) {
      const floor = floorById.get(rel.from_id);
      if (floor && !drawingFloorByDocId.has(rel.to_id)) {
        drawingFloorByDocId.set(rel.to_id, floor);
      }
    }
  }

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
    const floor = drawingFloorByDocId.get(id);
    const kind: DocumentWire["kind"] = floor
      ? "drawing"
      : mime.startsWith("image/")
        ? "image"
        : "document";

    const meta: Record<string, string> = {};
    for (const key of ["revision", "status", "purpose"] as const) {
      const value = doc[key] as string | null;
      if (value) meta[key] = value;
    }

    // Folder: výkresy podľa podlažia, potom strom dokumentácie z IFC (D-101),
    // inak podľa účelu (CDE typ, D-036).
    const tree = documentFolder(id, parentOf, nameOf);
    const folder = floor?.name
      ? ["Výkresy", floor.name]
      : tree.length > 0
        ? tree
        : typeof doc.purpose === "string" && doc.purpose
          ? [doc.purpose]
          : undefined;

    out.push({
      documentId: id,
      name,
      kind,
      url: location,
      mime,
      ...(floor?.guid ? { storeyGuid: floor.guid } : {}),
      ...(folder ? { folder } : {}),
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
    });
  }
  // Stabilné poradie pre viewer aj cache (názov, potom id).
  out.sort((a, b) => a.name.localeCompare(b.name) || a.documentId.localeCompare(b.documentId));
  return out;
}

/** Knižnica dokumentov pre 3D viewer (ISR, tag `aim`). */
export const fetchProjectDocuments = unstable_cache(
  fetchProjectDocumentsImpl,
  ["fetch-project-documents"],
  AIM_CACHE
);

/** Cieľ IfcDocumentReference (D-101): dokument, ktorého časť odkaz označuje, a strana. */
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
