/**
 * Čiara trasy vo vieweri (D-137): lomená čiara cez body v IFC svete (m, Z hore),
 * ktorú fork nakreslí plnou farebnou čiarou (`ROUTE_SHOW`). Wire v `ops`:
 * `route:<hex farba>:<x,y,z|x,y,z|...>`; prázdne body = zmazať čiaru. Body sú
 * na cm (čiara na 1,6 m nad podlahou presnejšie netreba a URL ostane krátka).
 * Čisté funkcie - zdieľa ich server aj klient.
 */

import type { MeasurePoint } from "./viewer-measure";

/** Najviac bodov v jednom príkaze - rovnaký limit ako most forku. */
export const MAX_ROUTE_POINTS = 400;
/** Predvolená farba čiary trasy (červená). */
export const ROUTE_COLOR = "#dc2626";
const COORDINATE_LIMIT = 1e7;
const HEX6 = /^[0-9a-fA-F]{6}$/;

const cm = (v: number) => String(Math.round(v * 100) / 100);

export function encodeRouteWire(points: readonly MeasurePoint[]): string {
  return points
    .slice(0, MAX_ROUTE_POINTS)
    .map((p) => [p.x, p.y, p.z].map(cm).join(","))
    .join("|");
}

/** [] = zmazať čiaru, null = chybný wire (vstup je z URL, nič sa nevykoná). */
export function decodeRouteWire(raw: string): MeasurePoint[] | null {
  const parts = raw.split("|").filter(Boolean);
  if (parts.length === 1 || parts.length > MAX_ROUTE_POINTS) return null;
  const out: MeasurePoint[] = [];
  for (const part of parts) {
    const v = part.split(",").map(Number);
    if (v.length !== 3 || v.some((n) => !Number.isFinite(n) || Math.abs(n) > COORDINATE_LIMIT)) return null;
    out.push({ x: v[0], y: v[1], z: v[2] });
  }
  return out;
}

export function routeOp(points: readonly MeasurePoint[], color = ROUTE_COLOR): string {
  return `route:${color.replace(/^#/, "")}:${encodeRouteWire(points)}`;
}

/** `route:<hex>:<body>` -> farba a body, alebo null. */
export function parseRouteOp(arg: string, joined: string): { color: string; points: MeasurePoint[] } | null {
  if (!HEX6.test(arg)) return null;
  const points = decodeRouteWire(joined);
  return points ? { color: `#${arg.toLowerCase()}`, points } : null;
}
