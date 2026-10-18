/**
 * Kamera viewera (D-094): fit a relatívne kroky nad presetom op `camera` /
 * `camera_sel` (wire formát D-066, `lib/viewer-ops.ts`) a ich preklad do bridge
 * správy `SET_CAMERA`. Zdieľa server aj klient ako viewer-ops.
 *
 * Polia argumentu: `~fit=<v|s|t|m|n>~z=<%>~oh=<°>~ov=<°>~px=<%>~py=<%>`.
 * Poradie vo vieweri: smer (preset), fit, orbit, zoom, pan, projekcia.
 */

/** visible = viditeľné (aj izolované) prvky, selection = výber vo vieweri, targets = cieľ, model = celý model, none = výrez sa nemení. */
export const CAMERA_FITS = ["visible", "selection", "targets", "model", "none"] as const;
export type CameraFit = (typeof CAMERA_FITS)[number];

const FIT_CODE: Record<CameraFit, string> = { visible: "v", selection: "s", targets: "t", model: "m", none: "n" };
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

/** CameraMove -> polia bridge správy `SET_CAMERA` (len zadané). */
export function cameraMoveBridge(m: CameraMove): Record<string, unknown> {
  const orbit = m.orbitH !== undefined || m.orbitV !== undefined;
  const pan = m.panX !== undefined || m.panY !== undefined;
  return {
    ...(m.fit ? { fit: m.fit } : {}),
    ...(m.zoomPercent !== undefined ? { zoomPercent: m.zoomPercent } : {}),
    ...(orbit ? { orbitDeg: { h: m.orbitH ?? 0, v: m.orbitV ?? 0 } } : {}),
    ...(pan ? { panPercent: { x: m.panX ?? 0, y: m.panY ?? 0 } } : {}),
  };
}
