/**
 * Druh média (D-131): druhá os klasifikácie dokumentov vedľa typu informácie
 * ISO 19650 a médiá Reality Capture (D-073) pre panel Documents vo vieweri.
 *
 * Čisté funkcie bez DB, aby ich mohol testovať vitest a čítať aj klient.
 */
import type { CaptureKind, CapturePointWire } from "./capture-placement";
import type { DocumentType } from "./object-documents-core";

/** Meno klasifikačného systému (IfcClassification.Name) druhej osi. */
export const MEDIA_KIND_SYSTEM = "Druh média";

/** Kódy systému `Druh média` (IfcClassificationReference.Identification) a ich mená. */
export const MEDIA_KIND_LABEL: Record<string, string> = {
  FOTO: "Fotografia",
  PANO360: "360° panoráma",
  SKEN: "Sken",
};

/** Médiá v DB nesú druh na bode (`captures.kind`), nie stĺpcom: odvodenie (D-131 bod 2). */
const CAPTURE_KIND_CODE: Record<CaptureKind, string> = { photo: "FOTO", pano360: "PANO360" };

export function captureMediaKind(kind: CaptureKind): DocumentType {
  const code = CAPTURE_KIND_CODE[kind] ?? "FOTO";
  return { code, name: MEDIA_KIND_LABEL[code] };
}

/** Referencia klasifikácie dokumentu s menom jej systému. */
export interface DocumentClassificationRef {
  documentId: string;
  code: string;
  name: string | null;
  system: string | null;
}

export interface DocumentClassification {
  /** Typ informácie (ISO 19650) alebo iný systém mimo druhu média. */
  type?: DocumentType;
  /** Druh média (systém `Druh média`). */
  mediaKind?: DocumentType;
}

/**
 * Klasifikácie dokumentov rozdelené podľa systému. Na každej osi platí prvá
 * referencia; druh média nikdy neprepíše typ informácie (D-131).
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

/** Jedno médium Reality Capture v paneli Documents (`AimPanelData.captureMedia`). */
export interface CaptureMediaEntry {
  /** `capture_media.id`. */
  id: string;
  name: string;
  /** Kód druhu média (FOTO, PANO360...). */
  kind: string;
  /** Meno druhu, nadpis skupiny vo vieweri. */
  kindLabel: string;
  /** Galéria priestoru v hostovi. */
  href: string;
  thumbUrl?: string;
  /** Dátum snímky `YYYY-MM-DD`. */
  capturedAt?: string;
  /** "v miestnosti X" alebo "cez miestnosť X" pri prvku v priestore. */
  via: string;
}

/** Strop médií v paneli (ako dokumenty v karte); celá galéria je v hostovi. */
export const CAPTURE_MEDIA_MAX = 40;

/**
 * Aktívne médiá bodov priestoru pre panel Documents (D-131 bod 1): najnovšie
 * prvé, s druhom odvodeným z bodu. `inherited` = vybraný je prvok v priestore.
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
