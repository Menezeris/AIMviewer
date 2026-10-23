"use client";

import { LoadingLogo } from "@/components/loading-logo";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { X } from "lucide-react";

import type { UnderlayDrawingWire } from "@/lib/data/drawing";
import type { DocumentWire } from "@/lib/data/documents";
import type { CaptureViewerWire } from "@/lib/data/captures";
import type { TreeDecorations } from "@/lib/data/decoration-counts";
import type { DerivationsLayerWire } from "@/lib/derivations";
import type { DocumentLinksWire } from "@/lib/data/drawing-links";
import type { GuidMap, IfcModel } from "@/lib/data/ifc";
import type { ViewerApi } from "@/lib/viewer-api";
import { CaptureGallery } from "@/components/capture-gallery";
import { Button } from "@/components/ui/button";
import { LIVE_ENV_SLOT_ID, LIVE_SLOT_ID } from "@/components/live-channel";
import { viewerChoiceLabel } from "@/lib/viewer-source";
import { ViewerPicker, useViewerChoice } from "@/components/viewer-picker";

// 3D viewer je embed-nutý ifc-lite viewer cez iframe (postMessage bridge),
// nie in-process three.js. Rovnaké Props + ViewerApi, takže workspace je bez zmeny.
// Používa sa variant s podporou viewer ops AI docku (D-066).
const IFCViewer = dynamic(
  () => import("@/components/ifc-viewer").then((m) => m.IFCViewer),
  {
    ssr: false,
    loading: () => (
      <div className="relative h-full w-full">
        <LoadingLogo label="Načítavam 3D prehliadač" />
      </div>
    ),
  }
);

/**
 * Full-page 3D workspace: viewer vypĺňa celú plochu. Detail vybraného prvku
 * sa zobrazuje ako AIM karta priamo v natívnom paneli embed viewera (host mu
 * posiela DB dáta cez bridge, viď ifc-viewer.tsx + lib/aim-panel.ts) — žiadny
 * druhý plávajúci panel. IFC-typ FilterBar bol odstránený — filtrovanie beží
 * cez AI dock a natívne nástroje embed viewera.
 */
export default function IFCWorkspace({
  models,
  guidMap,
  focus,
  focusNonce,
  ops,
  underlays,
  documents,
  openDocumentId,
  captures,
  decorations,
  derivations,
  documentLinks,
}: {
  models: IfcModel[];
  guidMap: GuidMap;
  focus?: string;
  /** Nonce akcie AI docku — nová hodnota vynúti re-aplikáciu focusu/ops (D-056). */
  focusNonce?: string;
  /** Viewer operácie AI docku (ofarbenie/skrytie/izolácia, D-066). */
  ops?: string;
  /** Georeferencované PDF podklady pre embed viewer (D-072). */
  underlays?: UnderlayDrawingWire[];
  /** Knižnica dokumentov pre in-viewer Documents panel (D-075). */
  documents?: DocumentWire[];
  /** Deep link (D-075): dokument, ktorý sa má otvoriť ako karta (`?doc=`). */
  openDocumentId?: string;
  /** Reality Capture piny s 3D ukotvením (D-073). */
  captures?: CaptureViewerWire[];
  /** AIM dekorácie stromu (D-077) — per-GUID badge counts pre embed viewer. */
  decorations?: TreeDecorations;
  /** Vrstva AIM nad modelmi (D-089): register pravidiel odvodení a revízie modelov. */
  derivations?: DerivationsLayerWire | null;
  /** Popisky pôdorysov ako odkazy na prvok (D-130, AIM vrstva). */
  documentLinks?: DocumentLinksWire[] | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewerApiRef = useRef<ViewerApi | null>(null);
  const [siblingLoading, setSiblingLoading] = useState(false);
  // Vložený viewer (D-116): produkcia alebo náhľad PR forku z výberu nad 3D.
  const viewer = useViewerChoice();

  // Reality Capture (D-073): AIM karta v 3D odkazuje na /ifc?captures=<spaceId>
  // (soft-nav, iframe sa neremountuje) → galéria priestoru ako overlay nad 3D.
  const captureSpaceId = searchParams.get("captures");
  function closeCaptures() {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("captures");
    router.replace(sp.toString() ? `/ifc?${sp}` : "/ifc");
  }

  // 3D → DB: po picku dotiahni súrodencov v priestore a zvýrazni ich.
  async function handlePickedElement(objectId: string) {
    setSiblingLoading(true);
    try {
      const res = await fetch(`/api/space-siblings/${objectId}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        spaceId: string | null;
        siblingObjectIds: string[];
      };
      if (data.spaceId && data.siblingObjectIds.length > 1) {
        viewerApiRef.current?.highlightSiblings(data.siblingObjectIds, objectId);
      }
    } catch (err) {
      // Volá sa fire-and-forget z bridge handlera — bez catch by network
      // chyba skončila ako unhandled rejection. Zvýraznenie je best-effort.
      console.error("space-siblings fetch failed", err);
    } finally {
      setSiblingLoading(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col">
      {/* Prostredie mimo produkcie (D-159): náhľad viewera PR a testovací kanál (pruh z LiveChannel). */}
      <div id={LIVE_ENV_SLOT_ID} className="shrink-0" data-host-envbar>
        {viewer.choice.kind !== "prod" && (
          <div className="bg-amber-100 px-3 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Náhľad viewera {viewerChoiceLabel(viewer.choice)}: nie je to produkčný viewer
          </div>
        )}
      </div>
      {/* Viewer s vlastnou stavovou lištou; overlaye hostu ho neprekrývajú (#185). */}
      <div className="relative min-h-0 flex-1">
      {viewer.viewerUrl ? (
        <IFCViewer
          viewerUrl={viewer.viewerUrl}
          models={models}
          guidMap={guidMap}
          focus={focus}
          focusNonce={focusNonce}
          ops={ops}
          underlays={underlays}
          documents={documents}
          openDocumentId={openDocumentId}
          captures={captures}
          decorations={decorations}
          derivations={derivations}
          documentLinks={documentLinks}
          apiRef={viewerApiRef}
          onPickedElement={handlePickedElement}
          onNavigate={(href) => router.push(href)}
          onCaptureClick={(captureId) => {
            // 3D → host: klik na capture pin → otvor priestor so snímkami (galéria
            // na /node/[space]). Obojsmernosť „snímka ↔ priestor" (D-073).
            const pin = captures?.find((c) => c.id === captureId);
            if (pin?.spaceId) router.push(`/node/${pin.spaceId}`);
          }}
        />
      ) : (
        <div className="flex h-full items-center justify-center rounded-md text-sm text-muted-foreground ring-1 ring-border">
          {viewer.error ?? "Načítavam náhľad viewera…"}
        </div>
      )}

      {siblingLoading && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-background/80 px-3 py-1 text-xs text-muted-foreground shadow backdrop-blur-sm">
          Načítavam priestorový kontext…
        </div>
      )}

      {captureSpaceId && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Reality Capture"
          onClick={closeCaptures}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-card text-card-foreground shadow-xl ring-1 ring-foreground/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="font-heading text-base font-semibold">Reality Capture</h2>
              <Button variant="ghost" size="icon-sm" onClick={closeCaptures} aria-label="Zavrieť">
                <X />
              </Button>
            </div>
            <div className="overflow-y-auto p-4">
              <CaptureGallery
                key={captureSpaceId}
                spaceId={captureSpaceId}
                spaceName={null}
                initialCaptures={[]}
                canUpload={false}
                autoLoad
              />
            </div>
          </div>
        </div>
      )}
      </div>

      {/* Spodná stavová lišta hostu pod viewerom: výber viewera (D-116) a indikátor Live (D-079). */}
      <div className="flex h-7 shrink-0 items-center gap-1 border-t bg-background px-2" data-host-statusbar>
        <ViewerPicker choice={viewer.choice} error={viewer.viewerUrl ? viewer.error : null} onChoose={viewer.setChoice} />
        <div id={LIVE_SLOT_ID} className="flex items-center" />
      </div>
    </div>
  );
}
