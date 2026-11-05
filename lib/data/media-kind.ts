/**
 * Media kind (D-131): the second axis of document classification next to the information type
 * ISO 19650, and Reality Capture media (D-073) for the Documents panel in the viewer.
 *
 * Pure functions without DB, so that vitest can test them and the client can read them too.
 */
import type { CaptureKind, CapturePointWire } from "./capture-placement";
import type { DocumentType } from "./object-documents-core";

/** Name of the classification system (IfcClassification.Name) of the second axis. */
export const MEDIA_KIND_SYSTEM = "Druh média";

/** Codes of the system `Druh média` (media kind; IfcClassificationReference.Identification) and their names. */
export const MEDIA_KIND_LABEL: Record<string, string> = {
  FOTO: "Fotografia",
  PANO360: "360° panoráma",
  SKEN: "Sken",
};

/** Media in the DB carry the kind on the point (`captures.kind`), not in a column: derivation (D-131 point 2). */
const CAPTURE_KIND_CODE: Record<CaptureKind, string> = { photo: "FOTO", pano360: "PANO360" };

export function captureMediaKind(kind: CaptureKind): DocumentType {
  const code = CAPTURE_KIND_CODE[kind] ?? "FOTO";
  return { code, name: MEDIA_KIND_LABEL[code] };
}

/** Classification reference of a document with the name of its system. */
export interface DocumentClassificationRef {
  documentId: string;
  code: string;
  name: string | null;
  system: string | null;
}

export interface DocumentClassification {
  /** Information type (ISO 19650) or another system outside the media kind. */
  type?: DocumentType;
  /** Media kind (system `Druh média`). */
  mediaKind?: DocumentType;
}

/**
 * Document classifications split by system. On each axis the first
 * reference applies; the media kind never overwrites the information type (D-131).
 */
export function splitDocumentClassifications(
  refs: Iterable<DocumentClassificationRef>,
): Map<string, DocumentClassification> {
  const out = new Map<string, DocumentClassification>();
  for (const r of refs) {
    const entry = out.get(r.documentId) ?? {};
    const axis = r.system === MEDIA_KIND_SYSTEM ? "mediaKind" : "type";
    if (!entry[axis]) entry[axis] = { code: r.code, name: r.name };
    out.set(r.documentId, entry);
  }
  return out;
}

/** One Reality Capture medium in the Documents panel (`AimPanelData.captureMedia`). */
export interface CaptureMediaEntry {
  /** `capture_media.id`. */
  id: string;
  name: string;
  /** Code of the media kind (FOTO, PANO360...). */
  kind: string;
  /** Name of the kind, group heading in the viewer. */
  kindLabel: string;
  /** Gallery of the space in the host. */
  href: string;
  thumbUrl?: string;
  /** Date of the image `YYYY-MM-DD`. */
  capturedAt?: string;
  /** "v miestnosti X" (in space X) or "cez miestnosť X" (via space X) for an element in a space. */
  via: string;
}

/** Cap of media in the panel (like documents in the card); the whole gallery is in the host. */
export const CAPTURE_MEDIA_MAX = 40;

/**
 * Active media of the points of a space for the Documents panel (D-131 point 1): the newest
 * first, with the kind derived from the point. `inherited` = the selected one is an element in a space.
 */
export function captureMediaEntries(
  points: readonly CapturePointWire[],
  space: { id: string; name: string | null },
  inherited: boolean,
): CaptureMediaEntry[] {
  const room = space.name ?? "priestor";
  const via = inherited ? `cez miestnosť ${room}` : `v miestnosti ${room}`;
  const href = `/ifc?captures=${space.id}`;
  const out: CaptureMediaEntry[] = [];
  const takenAt = new Map<string, string>();
  for (const point of points) {
    const kind = captureMediaKind(point.kind);
    for (const m of point.media) {
      const day = m.capturedAt?.slice(0, 10);
      out.push({
        id: m.id,
        name: [point.name ?? kind.name, !m.isCurrent && day ? `(${day})` : ""].filter(Boolean).join(" "),
        kind: kind.code,
        kindLabel: kind.name ?? kind.code,
        href,
        ...(m.thumbLocation ? { thumbUrl: m.thumbLocation } : {}),
        ...(day ? { capturedAt: day } : {}),
        via,
      });
      takenAt.set(m.id, m.capturedAt ?? "");
    }
  }
  const at = (e: CaptureMediaEntry) => takenAt.get(e.id) ?? "";
  out.sort((a, b) => at(b).localeCompare(at(a)) || a.name.localeCompare(b.name, "sk"));
  return out.slice(0, CAPTURE_MEDIA_MAX);
}
