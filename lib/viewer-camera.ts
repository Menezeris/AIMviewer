/**
 * Viewer camera (D-094, revision D-098): fit and relative steps on top of the op preset
 * `camera` / `camera_sel` (wire format D-066, `lib/viewer-ops.ts`). Shared by the
 * server and the client like viewer-ops.
 *
 * Argument fields: `~fit=<v|s>~z=<%>~oh=<°>~ov=<°>~px=<%>~py=<%>~mg=<%>~ar=<l|r|t|b|f|k>`.
 * Fit (visible, selection) is done by the fork with existing viewer functions. Relative
 * zoom/orbit/pan is computed by the host: from `view_state` (D-085) it computes the new pose
 * (`relativeViewpoint`) and sends it as `SET_CAMERA {viewpoint}`; the fork only
 * transfers it to the camera (`applyViewpoint`, same path as BCF). Order
 * of steps: orbit, zoom, pan. The margin and the target part (D-128) are framed by the fork after
 * the direction is set (`cameraCallbacks.frameBounds` with the margin).
 */

/** visible = visible (also isolated) elements, selection = selection in the viewer. */
export const CAMERA_FITS = ["visible", "selection"] as const;
export type CameraFit = (typeof CAMERA_FITS)[number];

const FIT_CODE: Record<CameraFit, string> = { visible: "v", selection: "s" };
const FIT_BY_CODE = Object.fromEntries(Object.entries(FIT_CODE).map(([k, v]) => [v, k])) as Record<string, CameraFit>;

/**
 * Part of the target by view direction (D-128): left/right by image width, top/bottom
 * by height, front/back closer/farther from the camera.
 */
export const CAMERA_AREAS = ["left", "right", "top", "bottom", "front", "back"] as const;
export type CameraArea = (typeof CAMERA_AREAS)[number];

const AREA_CODE: Record<CameraArea, string> = { left: "l", right: "r", top: "t", bottom: "b", front: "f", back: "k" };
const AREA_BY_CODE = Object.fromEntries(Object.entries(AREA_CODE).map(([k, v]) => [v, k])) as Record<string, CameraArea>;

/** Ranges of relative steps and margin - the same on the server and in the client. */
export const CAMERA_RANGES = {
  zoomPercent: { min: -90, max: 500 },
  orbitH: { min: -180, max: 180 },
  orbitV: { min: -89, max: 89 },
  pan: { min: -100, max: 100 },
  marginPercent: { min: 0, max: 300 },
} as const;

/**
 * Continuous rotation around (D-154): `start` / `stop`, speed in degrees per second and direction. `left` = same direction
 * as positive `orbit_h_deg` (the camera orbits the target to the left). Range and names match the fork bridge (`aim/autoRotatePlan.ts`).
 */
export const AUTO_ROTATE_ACTIONS = ["start", "stop"] as const;
export type AutoRotateAction = (typeof AUTO_ROTATE_ACTIONS)[number];
export const AUTO_ROTATE_DIRECTIONS = ["left", "right"] as const;
export type AutoRotateDirection = (typeof AUTO_ROTATE_DIRECTIONS)[number];
export const AUTO_ROTATE_SPEED = { min: 0.5, max: 90, default: 10 } as const;

/** Margin around the target when the model does not give one (#172: a thin parapet should not be framed tightly). */
export const DEFAULT_MARGIN_PERCENT = 40;

/** Margin in % -> multiple of the bounds for `frameBounds` (1 = edge to edge, 1.4 = 40 % extra). */
export const marginToPadding = (marginPercent: number) => 1 + marginPercent / 100;

export interface CameraMove {
  fit?: CameraFit;
  /** Positive zooms in (distance / (1 + p/100)), negative zooms out (distance * (1 + |p|/100)). */
  zoomPercent?: number;
  /** Positive = the camera orbits the target to the left. */
  orbitH?: number;
  /** Positive = camera higher, view more from above. */
  orbitV?: number;
  /** % of view width, positive = view to the right. */
  panX?: number;
  /** % of view height, positive = view up. */
  panY?: number;
  /** Margin around the target in % (D-128); not a relative step, the fork frames it. */
  marginPercent?: number;
  /** Frame only the part of the target in the given image direction (D-128). */
  area?: CameraArea;
}

type NumKey = Exclude<keyof CameraMove, "fit" | "marginPercent" | "area">;
const NUM_FIELDS: [NumKey, string, { min: number; max: number }][] = [
  ["zoomPercent", "z", CAMERA_RANGES.zoomPercent],
  ["orbitH", "oh", CAMERA_RANGES.orbitH],
  ["orbitV", "ov", CAMERA_RANGES.orbitV],
  ["panX", "px", CAMERA_RANGES.pan],
  ["panY", "py", CAMERA_RANGES.pan],
];

/** CameraMove -> op argument fields (without zero steps). */
export function cameraMoveArgs(m: CameraMove): string[] {
  const out: string[] = [];
  if (m.fit) out.push(`fit=${FIT_CODE[m.fit]}`);
  for (const [key, code] of NUM_FIELDS) {
    const v = m[key];
    if (v !== undefined && v !== 0) out.push(`${code}=${v}`);
  }
  if (m.marginPercent !== undefined) out.push(`mg=${m.marginPercent}`);
  if (m.area) out.push(`ar=${AREA_CODE[m.area]}`);
  return out;
}

/** Argument fields -> CameraMove; invalid or out-of-range ones are silently dropped (input is from the URL). */
export function parseCameraMove(kv: Record<string, string>): CameraMove {
  const m: CameraMove = {};
  const fit = kv.fit !== undefined ? FIT_BY_CODE[kv.fit] : undefined;
  if (fit) m.fit = fit;
  for (const [key, code, range] of NUM_FIELDS) {
    if (kv[code] === undefined) continue;
    const n = Number(kv[code]);
    if (Number.isFinite(n) && n !== 0 && n >= range.min && n <= range.max) m[key] = n;
  }
  if (kv.mg !== undefined && kv.mg !== "") {
    const n = Number(kv.mg);
    const r = CAMERA_RANGES.marginPercent;
    if (Number.isFinite(n) && n >= r.min && n <= r.max) m.marginPercent = n;
  }
  const area = kv.ar !== undefined ? AREA_BY_CODE[kv.ar] : undefined;
  if (area) m.area = area;
  return m;
}

/** Does the op have a relative step? The host computes it from `view_state`, not the fork. */
export function hasRelativeStep(m: CameraMove): boolean {
  return NUM_FIELDS.some(([key]) => m[key] !== undefined);
}

type Vec3 = { x: number; y: number; z: number };

/** Camera from `view_state` (IFC world, Z up, m). */
export interface ViewerCamera {
  position: Vec3;
  target: Vec3;
  up?: Vec3;
  projection?: string;
  fov_deg?: number;
  ortho_size?: number;
  aspect?: number;
}

/** Pose for bridge `SET_CAMERA.viewpoint` (IFC world). */
export interface BridgeViewpoint {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  orthoSize?: number;
}

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const norm = (a: Vec3): Vec3 => scale(a, 1 / (len(a) || 1));
const WORLD_UP: Vec3 = { x: 0, y: 0, z: 1 };
const RAD = Math.PI / 180;

/** Rotation around the vertical IFC axis (Z) by an angle in radians, positive counterclockwise seen from above. */
function rotateZ(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z };
}

/**
 * New camera pose after relative steps (orbit, zoom, pan), IFC world.
 * Orbit circles the target around the vertical axis; vertical orbit keeps the view elevation in
 * the range -89° to 89° and returns `up` to the vertical. Zoom changes the distance from
 * the target (perspective) or half the view height (orthographic). Pan
 * moves the camera and the target by a percentage of the visible width/height.
 */
export function relativeViewpoint(cam: ViewerCamera, move: CameraMove): BridgeViewpoint {
  let target = cam.target;
  let offset = sub(cam.position, cam.target);
  let up = cam.up && len(cam.up) > 1e-9 ? norm(cam.up) : WORLD_UP;
  const dist = len(offset) || 1;
  const ortho = cam.projection === "orthographic" && cam.ortho_size !== undefined;
  let orthoSize = cam.ortho_size;

  if (move.orbitH) {
    // Camera to the left = rotation clockwise seen from above.
    offset = rotateZ(offset, -move.orbitH * RAD);
    up = rotateZ(up, -move.orbitH * RAD);
  }
  if (move.orbitV) {
    const horiz = Math.hypot(offset.x, offset.y);
    // A top-down view has no horizontal camera direction: the camera is opposite the top edge of the image.
    const heading = horiz > dist * 1e-6
      ? { x: offset.x / horiz, y: offset.y / horiz }
      : Math.hypot(up.x, up.y) > 1e-9
        ? { x: -up.x / Math.hypot(up.x, up.y), y: -up.y / Math.hypot(up.x, up.y) }
        : { x: 0, y: -1 };
    const elevation = Math.atan2(offset.z, horiz) / RAD;
    const next = Math.max(-89, Math.min(89, elevation + move.orbitV)) * RAD;
    offset = { x: heading.x * Math.cos(next) * dist, y: heading.y * Math.cos(next) * dist, z: Math.sin(next) * dist };
    up = WORLD_UP;
  }
  if (move.zoomPercent) {
    const p = move.zoomPercent;
    const factor = p > 0 ? 1 / (1 + p / 100) : 1 + -p / 100;
    if (ortho) orthoSize = cam.ortho_size! * factor;
    else offset = scale(offset, factor);
  }
  if (move.panX || move.panY) {
    const forward = norm(scale(offset, -1));
    let right = cross(forward, up);
    if (len(right) < 1e-9) right = cross(forward, { x: 0, y: 1, z: 0 });
    right = norm(right);
    const screenUp = norm(cross(right, forward));
    const halfH = ortho ? orthoSize! : len(offset) * Math.tan(((cam.fov_deg ?? 45) * RAD) / 2);
    const halfW = halfH * (cam.aspect && cam.aspect > 0 ? cam.aspect : 1);
    const shift = add(scale(right, ((move.panX ?? 0) / 100) * 2 * halfW), scale(screenUp, ((move.panY ?? 0) / 100) * 2 * halfH));
    target = add(target, shift);
  }
  return {
    position: add(target, offset),
    target,
    up,
    ...(ortho && orthoSize !== undefined ? { orthoSize } : {}),
  };
}

/** Visible area through the camera (D-128): center, dimensions in m in the target plane and image directions in the IFC. */
export interface VisibleArea {
  center: Vec3;
  width_m: number;
  height_m: number;
  /** Unit direction "right" on screen in the IFC world. */
  right: Vec3;
  /** Unit direction "up" on screen in the IFC world. */
  up: Vec3;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const roundVec = (v: Vec3): Vec3 => ({ x: r3(v.x), y: r3(v.y), z: r3(v.z) });

/**
 * What the camera shows from `view_state`: in orthographic height 2 * ortho_size, in perspective
 * the field-of-view height at the target distance; width = height * aspect ratio. A missing
 * value (ratio, FOV, ortho_size) = null, we do not guess.
 */
export function visibleArea(cam: ViewerCamera): VisibleArea | null {
  const offset = sub(cam.position, cam.target);
  const dist = len(offset);
  if (!(dist > 0) || !(cam.aspect && cam.aspect > 0)) return null;
  let halfH: number;
  if (cam.projection === "orthographic") {
    if (!(cam.ortho_size && cam.ortho_size > 0)) return null;
    halfH = cam.ortho_size;
  } else {
    if (!(cam.fov_deg && cam.fov_deg > 0)) return null;
    halfH = dist * Math.tan((cam.fov_deg * RAD) / 2);
  }
  const forward = norm(scale(offset, -1));
  const up0 = cam.up && len(cam.up) > 1e-9 ? norm(cam.up) : WORLD_UP;
  let right = cross(forward, up0);
  if (len(right) < 1e-9) right = cross(forward, { x: 0, y: 1, z: 0 });
  right = norm(right);
  const screenUp = norm(cross(right, forward));
  return {
    center: roundVec(cam.target),
    width_m: r3(2 * halfH * cam.aspect),
    height_m: r3(2 * halfH),
    right: roundVec(right),
    up: roundVec(screenUp),
  };
}
