"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type { DrawingRegion, SelectedElement } from "@/lib/data/drawing";
import { CapturePlanOverlay } from "@/components/capture-plan-overlay";

// Worker self-hosted from our own origin (D-030 perf, addendum): the bundler resolves it from
// the installed `pdfjs-dist` (version automatically matching the API -> no version
// mismatch) and emits it as a hashed static asset. Eliminates the external fetch to
// unpkg, which on every drawing open added DNS+TLS+a download of ~1 MB before
// the PDF parsing itself (and could hang/be rate-limited).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// Lazy loading of large PDFs (D-054 cadence 3): pdf.js pulls via HTTP Range requests
// only the xref/page tree + objects of the currently rendered page instead of the whole file -
// the first page of a large multi-page PDF is visible and clickable after a few 100 kB.
// If the server does not support Range, pdf.js automatically falls back to the full download (today's
// behavior). Supabase Storage supports Range. The object is a module constant - react-pdf
// reloads the whole document on a new `options` reference.
const DOCUMENT_OPTIONS = {
  disableAutoFetch: true, // do not prefetch the rest of the file in the background
  disableStream: true, // forces the range transport (otherwise it streams the whole response)
  rangeChunkSize: 262144, // 256 KB - fewer roundtrips on drawings with large streams
};

const PAD = 16; // px inner padding of the canvas (`p-4`) - enters the zoom anchoring
const ZOOM_STEP = 0.25; // step of the +/- buttons
const ZOOM_MIN = 0.5; // 1 = "fit to width" of the viewport
const ZOOM_MAX = 8;
const FALLBACK_FIT_WIDTH = 800; // until the viewport is measured (SSR-less mount)
// On entry with `focus` zoom in so that a small code is readable and the highlight visible.
const FOCUS_ZOOM = 2.5;
// Cap of the rendered raster (px of width). A higher `devicePixelRatio` = sharper thin
// lines/text; the cap protects against giant canvases at high zoom (browser limit).
const MAX_RENDER_PX = 6000;
const PAN_THRESHOLD = 6; // px of movement from which the gesture is a pan (not a click on a region)
const DOUBLE_TAP_MS = 300; // max gap between two taps (touch)
const DOUBLE_TAP_RADIUS = 40; // px tolerance of the position of the second tap
const DOUBLE_TAP_ZOOM = 2.5; // target of a double-tap from fit width (~ FOCUS_ZOOM readability)
const GESTURE_COMMIT_MS = 180; // wheel settling -> sharp re-raster

type Dims = { width: number; height: number };
type Point = { x: number; y: number };

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clampZoom(z: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/**
 * In-app drawing viewer (D-042 C+D, rework D-054): render of the source PDF
 * (react-pdf / pdf.js) + an overlay of transparent clickable boxes from `_drawing_links`.
 *
 * Controls (D-054): **mouse wheel = zoom** targeted at the cursor (zoom-to-pointer);
 * **drag = pan**; on touch **pinch = zoom, finger = pan, double-tap =
 * zoom in/fit**; the **fullscreen** button stretches the drawing to the whole screen
 * (readability on a large monitor). Default zoom = **fit-to-width** of the viewport
 * (mobile-first).
 *
 * Performance + sharpness (D-054 cadence 2): during a running gesture (wheel/pinch) the page
 * is NOT re-rastered - it is scaled by a cheap CSS transform around the gesture anchor; the sharp **re-raster**
 * (not CSS-scale, up to `devicePixelRatio` 2x, cap `MAX_RENDER_PX`) comes once, after
 * the gesture settles. Large drawings are thus not choked by pinch/wheel rasterizing per frame.
 *
 * Click-throughs stay (D-042 D): a click on a box **does not jump** to a new page - it selects
 * the element (`onSelect`), detail in the side panel; Ctrl/Cmd-click opens the detail in a new tab;
 * assemblies (D-043) navigate to the Listing. A pan gesture suppresses the click (`didPan` threshold).
 *
 * Bidirectionality (D): `focus` = `objects.id` -> jump to the page, zoom in, scroll to the box
 * and a short pulse. `selectedId` (controlled from outside) determines the permanently highlighted element.
 */
export function DrawingViewer({
  url,
  links,
  focus,
  initialPage,
  selectedId,
  onSelect,
}: {
  url: string;
  links: DrawingRegion[];
  focus?: string;
  initialPage?: number;
  selectedId?: string | null;
  onSelect?: (sel: SelectedElement) => void;
}) {
  const focusRegion = useMemo(
    () => (focus ? links.find((l) => l.targetId === focus) : undefined),
    [focus, links]
  );

  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(() => focusRegion?.page ?? initialPage ?? 1);
  const [zoom, setZoom] = useState(() => (focusRegion ? FOCUS_ZOOM : 1));
  const [fitWidth, setFitWidth] = useState(FALLBACK_FIT_WIDTH);
  const [dims, setDims] = useState<Dims | null>(null);
  const [pulsing, setPulsing] = useState(Boolean(focusRegion));
  const [isFullscreen, setIsFullscreen] = useState(false);
  // % downloaded during the initial document load (null = unknown total).
  const [loadPct, setLoadPct] = useState<number | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const focusBoxRef = useRef<HTMLAnchorElement | null>(null);
  const focusedOnce = useRef(false);

  // Live zoom/fit in a ref for the native (non-passive) wheel/pointer listeners and rAF -
  // synchronized in an effect (a ref must not be written during render).
  const zoomRef = useRef(zoom);
  const fitWidthRef = useRef(fitWidth);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    fitWidthRef.current = fitWidth;
  }, [fitWidth]);

  // Gestures: active pointers, start of pan/pinch, "I was just panning" (suppresses the click),
  // deferred zoom anchor (applied after the re-raster in a layout effect).
  const pointers = useRef<Map<number, Point>>(new Map());
  const panStart = useRef<{ x: number; y: number; left: number; top: number } | null>(
    null
  );
  const pinchStart = useRef<{ d: number; zoom: number } | null>(null);
  const didPan = useRef(false);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const pendingAnchor = useRef<{ fx: number; fy: number; cx: number; cy: number } | null>(
    null
  );
  // A running zoom gesture: target zoom + anchor (px/py in the untransformed local
  // coordinates of the wrapper, base = rect at the gesture start) + finger translation (tx/ty,
  // a pinch dragged across the screen follows the fingers). While the gesture runs, only the CSS
  // transform changes - the re-raster (setZoom) comes only at commit.
  const preview = useRef<{
    target: number;
    px: number;
    py: number;
    tx: number;
    ty: number;
    base: DOMRect;
  } | null>(null);
  const commitTimer = useRef<number | null>(null);

  const width = Math.round(fitWidth * zoom);
  const devicePixelRatio = Math.min(2, MAX_RENDER_PX / width);
  const pageLinks = useMemo(
    () => links.filter((l) => l.page === page),
    [links, page]
  );

  // "Fit" width = viewport width minus padding; tracks resize and fullscreen switching.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth - PAD * 2;
      if (w > 0) setFitWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * The only place that changes zoom: clamp + no-op guard + deferred anchor (applied by the
   * layout effect after re-rastering). The anchor is shared by zoomTo (live rect) and commitPreview
   * (frozen gesture geometry) - the logic must not fork. Returns whether the zoom changes
   * (without a visible width change the anchor is not set - otherwise it would be left hanging).
   */
  const applyZoom = useCallback(
    (
      next: number,
      anchor: { fx: number; fy: number; cx: number; cy: number } | null
    ): boolean => {
      const clamped = clampZoom(next);
      if (
        Math.round(fitWidthRef.current * clamped) ===
        Math.round(fitWidthRef.current * zoomRef.current)
      ) {
        return false;
      }
      if (anchor) pendingAnchor.current = anchor;
      setZoom(clamped);
      return true;
    },
    []
  );

  /** Absolute zoom anchored to a point in the viewport (client coordinates) - the point stays under the cursor. */
  const zoomTo = useCallback(
    (next: number, cx: number, cy: number) => {
      const wrap = wrapperRef.current;
      const r = wrap?.getBoundingClientRect();
      const anchor =
        r && r.width > 0 && r.height > 0
          ? { fx: (cx - r.left) / r.width, fy: (cy - r.top) / r.height, cx, cy }
          : null;
      applyZoom(next, anchor);
    },
    [applyZoom]
  );

  /**
   * Cheap zoom preview during a gesture: CSS scale of the wrapper around the anchor (the point under the cursor /
   * the pinch center stays in place), no re-raster. The anchor is frozen at the gesture start;
   * `follow=true` (pinch) additionally tracks the finger movement by translation - a pinch
   * dragged across the screen does zoom and pan at once. The wheel does not track the anchor (cursor movement != pan).
   */
  const previewZoom = useCallback(
    (target: number, cx: number, cy: number, follow = false) => {
      const wrap = wrapperRef.current;
      if (!wrap) return;
      const t = clampZoom(target);
      if (!preview.current) {
        // First event of the gesture - the wrapper has no transform, rect = untransformed geometry.
        const base = wrap.getBoundingClientRect();
        if (base.width <= 0 || base.height <= 0) return;
        preview.current = { target: t, px: cx - base.left, py: cy - base.top, tx: 0, ty: 0, base };
      } else {
        preview.current.target = t;
        if (follow) {
          preview.current.tx = cx - (preview.current.base.left + preview.current.px);
          preview.current.ty = cy - (preview.current.base.top + preview.current.py);
        }
      }
      const p = preview.current;
      const s = t / zoomRef.current;
      wrap.style.transformOrigin = "0 0";
      wrap.style.transform = `translate(${(1 - s) * p.px + p.tx}px, ${(1 - s) * p.py + p.ty}px) scale(${s})`;
    },
    []
  );

  /** Drop a running preview and the deferred anchor (without re-raster) - e.g. on a page change. */
  const cancelPreview = useCallback(() => {
    if (commitTimer.current != null) {
      window.clearTimeout(commitTimer.current);
      commitTimer.current = null;
    }
    preview.current = null;
    pendingAnchor.current = null;
    const wrap = wrapperRef.current;
    if (wrap) wrap.style.transform = "";
  }, []);

  /** Gesture settling: cancel the CSS preview and re-raster the page at the target zoom (sharp render). */
  const commitPreview = useCallback(() => {
    if (commitTimer.current != null) {
      window.clearTimeout(commitTimer.current);
      commitTimer.current = null;
    }
    const p = preview.current;
    const wrap = wrapperRef.current;
    if (!p) return;
    preview.current = null;
    if (wrap) wrap.style.transform = "";
    // The anchored point of the gesture (shifted by the finger translation) must stay in place after the re-raster.
    const changed = applyZoom(p.target, {
      fx: p.px / p.base.width,
      fy: p.py / p.base.height,
      cx: p.base.left + p.px + p.tx,
      cy: p.base.top + p.py + p.ty,
    });
    // Pure two-finger pan (zoom unchanged): carry the translation into the scroll, otherwise it would snap.
    if (!changed && (p.tx !== 0 || p.ty !== 0)) {
      const c = scrollRef.current;
      if (c) {
        c.scrollLeft -= p.tx;
        c.scrollTop -= p.ty;
      }
    }
  }, [applyZoom]);

  // Cleanup of the deferred commit on unmount.
  useEffect(
    () => () => {
      if (commitTimer.current != null) window.clearTimeout(commitTimer.current);
    },
    []
  );

  // After the re-raster (change of `width`/`dims`) restore the scroll so that the anchored point stays under the cursor.
  // CAUTION: the anchor is applied only when the raster CATCHES UP with the new width (`dims` ~ `width`) - right after
  // setZoom the canvas still has the old CSS width, scrollLeft would be clamped to the old range and the
  // anchor would be dropped (on a larger jump - gesture commit, buttons - it visibly overshoots).
  useLayoutEffect(() => {
    const a = pendingAnchor.current;
    const c = scrollRef.current;
    if (!a || !c || !dims) return;
    if (Math.abs(dims.width - width) > 1) return; // re-raster still running - wait for the new dims
    const cr = c.getBoundingClientRect();
    c.scrollLeft = cr.left + PAD + a.fx * dims.width - a.cx;
    c.scrollTop = cr.top + PAD + a.fy * dims.height - a.cy;
    pendingAnchor.current = null;
  }, [dims, width]);

  // Native wheel listener (non-passive) - otherwise we cannot `preventDefault` the page scroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      const current = preview.current?.target ?? zoomRef.current;
      previewZoom(current * factor, e.clientX, e.clientY);
      // A wheel burst = one gesture; re-raster only after settling.
      if (commitTimer.current != null) window.clearTimeout(commitTimer.current);
      commitTimer.current = window.setTimeout(commitPreview, GESTURE_COMMIT_MS);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [previewZoom, commitPreview]);

  // Fullscreen state (also when the user leaves via Esc / by the system).
  useEffect(() => {
    const onChange = () =>
      setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void rootRef.current?.requestFullscreen?.();
    }
  }

  // Focus change (soft navigation with a different `?focus=`) -> jump to its page and re-target.
  useEffect(() => {
    focusedOnce.current = false;
    if (focusRegion) {
      setPage(focusRegion.page);
      setZoom(FOCUS_ZOOM);
      setPulsing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // After rendering the page with the focus element: scroll to it and pulse briefly (once).
  useEffect(() => {
    if (!focusRegion || !dims || focusRegion.page !== page || focusedOnce.current) {
      return;
    }
    focusBoxRef.current?.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "smooth",
    });
    focusedOnce.current = true;
    const t = setTimeout(() => setPulsing(false), 2400);
    return () => clearTimeout(t);
  }, [focusRegion, dims, page]);

  function goPage(next: number) {
    if (next < 1 || (numPages && next > numPages)) return;
    // A running zoom preview and the deferred anchor belong to the old page - drop them,
    // otherwise the anchor would be applied to the new page (dims.width matches there too).
    cancelPreview();
    setDims(null); // until the new page is rendered, we do not lay out the boxes
    setPage(next);
  }

  /** Zoom by button - anchor = center of the viewport. */
  function zoomButton(delta: number) {
    const el = scrollRef.current;
    const r = el?.getBoundingClientRect();
    const cx = r ? r.left + r.width / 2 : 0;
    const cy = r ? r.top + r.height / 2 : 0;
    zoomTo(zoom + delta, cx, cy);
  }

  /** Reset to fit-to-width + scroll to the start. */
  function resetZoom() {
    pendingAnchor.current = null;
    setZoom(1);
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) {
        el.scrollLeft = 0;
        el.scrollTop = 0;
      }
    });
  }

  // ---- Pan / pinch via pointer events (touch-action: none on the canvas) ----
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    if (!el) return;
    // End a running wheel preview - pan/pinch needs stable geometry.
    commitPreview();
    // CAUTION: mouse/pen is NOT captured right away - capture redirects pointerup to the scroller,
    // so the click event would bypass the `<a>` region (a mouse click on a code would be dead);
    // capture comes only when the gesture really starts (pan threshold / pinch, below).
    // Touch, on the other hand, is captured right away: the synthesized click from a tap targets the touchstart
    // target even with capture (verified live) and capture guarantees that pointerup/cancel
    // always reaches endPointer - without it a finger released outside the scroller would leave
    // a stale record in `pointers` and the next tap would look like a pinch.
    if (e.pointerType === "touch") el.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      didPan.current = false;
      panStart.current = {
        x: e.clientX,
        y: e.clientY,
        left: el.scrollLeft,
        top: el.scrollTop,
      };
    } else if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      pinchStart.current = { d: dist(p1, p2), zoom: zoomRef.current };
      panStart.current = null;
      didPan.current = true; // a pinch is never a click
      for (const id of pointers.current.keys()) el.setPointerCapture(id);
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const el = scrollRef.current;
    if (!el) return;

    if (pointers.current.size >= 2 && pinchStart.current) {
      const [p1, p2] = [...pointers.current.values()];
      const d = dist(p1, p2);
      if (pinchStart.current.d > 0) {
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        // During a pinch only the CSS preview - the re-raster comes when the fingers are released.
        // `follow` = the pinch center drags the content along (zoom + pan in one gesture).
        previewZoom(
          (pinchStart.current.zoom * d) / pinchStart.current.d,
          mid.x,
          mid.y,
          true
        );
      }
      return;
    }

    if (panStart.current) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      if (!didPan.current && Math.abs(dx) + Math.abs(dy) > PAN_THRESHOLD) {
        didPan.current = true;
        // The gesture is a pan -> from now on hold the pointer even outside the scroller (a click is no longer a risk).
        el.setPointerCapture(e.pointerId);
        // A pending zoom anchor would overwrite the scroll after re-rastering and cancel
        // the user's movement - pan takes precedence, drop the anchor.
        pendingAnchor.current = null;
      }
      el.scrollLeft = panStart.current.left - dx;
      el.scrollTop = panStart.current.top - dy;
    }
  }

  function endPointer(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2 && pinchStart.current) {
      // End of the pinch -> sharp re-raster at the target zoom.
      pinchStart.current = null;
      commitPreview();
    }
    const el = scrollRef.current;
    if (pointers.current.size === 1 && el) {
      // Transition from a pinch back to a pan with the remaining finger.
      const p = [...pointers.current.values()][0];
      panStart.current = { x: p.x, y: p.y, left: el.scrollLeft, top: el.scrollTop };
    } else if (pointers.current.size === 0) {
      panStart.current = null;
      // Double-tap (touch): zoom in to the tap location; from the zoomed state back to fit.
      // Only a real pointerup - a cancelled pointer (pointercancel: palm rejection,
      // the OS taking over the gesture) is not a tap and must not feed the double-tap detection.
      if (e.type === "pointerup" && e.pointerType === "touch" && !didPan.current) {
        const now = performance.now();
        const prev = lastTap.current;
        lastTap.current = { t: now, x: e.clientX, y: e.clientY };
        if (
          prev &&
          now - prev.t < DOUBLE_TAP_MS &&
          dist(prev, { x: e.clientX, y: e.clientY }) < DOUBLE_TAP_RADIUS
        ) {
          lastTap.current = null;
          didPan.current = true; // the second tap is not a click on a region
          if (zoomRef.current > 1.01) resetZoom();
          else zoomTo(DOUBLE_TAP_ZOOM, e.clientX, e.clientY);
        }
      }
    }
  }

  // A pan gesture suppresses the following click on a region (capture phase before `onSelect`/navigation).
  function onClickCapture(e: React.MouseEvent<HTMLDivElement>) {
    if (didPan.current) {
      e.preventDefault();
      e.stopPropagation();
      didPan.current = false;
    }
  }

  // Selecting an element leaves fullscreen: the side panel/bottom-sheet lives OUTSIDE the fullscreen
  // element (rootRef), so in top-layer mode it would not be visible - a click on a code would
  // look like it did nothing. Outside fullscreen it is a no-op.
  const handleSelect = useMemo(() => {
    if (!onSelect) return undefined;
    return (sel: SelectedElement) => {
      if (document.fullscreenElement) void document.exitFullscreen();
      onSelect(sel);
    };
  }, [onSelect]);

  return (
    <div
      ref={rootRef}
      className={
        isFullscreen
          ? "flex h-screen flex-col gap-3 bg-background p-3"
          : "space-y-3"
      }
    >
      {/* Toolbar: pagination + zoom + fullscreen */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-md ring-1 ring-border">
          <button
            type="button"
            onClick={() => goPage(page - 1)}
            disabled={page <= 1}
            className="inline-flex size-8 items-center justify-center rounded-l-md hover:bg-secondary disabled:opacity-40"
            aria-label="Predchádzajúca strana"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-16 text-center text-sm tabular-nums">
            {page} / {numPages || "…"}
          </span>
          <button
            type="button"
            onClick={() => goPage(page + 1)}
            disabled={!!numPages && page >= numPages}
            className="inline-flex size-8 items-center justify-center rounded-r-md hover:bg-secondary disabled:opacity-40"
            aria-label="Ďalšia strana"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div className="inline-flex items-center gap-1 rounded-md ring-1 ring-border">
          <button
            type="button"
            onClick={() => zoomButton(-ZOOM_STEP)}
            disabled={zoom <= ZOOM_MIN}
            className="inline-flex size-8 items-center justify-center rounded-l-md hover:bg-secondary disabled:opacity-40"
            aria-label="Oddialiť"
          >
            <ZoomOut className="size-4" />
          </button>
          <button
            type="button"
            onClick={resetZoom}
            className="min-w-12 text-center text-sm tabular-nums hover:bg-secondary"
            title="Prispôsobiť šírke"
            aria-label="Prispôsobiť šírke"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => zoomButton(ZOOM_STEP)}
            disabled={zoom >= ZOOM_MAX}
            className="inline-flex size-8 items-center justify-center rounded-r-md hover:bg-secondary disabled:opacity-40"
            aria-label="Priblížiť"
          >
            <ZoomIn className="size-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={toggleFullscreen}
          className="inline-flex size-8 items-center justify-center rounded-md ring-1 ring-border hover:bg-secondary"
          title={isFullscreen ? "Zavrieť celú obrazovku" : "Celá obrazovka"}
          aria-label={isFullscreen ? "Zavrieť celú obrazovku" : "Celá obrazovka"}
        >
          {isFullscreen ? (
            <Minimize2 className="size-4" />
          ) : (
            <Maximize2 className="size-4" />
          )}
        </button>

        {links.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {pageLinks.length} klikateľných prvkov na strane
          </span>
        )}
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
          koliesko = zoom · ťahaj = posun
        </span>
      </div>

      {/* Drawing canvas + overlay - own pan/zoom (touch-action: none). */}
      <div
        ref={scrollRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onClickCapture={onClickCapture}
        style={{ touchAction: "none" }}
        className={`overflow-auto rounded-md ring-1 ring-border bg-muted/30 p-4 ${
          isFullscreen ? "min-h-0 flex-1 cursor-grab" : "max-h-[78vh] cursor-grab"
        }`}
      >
        <Document
          file={url}
          options={DOCUMENT_OPTIONS}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          onLoadProgress={({ loaded, total }) => {
            if (total > 0) setLoadPct(Math.min(100, Math.round((loaded / total) * 100)));
          }}
          loading={
            <div className="p-8 text-sm text-muted-foreground">
              Načítavam výkres…{loadPct != null && loadPct < 100 ? ` ${loadPct} %` : ""}
            </div>
          }
          error={
            <div className="p-8 text-sm text-destructive">
              Výkres sa nepodarilo načítať.
            </div>
          }
          className="inline-block"
        >
          <div ref={wrapperRef} className="relative inline-block select-none leading-none">
            <Page
              pageNumber={page}
              width={width}
              devicePixelRatio={devicePixelRatio}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              onRenderSuccess={(p) => setDims({ width: p.width, height: p.height })}
              loading={
                <div
                  className="bg-background"
                  style={{ width, height: width * 0.66 }}
                />
              }
            />
            {dims && (
              <div className="absolute inset-0">
                {pageLinks.map((r, i) => {
                  const isSelected = !!selectedId && r.targetId === selectedId;
                  const isFocus =
                    !!focusRegion && r.targetId === focusRegion.targetId;
                  return (
                    <RegionBox
                      key={`${r.targetId}-${i}`}
                      region={r}
                      dims={dims}
                      selected={isSelected}
                      pulsing={isFocus && pulsing}
                      boxRef={isFocus ? focusBoxRef : undefined}
                      onSelect={handleSelect}
                    />
                  );
                })}
                {/* Reality Capture pins on the plan (D-073) - reading + authoring (?placeCapture). */}
                <CapturePlanOverlay page={page} dims={dims} />
              </div>
            )}
          </div>
        </Document>
      </div>
    </div>
  );
}

/** A single clickable box overlaid above a code in the drawing. */
function RegionBox({
  region,
  dims,
  selected,
  pulsing,
  boxRef,
  onSelect,
}: {
  region: DrawingRegion;
  dims: Dims;
  selected: boolean;
  pulsing: boolean;
  boxRef?: React.Ref<HTMLAnchorElement>;
  onSelect?: (sel: SelectedElement) => void;
}) {
  const [wpt, hpt] = region.pageSize;
  const [x0, y0, x1, y1] = region.bbox;
  const sx = dims.width / wpt;
  const sy = dims.height / hpt;

  // PDF bottom-left -> CSS top-left (y-flip): top edge = height - y1.
  const style: React.CSSProperties = {
    left: x0 * sx,
    top: (hpt - y1) * sy,
    width: (x1 - x0) * sx,
    height: (y1 - y0) * sy,
  };

  // Assembly (D-043): the region leads to another document (the assembly listing) to the given page -
  // not to the element detail. Click = normal navigation (no `onSelect`/side panel).
  const isSkladba = region.targetRoute === "drawing";
  const href = isSkladba
    ? `/drawing/${region.targetId}?page=${region.targetPage ?? 1}`
    : `/${region.targetRoute}/${region.targetId}`;

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    // Assembly -> let the link navigate. Ctrl/Cmd/shift-click = open the detail in a new tab.
    if (isSkladba || !onSelect || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    onSelect({
      id: region.targetId,
      route: region.targetRoute as "node" | "type",
      label: region.label,
    });
  }

  // Assemblies are visually distinguished (amber) from the element codes (primary color).
  const className = isSkladba
    ? "absolute rounded-sm bg-amber-400/15 ring-1 ring-amber-500/50 transition-colors hover:bg-amber-400/30 hover:ring-amber-500"
    : selected
      ? `absolute rounded-sm bg-primary/30 ring-2 ring-primary ring-offset-1 ring-offset-background ${
          pulsing ? "animate-pulse" : ""
        }`
      : "absolute rounded-sm bg-primary/10 ring-1 ring-primary/40 transition-colors hover:bg-primary/25 hover:ring-primary";

  const title = isSkladba
    ? `Skladba ${region.label} — otvoriť vo Výpise skladieb`
    : `${region.label}${selected ? " (vybraný)" : ""} — zobraziť detail`;

  return (
    <a
      ref={boxRef}
      href={href}
      onClick={handleClick}
      draggable={false}
      title={title}
      style={style}
      className={className}
    />
  );
}
