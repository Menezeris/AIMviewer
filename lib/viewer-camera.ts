/**
 * Kamera viewera (D-094, revízia D-098): fit a relatívne kroky nad presetom op
 * `camera` / `camera_sel` (wire formát D-066, `lib/viewer-ops.ts`). Zdieľa
 * server aj klient ako viewer-ops.
 *
 * Polia argumentu: `~fit=<v|s>~z=<%>~oh=<°>~ov=<°>~px=<%>~py=<%>`.
 * Fit (viditeľné, výber) vykoná fork existujúcimi funkciami viewera. Relatívny
 * zoom/orbit/posun počíta host: z `view_state` (D-085) vypočíta novú pózu
 * (`relativeViewpoint`) a pošle ju ako `SET_CAMERA {viewpoint}`; fork ju len
 * prenesie do kamery (`applyViewpoint`, tá istá cesta ako BCF). Poradie
 * krokov: orbit, zoom, posun.
 */

/** visible = viditeľné (aj izolované) prvky, selection = výber vo vieweri. */
export const CAMERA_FITS = ["visible", "selection"] as const;
export type CameraFit = (typeof CAMERA_FITS)[number];

const FIT_CODE: Record<CameraFit, string> = { visible: "v", selection: "s" };
const FIT_BY_CODE = Object.fromEntries(Object.entries(FIT_CODE).map(([k, v]) => [v, k])) as Record<string, CameraFit>;

/** Rozsahy relatívnych krokov - rovnaké na serveri aj v klientovi. */
export const CAMERA_RANGES = {
  zoomPercent: { min: -90, max: 500 },
  orbitH: { min: -180, max: 180 },
  orbitV: { min: -89, max: 89 },
  pan: { min: -100, max: 100 },
} as const;

export interface CameraMove {
  fit?: CameraFit;
  /** Kladné priblíži (vzdialenosť / (1 + p/100)), záporné oddiali (vzdialenosť * (1 + |p|/100)). */
  zoomPercent?: number;
  /** Kladné = kamera obehne cieľ doľava. */
  orbitH?: number;
  /** Kladné = kamera vyššie, pohľad viac zhora. */
  orbitV?: number;
  /** % šírky pohľadu, kladné = pohľad doprava. */
  panX?: number;
  /** % výšky pohľadu, kladné = pohľad hore. */
  panY?: number;
}

type NumKey = Exclude<keyof CameraMove, "fit">;
const NUM_FIELDS: [NumKey, string, { min: number; max: number }][] = [
  ["zoomPercent", "z", CAMERA_RANGES.zoomPercent],
  ["orbitH", "oh", CAMERA_RANGES.orbitH],
  ["orbitV", "ov", CAMERA_RANGES.orbitV],
  ["panX", "px", CAMERA_RANGES.pan],
  ["panY", "py", CAMERA_RANGES.pan],
];

/** CameraMove -> polia argumentu op (bez nulových krokov). */
export function cameraMoveArgs(m: CameraMove): string[] {
  const out: string[] = [];
  if (m.fit) out.push(`fit=${FIT_CODE[m.fit]}`);
  for (const [key, code] of NUM_FIELDS) {
    const v = m[key];
    if (v !== undefined && v !== 0) out.push(`${code}=${v}`);
  }
  return out;
}

/** Polia argumentu -> CameraMove; neplatné alebo mimo rozsahu sa ticho zahodia (vstup je z URL). */
export function parseCameraMove(kv: Record<string, string>): CameraMove {
  const m: CameraMove = {};
  const fit = kv.fit !== undefined ? FIT_BY_CODE[kv.fit] : undefined;
  if (fit) m.fit = fit;
  for (const [key, code, range] of NUM_FIELDS) {
    if (kv[code] === undefined) continue;
    const n = Number(kv[code]);
    if (Number.isFinite(n) && n !== 0 && n >= range.min && n <= range.max) m[key] = n;
  }
  return m;
}

/** Má op relatívny krok? Ten počíta host z `view_state`, nie fork. */
export function hasRelativeStep(m: CameraMove): boolean {
  return NUM_FIELDS.some(([key]) => m[key] !== undefined);
}

type Vec3 = { x: number; y: number; z: number };

/** Kamera z `view_state` (IFC svet, Z hore, m). */
export interface ViewerCamera {
  position: Vec3;
  target: Vec3;
  up?: Vec3;
  projection?: string;
  fov_deg?: number;
  ortho_size?: number;
  aspect?: number;
}

/** Póza pre bridge `SET_CAMERA.viewpoint` (IFC svet). */
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

/** Otočenie okolo zvislej osi IFC (Z) o uhol v radiánoch, kladný proti smeru hodín zhora. */
function rotateZ(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z };
}

/**
 * Nová póza kamery po relatívnych krokoch (orbit, zoom, posun), IFC svet.
 * Orbit obieha cieľ okolo zvislej osi; zvislý orbit drží výšku pohľadu v
 * rozsahu -89° až 89° a vráti `up` na zvislicu. Zoom mení vzdialenosť od
 * cieľa (perspektíva) alebo polovicu výšky pohľadu (ortografia). Posun
 * presunie kameru aj cieľ o percento viditeľnej šírky/výšky.
 */
export function relativeViewpoint(cam: ViewerCamera, move: CameraMove): BridgeViewpoint {
  let target = cam.target;
  let offset = sub(cam.position, cam.target);
  let up = cam.up && len(cam.up) > 1e-9 ? norm(cam.up) : WORLD_UP;
  const dist = len(offset) || 1;
  const ortho = cam.projection === "orthographic" && cam.ortho_size !== undefined;
  let orthoSize = cam.ortho_size;

  if (move.orbitH) {
    // Kamera doľava = otočenie po smere hodinových ručičiek zhora.
    offset = rotateZ(offset, -move.orbitH * RAD);
    up = rotateZ(up, -move.orbitH * RAD);
  }
  if (move.orbitV) {
    const horiz = Math.hypot(offset.x, offset.y);
    // Pohľad zhora nemá vodorovný smer kamery: kamera je oproti hornej hrane obrazu.
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
