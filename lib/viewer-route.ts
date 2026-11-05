/**
 * Route line in the viewer (D-137): a polyline through points in the IFC world (m, Z up),
 * which the fork draws as a solid colored line (`ROUTE_SHOW`). Wire in `ops`:
 * `route:<hex color>:<x,y,z|x,y,z|...>`; empty points = delete the line. Points are
 * in cm (a line at 1.6 m above the floor needs no more precision and the URL stays short).
 * Pure functions - shared by the server and the client.
 */

import type { MeasurePoint } from "./viewer-measure";

/** At most this many points in one command - same limit as the fork bridge. */
export const MAX_ROUTE_POINTS = 400;
/** Default color of the route line (red). */
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

/** [] = delete the line, null = faulty wire (input is from the URL, nothing is executed). */
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

/** `route:<hex>:<body>` -> color and body, or null. */
export function parseRouteOp(arg: string, joined: string): { color: string; points: MeasurePoint[] } | null {
  if (!HEX6.test(arg)) return null;
  const points = decodeRouteWire(joined);
  return points ? { color: `#${arg.toLowerCase()}`, points } : null;
}
