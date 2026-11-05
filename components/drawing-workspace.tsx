"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import type { DrawingRegion, SelectedElement } from "@/lib/data/drawing";
import { ElementInfoPanel } from "@/components/element-info-panel";
import {
  DocumentInfoPanel,
  type DocumentPanelData,
} from "@/components/document-info-panel";

/**
 * Document/drawing workspace (D-042 D+): on the left the PDF viewer (with clickable
 * codes, if the drawing has them), on the right a side panel. The panel **by default** shows info
 * about the document (metadata + "Pripojené k" (attached to)); a click on a SNIM code switches it to the element
 * detail (with "Späť na dokument" (back to the document)). The click **does not leave the page**.
 *
 * Narrow widths (D-054 cadence 2): on mobile the panel is in the flow BELOW the viewer, so the detail
 * after a click on a code would end up below the fold - the selected element is therefore shown as a floating
 * **bottom-sheet** (fixed, own scroll, no backdrop - the drawing stays interactive,
 * another tap on a different code only switches the panel). "Späť na dokument" closes the sheet. From the `lg`
 * breakpoint the same DOM returns to a static side column.
 *
 * The viewer is loaded exclusively in the browser (`ssr: false`) - pdf.js needs the DOM/Worker.
 */
const DrawingViewer = dynamic(
  () => import("@/components/drawing-viewer").then((m) => m.DrawingViewer),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-md ring-1 ring-border p-8 text-sm text-muted-foreground">
        Načítavam prehliadačku…
      </div>
    ),
  }
);

export default function DrawingWorkspace({
  pdfUrl,
  links,
  focus,
  initialPage,
  document,
}: {
  pdfUrl: string | null;
  links: DrawingRegion[];
  focus?: string;
  initialPage?: number;
  document: DocumentPanelData;
}) {
  // Preselect the element from `?focus=` - the panel opens directly with it (bidirectionality).
  // Assembly regions (`drawing` route) are not elements -> they do not go to the panel.
  const initial = focus
    ? links.find((l) => l.targetId === focus && l.targetRoute !== "drawing")
    : undefined;
  const [selected, setSelected] = useState<SelectedElement | null>(
    initial
      ? {
          id: initial.targetId,
          route: initial.targetRoute as "node" | "type",
          label: initial.label,
        }
      : null
  );

  const panel = selected ? (
    <ElementInfoPanel selected={selected} onBack={() => setSelected(null)} />
  ) : (
    <DocumentInfoPanel document={document} />
  );

  // Document without a PDF (defensive - all 13 are PDF): panel only.
  if (!pdfUrl) {
    return <div className="max-w-3xl">{panel}</div>;
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <DrawingViewer
          url={pdfUrl}
          links={links}
          focus={focus}
          initialPage={initialPage}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
        />
      </div>
      <aside
        className={
          selected
            ? "fixed inset-x-3 bottom-3 z-50 max-h-[70dvh] overflow-y-auto overscroll-contain drop-shadow-xl lg:static lg:inset-auto lg:z-auto lg:max-h-none lg:w-80 lg:shrink-0 lg:overflow-visible lg:overscroll-auto lg:drop-shadow-none"
            : "shrink-0 lg:w-80"
        }
      >
        {panel}
      </aside>
    </div>
  );
}
