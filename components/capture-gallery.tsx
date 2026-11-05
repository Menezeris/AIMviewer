"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Camera, ImageIcon, MapPin, Orbit, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CaptureUploadDialog } from "@/components/capture-upload-dialog";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { CaptureMediaWire, CapturePointWire } from "@/lib/data/captures";

// PSV is purely client-side (three.js) - dynamic import without SSR, loaded only when
// a panorama is opened (does not burden the bundle of the node detail).
const PanoramaViewer = dynamic(
  () => import("@/components/panorama-viewer").then((m) => m.PanoramaViewer),
  { ssr: false }
);

/**
 * Gallery of Reality Capture images of a space (D-073, F1/F4). Shows capture points
 * (current version as a thumbnail), versions over time (F4) and opens a photo in a lightbox
 * or a 360° panorama in the immersive viewer. Upload via `CaptureUploadDialog`.
 */
export function CaptureGallery({
  spaceId,
  spaceName,
  initialCaptures,
  canUpload,
  planDocumentId,
  autoLoad = false,
}: {
  spaceId: string;
  spaceName: string | null;
  initialCaptures: CapturePointWire[];
  canUpload: boolean;
  /** Floor plan of the space's storey - the target of "place on the plan" (D-073). */
  planDocumentId?: string | null;
  /** Fetch the images on mount (for an overlay without server-preloaded data, D-073). */
  autoLoad?: boolean;
}) {
  const router = useRouter();
  const [captures, setCaptures] = useState<CapturePointWire[]>(initialCaptures);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [active, setActive] = useState<{ point: CapturePointWire; mediaIdx: number } | null>(null);

  useEffect(() => setCaptures(initialCaptures), [initialCaptures]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/captures?space=${spaceId}`, { cache: "no-store" });
      if (res.ok) {
        const { captures: fresh } = (await res.json()) as { captures: CapturePointWire[] };
        setCaptures(fresh);
      }
    } catch {
      /* ignore */
    }
  }, [spaceId]);

  // The overlay (autoLoad) has no server-preloaded captures - fetch them on mount.
  useEffect(() => {
    if (autoLoad) void load();
  }, [autoLoad, load]);

  const refetch = useCallback(async () => {
    await load();
    router.refresh();
  }, [load, router]);

  const activeMedia: CaptureMediaWire | null = active
    ? active.point.media[active.mediaIdx] ?? null
    : null;

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {captures.length === 0
            ? "Zatiaľ žiadne snímky."
            : `${captures.length} ${captures.length === 1 ? "capture bod" : "capture bodov"}`}
        </p>
        {canUpload && (
          <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
            <Plus /> Pridať snímku
          </Button>
        )}
      </div>

      {captures.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {captures.map((point) => {
            const current = point.media[0] ?? null;
            const thumb = current?.thumbLocation ?? current?.previewLocation ?? current?.location;
            return (
              <li key={point.id} className="relative">
                {canUpload && planDocumentId && (
                  <button
                    type="button"
                    title={
                      point.placement?.plan
                        ? "Zmeniť pozíciu na pláne"
                        : "Umiestniť na pláne"
                    }
                    onClick={() =>
                      router.push(`/drawing/${planDocumentId}?placeCapture=${point.id}`)
                    }
                    className={cn(
                      "absolute top-1.5 right-1.5 z-10 flex size-6 items-center justify-center rounded-full border border-white/70 text-white shadow transition-colors",
                      point.placement?.plan ? "bg-sky-500 hover:bg-sky-600" : "bg-black/50 hover:bg-black/70"
                    )}
                  >
                    <MapPin className="size-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => current && setActive({ point, mediaIdx: 0 })}
                  disabled={!current}
                  className="group/capture relative block aspect-square w-full overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10 disabled:opacity-60"
                  title={point.name ?? undefined}
                >
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb}
                      alt={point.name ?? "snímka"}
                      className="size-full object-cover transition-transform group-hover/capture:scale-105"
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center text-muted-foreground">
                      <ImageIcon className="size-6" />
                    </span>
                  )}
                  <span className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[0.65rem] font-medium text-white">
                    {point.kind === "pano360" ? <Orbit className="size-3" /> : <Camera className="size-3" />}
                    {point.kind === "pano360" ? "360°" : "Foto"}
                  </span>
                  {point.media.length > 1 && (
                    <span className="absolute right-1.5 bottom-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[0.65rem] font-medium text-white">
                      {point.media.length} verzií
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Lightbox (photo) / immersive 360° viewer */}
      {active && activeMedia && active.point.kind === "pano360" && (
        <PanoramaViewer
          open
          onClose={() => setActive(null)}
          src={activeMedia.location ?? ""}
          preview={activeMedia.previewLocation}
          yaw={active.point.placement?.yaw ?? 0}
          title={active.point.name}
        />
      )}
      {active && activeMedia && active.point.kind !== "pano360" && (
        <PhotoLightbox
          point={active.point}
          mediaIdx={active.mediaIdx}
          onSelectVersion={(i) => setActive({ point: active.point, mediaIdx: i })}
          onClose={() => setActive(null)}
        />
      )}

      <CaptureUploadDialog
        spaceId={spaceId}
        spaceName={spaceName}
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={refetch}
      />
    </>
  );
}

/** Full-window photo + version switcher over time (F4). */
function PhotoLightbox({
  point,
  mediaIdx,
  onSelectVersion,
  onClose,
}: {
  point: CapturePointWire;
  mediaIdx: number;
  onSelectVersion: (i: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const media = point.media[mediaIdx];
  const url = media?.previewLocation ?? media?.location;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <Button
        variant="secondary"
        size="icon-sm"
        onClick={onClose}
        aria-label="Zavrieť"
        className="absolute top-3 right-3"
      >
        <X />
      </Button>
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={point.name ?? "snímka"}
          className="max-h-[80vh] max-w-full rounded-lg object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <div className="mt-3 text-center text-sm text-white/80" onClick={(e) => e.stopPropagation()}>
        {point.name && <p className="font-medium">{point.name}</p>}
        {media?.capturedAt && <p className="text-xs text-white/60">{formatDate(media.capturedAt)}</p>}
      </div>

      {point.media.length > 1 && (
        <div
          className="mt-3 flex max-w-full gap-2 overflow-x-auto pb-1"
          onClick={(e) => e.stopPropagation()}
        >
          {point.media.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelectVersion(i)}
              className={cn(
                "relative size-14 shrink-0 overflow-hidden rounded ring-2",
                i === mediaIdx ? "ring-primary" : "ring-transparent opacity-70 hover:opacity-100"
              )}
              title={formatDate(m.capturedAt) ?? undefined}
            >
              {(m.thumbLocation ?? m.previewLocation ?? m.location) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={m.thumbLocation ?? m.previewLocation ?? m.location ?? ""}
                  alt=""
                  className="size-full object-cover"
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
