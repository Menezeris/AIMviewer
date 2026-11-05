/**
 * Dimension in the viewer (D-124): segments between two points in the IFC world (m, Z up),
 * which the fork inserts into its Measure tool (`MEASURE_SHOW`). Wire in `ops`:
 * `measure:<keep>:<ax,ay,az,bx,by,bz>|<...>`; `keep` = add to the previous dimensions
 * from the host, otherwise replace them; without segments (`measure::`) just delete them (D-152). Pure functions - shared by the server and the client.
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

/** At most this many segments in one command - same limit as the fork bridge. */
export const MAX_MEASURE_SEGMENTS = 12;
/** Range of a coordinate in the IFC world (m) - same as for the section. */
const COORDINATE_LIMIT = 1e7;

const mm = (v: number) => String(Math.round(v * 1000) / 1000);

export function encodeMeasureWire(segments: readonly MeasureSegment[]): string {
  return segments
    .slice(0, MAX_MEASURE_SEGMENTS)
    .map(({ a, b }) => [a.x, a.y, a.z, b.x, b.y, b.z].map(mm).join(","))
    .join("|");
}

/** null = faulty wire (input is from the URL, nothing is executed). */
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
 * Number of host dimensions on the viewer canvas (D-170, #278). The host has no back channel from the viewer, it counts itself:
 * `keep` adds, replace and delete overwrite. The state is in instance memory (one live channel),
 * so it is an estimate for the `clear` recommendation, not a guarantee; a color reset zeroes it.
 */
let onCanvas = 0;

export function noteDimensions(added: number, keep: boolean): number {
  onCanvas = (keep ? onCanvas : 0) + added;
  return onCanvas;
}

export function resetDimensionTally(): void {
  onCanvas = 0;
}
