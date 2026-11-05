"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ReactPhotoSphereViewer } from "react-photo-sphere-viewer";
import { CompassPlugin } from "@photo-sphere-viewer/compass-plugin";
import "@photo-sphere-viewer/compass-plugin/index.css";
import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Immersive 360° viewer (D-073, F3) - Photo Sphere Viewer (MIT, three.js) via
 * `react-photo-sphere-viewer`, host-side in a Next.js modal. The BIM engine of the fork is
 * WebGPU -> no three.js coexistence collision.
 *
 * Texture strategy: loads `preview` (equirect downscale below the GPU limit, fast
 * loading on mobile too), the "HD" button switches to `orig` (up to 16K on desktop). The module
 * is meant for dynamic import (`ssr:false`) - PSV is purely client-side.
 */

// The PSV Viewer instance has a rich API; for setPanorama this part is enough for us.
type ViewerLike = { setPanorama: (src: string) => Promise<unknown> };

export function PanoramaViewer({
  open,
  onClose,
  src,
  preview,
  yaw = 0,
  title,
}: {
  open: boolean;
  onClose: () => void;
  /** Full resolution of the original. */
  src: string;
  /** Downscaled preview (fast first load); if missing, `src` is used. */
  preview?: string | null;
  /** Initial view orientation (radians). */
  yaw?: number;
  title?: string | null;
}) {
  const viewerRef = useRef<ViewerLike | null>(null);
  const [hd, setHd] = useState(false);
  const [loadingHd, setLoadingHd] = useState(false);

  const initialSrc = preview ?? src;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset the HD state on every open / panorama change.
  useEffect(() => {
    setHd(false);
    setLoadingHd(false);
  }, [open, src]);

  const loadHd = useCallback(async () => {
    if (!viewerRef.current || hd || !preview || preview === src) return;
    setLoadingHd(true);
    try {
      await viewerRef.current.setPanorama(src);
      setHd(true);
    } finally {
      setLoadingHd(false);
    }
  }, [hd, preview, src]);

  if (!open) return null;

  const canLoadHd = !!preview && preview !== src;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-modal="true">
      <div className="absolute top-0 right-0 left-0 z-10 flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent p-3">
        <span className="truncate text-sm font-medium text-white/90">
          {title ?? "360° panoráma"}
        </span>
        <div className="flex items-center gap-2">
          {canLoadHd && !hd && (
            <Button variant="secondary" size="sm" onClick={loadHd} disabled={loadingHd}>
              {loadingHd && <Loader2 className="animate-spin" />}
              HD
            </Button>
          )}
          <Button
            variant="secondary"
            size="icon-sm"
            onClick={onClose}
            aria-label="Zavrieť"
          >
            <X />
          </Button>
        </div>
      </div>

      <ReactPhotoSphereViewer
        key={initialSrc}
        src={initialSrc}
        height="100vh"
        width="100%"
        defaultYaw={yaw}
        navbar={["zoom", "move", "fullscreen"]}
        plugins={[[CompassPlugin, {}]]}
        onReady={(instance) => {
          viewerRef.current = instance as unknown as ViewerLike;
        }}
      />
    </div>
  );
}
