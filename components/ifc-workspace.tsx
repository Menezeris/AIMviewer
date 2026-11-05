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

// The 3D viewer is an embedded ifc-lite viewer via iframe (postMessage bridge),
// not in-process three.js. Same Props + ViewerApi, so the workspace is unchanged.
// The variant with support for the AI dock viewer ops is used (D-066).
const IFCViewer = dynamic(
  () => import("@/components/ifc-viewer").then((m) => m.IFCViewer),
  {
    ssr: false,
    loading: () => (
      <LoadingLogo label="Načítavam 3D prehliadač" />
    ),
  }
);

/**
 * Full-page 3D workspace: the viewer fills the whole area. The detail of the selected
 * element is shown as an AIM card directly in the native panel of the embed viewer (the host
 * sends it DB data via the bridge, see ifc-viewer.tsx + lib/aim-panel.ts) - no
 * second floating panel. The IFC-type FilterBar was removed - filtering runs
 * via the AI dock and the native tools of the embed viewer.
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
  projectCode,
}: {
  /** Project code (D-189), for the BCF project of the viewer. */
  projectCode?: string;
  models: IfcModel[];
  guidMap: GuidMap;
  focus?: string;
  /** AI dock action nonce - a new value forces re-applying focus/ops (D-056). */
  focusNonce?: string;
  /** AI dock viewer operations (coloring/hiding/isolation, D-066). */
  ops?: string;
  /** Georeferenced PDF underlays for the embed viewer (D-072). */
  underlays?: UnderlayDrawingWire[];
  /** Document library for the in-viewer Documents panel (D-075). */
  documents?: DocumentWire[];
  /** Deep link (D-075): the document to open as a tab (`?doc=`). */
  openDocumentId?: string;
  /** Reality Capture pins with 3D anchoring (D-073). */
  captures?: CaptureViewerWire[];
  /** AIM tree decorations (D-077) - per-GUID badge counts for the embed viewer. */
  decorations?: TreeDecorations;
  /** AIM layer above the models (D-089): register of derivation rules and model revisions. */
  derivations?: DerivationsLayerWire | null;
  /** Floor plan labels as links to an element (D-130, AIM layer). */
  documentLinks?: DocumentLinksWire[] | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewerApiRef = useRef<ViewerApi | null>(null);
  const [siblingLoading, setSiblingLoading] = useState(false);
  // Embedded viewer (D-116): production or a PR fork preview chosen above the 3D.
  const viewer = useViewerChoice();

  // Reality Capture (D-073): the AIM card in 3D links to /ifc?captures=<spaceId>
  // (soft-nav, the iframe is not remounted) -> space gallery as an overlay above the 3D.
  const captureSpaceId = searchParams.get("captures");
  function closeCaptures() {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("captures");
    router.replace(sp.toString() ? `/ifc?${sp}` : "/ifc");
  }

  // 3D -> DB: after a pick, fetch the siblings in the space and highlight them.
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
      // Called fire-and-forget from the bridge handler - without a catch a network
      // error would end as an unhandled rejection. Highlighting is best-effort.
      console.error("space-siblings fetch failed", err);
    } finally {
      setSiblingLoading(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col">
      {/* Non-production environment (D-159): PR viewer preview and test channel (strip from LiveChannel). */}
      <div id={LIVE_ENV_SLOT_ID} className="shrink-0" data-host-envbar>
        {viewer.choice.kind !== "prod" && (
          <div className="bg-amber-100 px-3 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Náhľad viewera {viewerChoiceLabel(viewer.choice)}: nie je to produkčný viewer
          </div>
        )}
      </div>
      {/* Viewer with its own status bar; host overlays do not cover it (#185). */}
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
          projectCode={projectCode}
          apiRef={viewerApiRef}
          onPickedElement={handlePickedElement}
          onNavigate={(href) => router.push(href)}
          onCaptureClick={(captureId) => {
            // 3D -> host: click on a capture pin -> open the space with the images (gallery
            // on /node/[space]). Bidirectionality "image <-> space" (D-073).
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

      {/* Bottom host status bar below the viewer: viewer choice (D-116) and the Live indicator (D-079). */}
      <div className="flex h-7 shrink-0 items-center gap-1 border-t bg-background px-2" data-host-statusbar>
        <ViewerPicker choice={viewer.choice} error={viewer.viewerUrl ? viewer.error : null} onChoose={viewer.setChoice} />
        <div id={LIVE_SLOT_ID} className="flex items-center" />
      </div>
    </div>
  );
}
