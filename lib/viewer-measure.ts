/**
 * Kóta vo vieweri (D-124): úseky medzi dvoma bodmi v IFC svete (m, Z hore),
 * ktoré fork vloží do svojho nástroja Measure (`MEASURE_SHOW`). Wire v `ops`:
 * `measure:<keep>:<ax,ay,az,bx,by,bz>|<...>`; `keep` = pridať k predošlým kótam
 * od hosta, inak ich nahradiť; bez úsekov (`measure::`) ich len zmazať (D-152). Čisté funkcie - zdieľa ich server aj klient.
 */

export interface MeasurePoint {
  x: number;
  y: number;
  z: number;
}

export interface MeasureSegment {
  a: MeasurePoint;
  b: MeasurePoint;
}

/** Najviac úsekov v jednom príkaze - rovnaký limit ako most forku. */
export const MAX_MEASURE_SEGMENTS = 12;
/** Rozsah súradnice v IFC svete (m) - rovnaký ako pri reze. */
const COORDINATE_LIMIT = 1e7;

const mm = (v: number) => String(Math.round(v * 1000) / 1000);

export function encodeMeasureWire(segments: readonly MeasureSegment[]): string {
  return segments
    .slice(0, MAX_MEASURE_SEGMENTS)
    .map(({ a, b }) => [a.x, a.y, a.z, b.x, b.y, b.z].map(mm).join(","))
    .join("|");
}

/** null = chybný wire (vstup je z URL, nič sa nevykoná). */
export function decodeMeasureWire(raw: string): MeasureSegment[] | null {
  const parts = raw.split("|").filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_MEASURE_SEGMENTS) return null;
  const out: MeasureSegment[] = [];
  for (const part of parts) {
    const v = part.split(",").map(Number);
    if (v.length !== 6 || v.some((n) => !Number.isFinite(n) || Math.abs(n) > COORDINATE_LIMIT)) return null;
    out.push({ a: { x: v[0], y: v[1], z: v[2] }, b: { x: v[3], y: v[4], z: v[5] } });
  }
  return out;
}

export function measureOp(segments: readonly MeasureSegment[], keep = false): string {
  return `measure:${keep ? "keep" : ""}:${encodeMeasureWire(segments)}`;
}

/**
 * Počet kót od hosta na plátne viewera (D-170, #278). Host nemá spätný kanál z vieweru, počíta sám:
 * `keep` pripočíta, nahradenie a zmazanie prepíše. Stav je v pamäti inštancie (jeden živý kanál),
 * preto je to odhad pre odporúčanie `clear`, nie záruka; reset farieb ho vynuluje.
 */
let onCanvas = 0;

export function noteDimensions(added: number, keep: boolean): number {
  onCanvas = (keep ? onCanvas : 0) + added;
  return onCanvas;
}

export function resetDimensionTally(): void {
  onCanvas = 0;
}
