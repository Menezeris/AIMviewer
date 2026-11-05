/**
 * Document metadata for the list in the viewer (D-104 step 3, `DOCUMENTS_LOAD.meta`).
 * The viewer groups and searches generically by the keys that arise here, it does not hold
 * a list of fields; the key is therefore directly the Slovak label. Multiple values in one key
 * (roof plan for both 4NP and 5NP) are separated by `META_VALUES_SEPARATOR`, the document
 * appears in every group in the viewer.
 */

/** Separator of multiple values (mirrors `META_VALUES_SEPARATOR` in the fork, aim/documentsQuery.ts). */
export const META_VALUES_SEPARATOR = "; ";

/** Object that carries a link to a document (rel_associates_document). */
export interface DocumentHolder {
  objectType: string;
  name: string | null;
  ifcGuid?: string | null;
}

export interface DocumentMetaInput {
  identification: string | null;
  /** Path in the documentation tree (without the PD root), first item = part. */
  folder?: readonly string[];
  /** Kind, e.g. "DR Výkres" (information type per ISO 19650). */
  type?: string;
  /** Media kind, e.g. "Fotografia" (system `Druh média`, D-131). */
  mediaKind?: string;
  holders: readonly DocumentHolder[];
  lastRevisionTime: string | null;
  electronicFormat: string | null;
  owner: string | null;
}

const HOLDER_LABEL: Record<string, string> = {
  project: "projekt",
  site: "pozemok",
  building: "budova",
  floor: "podlažie",
  space: "miestnosť",
  zone: "zóna",
  spatial_zone: "priestorová zóna",
  group: "skupina",
  system: "systém",
  asset_type: "typ",
  asset: "prvok",
};

const collator = new Intl.Collator("sk", { numeric: true });

function join(values: Iterable<string>): string {
  return [...new Set(values)].sort(collator.compare).join(META_VALUES_SEPARATOR);
}

/** "application/pdf" -> "PDF", "image/png" -> "PNG". */
function formatLabel(mime: string): string {
  const sub = mime.split("/")[1] ?? mime;
  return sub.replace(/\+.*$/, "").toUpperCase();
}

/**
 * Metadata of a single document. The project carries the whole documentation, so it appears as
 * a carrier only when the document is carried by nothing else (otherwise it would be in every group).
 */
export function documentMeta(input: DocumentMetaInput): Record<string, string> {
  const meta: Record<string, string> = {};
  const put = (key: string, value: string | null | undefined) => {
    if (value) meta[key] = value;
  };
  put("Identifikácia", input.identification);
  put("Časť", input.folder?.[0]);
  put("Druh", input.type);
  put("Druh média", input.mediaKind);
  const others = input.holders.filter((h) => h.objectType !== "project");
  put("Nositeľ", join((others.length > 0 ? others : input.holders).map((h) => HOLDER_LABEL[h.objectType] ?? h.objectType)));
  put("Podlažie", join(input.holders.filter((h) => h.objectType === "floor" && h.name).map((h) => h.name as string)));
  put("Revízia", input.lastRevisionTime?.slice(0, 10));
  put("Formát", input.electronicFormat ? formatLabel(input.electronicFormat) : null);
  put("Vlastník", input.owner);
  return meta;
}

/**
 * Storey floor plan for the viewer (`kind = drawing`, `storeyGuid`): a document that carries the
 * storey (after ASR v76 only floor plans) and is not of a kind other than drawing. `storeyGuid` only
 * for a single storey (the roof plan of 4NP and 5NP does not have it, the viewer would not know where it belongs).
 */
export function floorDrawing(
  holders: readonly DocumentHolder[],
  typeCode: string | undefined,
): { drawing: boolean; storeyGuid?: string } {
  const floors = holders.filter((h) => h.objectType === "floor");
  if (floors.length === 0 || (typeCode && typeCode !== "DR")) return { drawing: false };
  const guids = [...new Set(floors.map((f) => f.ifcGuid).filter(Boolean) as string[])];
  return guids.length === 1 ? { drawing: true, storeyGuid: guids[0] } : { drawing: true };
}

/**
 * Drawing discipline from the document code (`OCB_SO01_ASR_D-1-1-01_...` -> `ASR`); null when the code does not have the form
 * `<project>_<object>_<discipline>_...`. Case is ignored, the result is uppercase.
 */
export function disciplineOf(ref: string | null | undefined): string | null {
  const m = /^[A-Za-z0-9]+_[A-Za-z0-9]+_([A-Za-z]{2,5})_/.exec(ref ?? "");
  return m ? m[1].toUpperCase() : null;
}

/** Storey drawing candidate: a document that carries the storey (one or more). */
export interface FloorDrawingCandidate {
  documentId: string;
  ref: string | null;
  discipline: string | null;
  floorGuids: readonly string[];
}

/** A discipline that is not the main storey drawing: fire safety solution goes only after the others (D-176). */
const FALLBACK_DISCIPLINE = "PBR";
const PRIMARY_DISCIPLINE = "ASR";

/** Lower number = better storey drawing: ASR, others, PBR; within a discipline a drawing of a single storey before a shared one (roof). */
function floorDrawingRank(c: FloorDrawingCandidate): number {
  const d = c.discipline;
  const tier = d === PRIMARY_DISCIPLINE ? 0 : d === FALLBACK_DISCIPLINE ? 2 : 1;
  return tier * 2 + (c.floorGuids.length === 1 ? 0 : 1);
}

export type FloorDrawingPick =
  | { ok: true; drawing: FloorDrawingCandidate; chosen_by: "discipline" | "preference"; alternatives: FloorDrawingCandidate[] }
  | { ok: false; reason: "no_drawing" | "no_discipline"; available: string[] };

/**
 * Storey drawing for `set_view_mode(floor, split)` (D-176, #316): by default the ASR floor plan of the storey, then other
 * disciplines, PBR (fire safety solution) only when there is no other. An explicit `discipline` selects the drawing of that discipline
 * (without it `no_discipline` with the available ones). On a tie the document code decides, so that the choice is stable.
 */
export function pickFloorDrawing(
  candidates: readonly FloorDrawingCandidate[],
  storeyGuid: string,
  discipline?: string | null,
): FloorDrawingPick {
  const onFloor = candidates.filter((c) => c.floorGuids.includes(storeyGuid));
  if (onFloor.length === 0) return { ok: false, reason: "no_drawing", available: [] };
  const sorted = [...onFloor].sort((a, b) => floorDrawingRank(a) - floorDrawingRank(b) || (a.ref ?? a.documentId).localeCompare(b.ref ?? b.documentId));
  const want = discipline?.trim().toUpperCase();
  if (want) {
    const hit = sorted.filter((c) => c.discipline === want);
    if (hit.length === 0) {
      return { ok: false, reason: "no_discipline", available: [...new Set(sorted.map((c) => c.discipline).filter((d): d is string => !!d))] };
    }
    return { ok: true, drawing: hit[0], chosen_by: "discipline", alternatives: sorted.filter((c) => c !== hit[0]) };
  }
  return { ok: true, drawing: sorted[0], chosen_by: "preference", alternatives: sorted.slice(1) };
}
