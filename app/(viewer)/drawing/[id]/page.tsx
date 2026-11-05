import { notFound, redirect } from "next/navigation";

import { fetchDocumentReference } from "@/lib/data/documents";
import { fetchDrawing } from "@/lib/data/drawing";
import { fetchDocument } from "@/lib/data/object";
import DrawingWorkspace from "@/components/drawing-workspace";
import type { DocumentPanelData } from "@/components/document-info-panel";
import { currentPageProject } from "@/lib/project/page";

// ISR - render is cached and revalidated after 60 s (viewer is public read-only, D-029).
export const revalidate = 60;

/**
 * Document/drawing viewer (D-042 C+D, extended): canonical display
 * of **every** PDF document - source PDF on the left (with an overlay of clickable SNIM
 * codes, if the drawing has them, `_drawing_links`), on the right a panel with document info,
 * or, after clicking a code, with the element detail. Visualizes data linkage (the core of the demo).
 */
export default async function DrawingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `focus` = `objects.id` of the element to highlight; `page` = initial page (D-042 D). */
  searchParams: Promise<{ focus?: string; page?: string }>;
}) {
  const projectId = (await currentPageProject()).id;
  const { id } = await params;
  const { focus, page } = await searchParams;

  // Drawing (PDF + clickable regions) + document (metadata + "attached to") at once.
  const [drawing, document] = await Promise.all([
    fetchDrawing(projectId, id),
    fetchDocument(projectId, id),
  ]);
  if (!document) {
    // Reference to a part of a document (IfcDocumentReference, D-104) = its document on a page.
    const ref = await fetchDocumentReference(projectId, id);
    if (!ref) notFound(); // not a document
    redirect(`/drawing/${ref.documentId}${ref.page ? `?page=${ref.page}` : ""}`);
  }

  const pdfUrl = drawing?.location ?? document.location;
  const links = drawing?.links ?? [];
  const initialPage = page ? Number.parseInt(page, 10) : undefined;
  const hasLinks = links.length > 0;

  // PDF origin (Supabase Storage) - preconnect starts the TCP/TLS handshake right away,
  // so react-pdf downloads over a warm connection right after mount (D-030 perf, addendum).
  let pdfOrigin: string | null = null;
  if (pdfUrl) {
    try {
      pdfOrigin = new URL(pdfUrl).origin;
    } catch {
      pdfOrigin = null;
    }
  }

  const documentPanel: DocumentPanelData = {
    identification: document.identification,
    description: document.description,
    location: document.location,
    purpose: document.purpose,
    revision: document.revision,
    status: document.status,
    documentOwner: document.documentOwner,
    validFrom: document.validFrom,
    validUntil: document.validUntil,
    attachedTo: document.attachedTo,
  };

  return (
    <div className="mx-auto max-w-[1500px]">
      {/* React 19 hoists preconnect into <head> - the connection to the PDF origin opens
          in parallel with loading the react-pdf bundle, not only after it. */}
      {pdfOrigin && <link rel="preconnect" href={pdfOrigin} crossOrigin="anonymous" />}
      <header className="mb-4">
        <span className="inline-block rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          {hasLinks ? "Výkres" : "Dokument"}
        </span>
        <h1 className="mt-2 font-heading text-2xl font-semibold">
          {document.name ?? document.object_ref ?? "—"}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {document.object_ref && (
            <span className="font-mono text-[0.8rem]">{document.object_ref}</span>
          )}
          {hasLinks && <span>{links.length} klikateľných prvkov</span>}
        </div>
      </header>

      {/* key = id: soft navigation to another document (click on a drawing in the panel) must
          reset the viewer state (page/zoom/selection/progress) - without a remount the
          new document would inherit e.g. page 3 from the previous one. */}
      <DrawingWorkspace
        key={id}
        pdfUrl={pdfUrl}
        links={links}
        focus={focus}
        initialPage={
          initialPage && Number.isFinite(initialPage) ? initialPage : undefined
        }
        document={documentPanel}
      />
    </div>
  );
}
