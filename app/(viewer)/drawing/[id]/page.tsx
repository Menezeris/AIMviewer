import { notFound, redirect } from "next/navigation";

import { fetchDocumentReference } from "@/lib/data/documents";
import { fetchDrawing } from "@/lib/data/drawing";
import { fetchDocument } from "@/lib/data/object";
import DrawingWorkspace from "@/components/drawing-workspace";
import type { DocumentPanelData } from "@/components/document-info-panel";

// ISR — render sa cachuje a po 60 s revaliduje (viewer je verejný read-only, D-029).
export const revalidate = 60;

/**
 * Prehliadačka dokumentu/výkresu (D-042 C+D, rozšírené): kanonické zobrazenie
 * **každého** PDF dokumentu — zdrojové PDF vľavo (s prekrytím klikateľných SNIM
 * kódov, ak ich výkres má, `_drawing_links`), vpravo panel s info o dokumente,
 * resp. po kliku na kód s detailom prvku. Vizualizuje previazanosť dát (jadro dema).
 */
export default async function DrawingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `focus` = `objects.id` prvku na zvýraznenie; `page` = počiatočná strana (D-042 D). */
  searchParams: Promise<{ focus?: string; page?: string }>;
}) {
  const { id } = await params;
  const { focus, page } = await searchParams;

  // Výkres (PDF + klikateľné regióny) + dokument (metadáta + „pripojené k") naraz.
  const [drawing, document] = await Promise.all([
    fetchDrawing(id),
    fetchDocument(id),
  ]);
  if (!document) {
    // Odkaz na časť dokumentu (IfcDocumentReference, D-101) = jeho dokument na strane.
    const ref = await fetchDocumentReference(id);
    if (!ref) notFound(); // nie je dokument
    redirect(`/drawing/${ref.documentId}${ref.page ? `?page=${ref.page}` : ""}`);
  }

  const pdfUrl = drawing?.location ?? document.location;
  const links = drawing?.links ?? [];
  const initialPage = page ? Number.parseInt(page, 10) : undefined;
  const hasLinks = links.length > 0;

  // Origin PDF (Supabase Storage) — preconnect rozbehne TCP/TLS handshake hneď,
  // takže react-pdf po mount-e sťahuje rovno cez teplé spojenie (D-030 perf, dodatok).
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
      {/* React 19 hoistne preconnect do <head> — spojenie na PDF origin sa otvára
          paralelne s načítaním react-pdf bundlu, nie až po ňom. */}
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

      {/* key = id: soft-navigácia na iný dokument (klik na výkres v paneli) musí
          resetnúť stav prehliadačky (strana/zoom/výber/progress) — bez remountu by
          nový dokument zdedil napr. stranu 3 z predchádzajúceho. */}
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
