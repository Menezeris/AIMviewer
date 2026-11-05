/**
 * Reality Capture (D-073) - pure types + anchoring validation (`_capture`).
 *
 * Deliberately WITHOUT `server-only`/DB dependencies so that the validation is unit-testable
 * (pattern: pure logic next to the server-only data-access layer). `captures.ts` re-exports
 * from this module; client components import only the types.
 */

/** Public Storage bucket for the images (pattern `documents`/`ifc`). */
export const CAPTURES_BUCKET = "captures";

/** Kind of capture point - a regular photo vs a static equirectangular panorama. */
export type CaptureKind = "photo" | "pano360";

/** 2D pin on a specific PDF sheet (normalized coordinates 0..1). */
export interface CapturePlanAnchor {
  documentId: string;
  page: number;
  /** Normalized X (0 = left edge, 1 = right). */
  u: number;
  /** Normalized Y (0 = top edge, 1 = bottom). */
  v: number;
}

/** 3D pin in the viewer Y-up world frame (meters). */
export interface CaptureWorldAnchor {
  x: number;
  y: number;
  z: number;
}

/**
 * Anchoring of a capture point - versioned JSON in `properties._capture` (pattern `_georef`).
 * Both `plan` and `world` are optional; `yaw` is the initial view orientation for a
 * panorama (radians). The semantic anchoring (to a space) lives on the edge, not here.
 */
export interface CapturePlacement {
  version: 1;
  plan?: CapturePlanAnchor;
  world?: CaptureWorldAnchor;
  yaw?: number;
}

/** Wire shape of one image/version. */
export interface CaptureMediaWire {
  id: string;
  location: string | null;
  previewLocation: string | null;
  thumbLocation: string | null;
  mediaType: string | null;
  width: number | null;
  height: number | null;
  capturedAt: string | null;
  /** Derived: the latest active version of the capture point. */
  isCurrent: boolean;
}

/**
 * Wire shape of a capture pin for the embed 3D viewer (D-073, bridge `CAPTURES_LOAD`).
 * `world` is the viewer Y-up world position; `spaceId` is host-only (navigation after a
 * click on the pin - it is NOT sent to the viewer).
 */
export interface CaptureViewerWire {
  id: string;
  kind: CaptureKind;
  world: CaptureWorldAnchor;
  name?: string;
  thumbUrl?: string;
  /** Host-only: the space to navigate to after a click. */
  spaceId: string | null;
}

/**
 * Wire shape of a capture pin on the 2D plan (D-073) - for the overlay in the drawing viewer.
 * `page`/`u`/`v` come from `_capture.plan` (normalized, v = 0 top ... 1 bottom).
 */
export interface CapturePlanPinWire {
  id: string;
  kind: CaptureKind;
  name?: string;
  spaceId: string | null;
  thumbUrl?: string;
  /** Thumbnail of the current image - for opening the photo/360 directly from the pin. */
  previewUrl?: string;
  /** Original of the current image (HD / equirect for 360). */
  origUrl?: string;
  /** View orientation for 360 (radians). */
  yaw?: number;
  page: number;
  u: number;
  v: number;
}

/** Reality Capture summary for the selected object (AIM card in 3D, D-073). */
export interface CaptureSummary {
  /** `objects.id` of the object's space (IfcSpace), or null if it cannot be determined. */
  spaceId: string | null;
  spaceName: string | null;
  /** Number of capture points linked to the space. */
  count: number;
}

/** Wire shape of a capture point including its (active) media. */
export interface CapturePointWire {
  id: string;
  name: string | null;
  kind: CaptureKind;
  /** `objects.id` of the space (IfcSpace) the capture is linked to. */
  spaceId: string | null;
  placement: CapturePlacement | null;
  /** Active versions, sorted from the newest (`captured_at` desc). */
  media: CaptureMediaWire[];
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Validation of the `_capture` v1 payload (the server is the write boundary - untrusted input).
 * Mirrors `isValidGeorefV1` (D-072): strict types, `plan`/`world`/`yaw` optional.
 * An empty `{version:1}` is valid - the semantic anchoring (to a space) lives on the
 * edge; the plan/3D pin can be added later in the viewer (F2).
 */
export function isValidCaptureV1(raw: unknown): raw is CapturePlacement {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const g = raw as Record<string, unknown>;
  if (g.version !== 1) return false;

  if (g.plan !== undefined) {
    const p = g.plan as Record<string, unknown> | null;
    if (!p || typeof p !== "object") return false;
    if (typeof p.documentId !== "string" || p.documentId.length === 0) return false;
    if (!num(p.page) || !Number.isInteger(p.page) || (p.page as number) < 1) return false;
    if (!num(p.u) || (p.u as number) < 0 || (p.u as number) > 1) return false;
    if (!num(p.v) || (p.v as number) < 0 || (p.v as number) > 1) return false;
  }
  if (g.world !== undefined) {
    const w = g.world as Record<string, unknown> | null;
    if (!w || typeof w !== "object") return false;
    if (!num(w.x) || !num(w.y) || !num(w.z)) return false;
  }
  if (g.yaw !== undefined && !num(g.yaw)) return false;
  return true;
}

/** Safe parsing of a persisted `_capture` (stale/hostile -> null). */
export function parseCapturePlacement(raw: unknown): CapturePlacement | null {
  return isValidCaptureV1(raw) ? (raw as CapturePlacement) : null;
}
