/**
 * Metadáta dokumentu pre zoznam vo vieweri (D-104 krok 3, `DOCUMENTS_LOAD.meta`).
 * Viewer zoskupuje a hľadá genericky podľa kľúčov, ktoré tu vzniknú, zoznam polí
 * nedrží; kľúč je preto rovno slovenský popisok. Viac hodnôt v jednom kľúči
 * (pôdorys strechy pre 4NP aj 5NP) oddeľuje `META_VALUES_SEPARATOR`, dokument sa
 * vo vieweri objaví v každej skupine.
 */

/** Oddeľovač viacerých hodnôt (zrkadlí `META_VALUES_SEPARATOR` vo forku, aim/documentsQuery.ts). */
export const META_VALUES_SEPARATOR = "; ";

/** Objekt, ktorý nesie väzbu na dokument (rel_associates_document). */
export interface DocumentHolder {
  objectType: string;
  name: string | null;
  ifcGuid?: string | null;
}

export interface DocumentMetaInput {
  identification: string | null;
  /** Cesta v strome dokumentácie (bez koreňa PD), prvý prvok = časť. */
  folder?: readonly string[];
  /** Druh, napr. "DR Výkres" (typ informácie ISO 19650). */
  type?: string;
  /** Druh média, napr. "Fotografia" (systém `Druh média`, D-131). */
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
 * Metadáta jedného dokumentu. Projekt nesie celú dokumentáciu, preto ako nositeľ
 * figuruje len vtedy, keď dokument nič iné nenesie (inak by bol v každej skupine).
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
 * Pôdorys podlažia pre viewer (`kind = drawing`, `storeyGuid`): dokument, ktorý nesie
 * podlažie (po ASR v76 len pôdorysy) a nie je iného druhu než výkres. `storeyGuid` len
 * pri jedinom podlaží (pôdorys strechy 4NP a 5NP ho nemá, viewer by nevedel, kam patrí).
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
 * Disciplína výkresu z kódu dokumentu (`OCB_SO01_ASR_D-1-1-01_...` -> `ASR`); null, keď kód nemá tvar
 * `<projekt>_<objekt>_<disciplína>_...`. Veľkosť písmen sa nerozlišuje, výsledok je veľkými.
 */
export function disciplineOf(ref: string | null | undefined): string | null {
  const m = /^[A-Za-z0-9]+_[A-Za-z0-9]+_([A-Za-z]{2,5})_/.exec(ref ?? "");
  return m ? m[1].toUpperCase() : null;
}

/** Kandidát na výkres podlažia: dokument, ktorý nesie podlažie (jedno alebo viac). */
export interface FloorDrawingCandidate {
  documentId: string;
  ref: string | null;
  discipline: string | null;
  floorGuids: readonly string[];
}

/** Disciplína, ktorá nie je hlavným výkresom podlažia: požiarne riešenie ide až po ostatných (D-176). */
const FALLBACK_DISCIPLINE = "PBR";
const PRIMARY_DISCIPLINE = "ASR";

/** Menšie číslo = lepší výkres podlažia: ASR, ostatné, PBR; v rámci disciplíny výkres jedného podlažia pred spoločným (strecha). */
function floorDrawingRank(c: FloorDrawingCandidate): number {
  const d = c.discipline;
  const tier = d === PRIMARY_DISCIPLINE ? 0 : d === FALLBACK_DISCIPLINE ? 2 : 1;
  return tier * 2 + (c.floorGuids.length === 1 ? 0 : 1);
}

export type FloorDrawingPick =
  | { ok: true; drawing: FloorDrawingCandidate; chosen_by: "discipline" | "preference"; alternatives: FloorDrawingCandidate[] }
  | { ok: false; reason: "no_drawing" | "no_discipline"; available: string[] };

/**
 * Výkres podlažia pre `set_view_mode(floor, split)` (D-176, #316): predvolene ASR pôdorys podlažia, potom iné
 * disciplíny, PBR (požiarne riešenie) len keď iný nie je. Výslovná `discipline` vyberie výkres tej disciplíny
 * (bez nej `no_discipline` s dostupnými). Pri zhode poradia rozhoduje kód dokumentu, aby bol výber stabilný.
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
