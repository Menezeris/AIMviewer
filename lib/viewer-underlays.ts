/**
 * Podklady PDF v 3D z chatu (D-168, #323, #325): wire formát rozšírenej bridge správy `SET_UNDERLAYS_3D`
 * (zrkadlo `apps/viewer/src/aim/` vo forku, Menezeris/ifc-lite#169) a stav podkladov v pohľade z Presentation
 * (`ViewWire.underlays`).
 *
 * `SET_UNDERLAYS_3D` {show?, underlays?: [{document_id, visible?, opacity?}], only?, persist?}: bez `persist` je to
 * len stav viewera; s `persist` viewer pošle `UNDERLAY_SAVE` (nezmenené affine a calibration, zmenené len visible a
 * opacity) a host ho uloží ako dnes. Starý viewer pozná len `show`, ostatné polia ignoruje.
 *
 * Op: `underlays_set::<base64url JSON>` (veľkosť: až 200 položiek, preto JSON, nie `~k=v`).
 */

import { fromBase64Url, toBase64Url } from "./viewer-lens";

/** Strop zoznamu podkladov v jednej správe aj v jednom pohľade. */
export const MAX_UNDERLAY_ITEMS = 200;
const MAX_ID = 64;

export interface UnderlaySetItem {
  document_id: string;
  visible?: boolean;
  opacity?: number;
}

export interface UnderlaysSetRequest {
  show?: boolean;
  underlays?: UnderlaySetItem[];
  /** Len s `underlays`: ostatné kalibrované podklady v 3D vypne. */
  only?: boolean;
  persist?: boolean;
}

export interface UnderlaysSetOp extends UnderlaysSetRequest {
  op: "underlays_set";
}

/** Op `underlays_load::`: host stiahne aktuálne podklady z `GET /api/underlay` a pošle viewerovi `UNDERLAYS_LOAD` (po obnove kalibrácie). */
export interface UnderlaysLoadOp {
  op: "underlays_load";
}

export const UNDERLAYS_LOAD_OP = "underlays_load::";

/** Stav jedného podkladu v pohľade (`ViewWire.underlays.items`). */
export interface ViewUnderlayItemWire {
  document_id: string;
  visible: boolean;
  opacity: number;
}

/** Stav podkladov v pohľade: zapnuté v 3D a ktoré podklady sú viditeľné s akou priehľadnosťou. */
export interface ViewUnderlaysWire {
  show: boolean;
  items: ViewUnderlayItemWire[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isOpacity = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const isDocId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID;

/** Tvar podkladov v pohľade (kontrola ako vo forku): neplatný tvar zahodí celý pohľad. */
export function isViewUnderlays(v: unknown): v is ViewUnderlaysWire {
  if (!isObj(v) || !isBool(v.show) || !Array.isArray(v.items) || v.items.length > MAX_UNDERLAY_ITEMS) return false;
  return v.items.every((i) => isObj(i) && isDocId(i.document_id) && isBool(i.visible) && isOpacity(i.opacity));
}

/**
 * Žiadosť o zmenu podkladov: chyba (text pre model) alebo očistená žiadosť. Aspoň `show` alebo `underlays`,
 * každá položka aspoň `visible` alebo `opacity`, `only` len s `underlays`.
 */
export function checkUnderlaysSet(raw: unknown): { ok: true; request: UnderlaysSetRequest } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: "žiadosť o podklady musí byť objekt" };
  const { show, underlays, only, persist } = raw;
  if (show !== undefined && !isBool(show)) return { ok: false, error: "show je true alebo false" };
  if (only !== undefined && !isBool(only)) return { ok: false, error: "only je true alebo false" };
  if (persist !== undefined && !isBool(persist)) return { ok: false, error: "persist je true alebo false" };
  if (show === undefined && underlays === undefined) return { ok: false, error: "treba aspoň show alebo underlays" };
  let items: UnderlaySetItem[] | undefined;
  if (underlays !== undefined) {
    if (!Array.isArray(underlays) || underlays.length === 0 || underlays.length > MAX_UNDERLAY_ITEMS) {
      return { ok: false, error: `underlays je pole 1 až ${MAX_UNDERLAY_ITEMS} položiek` };
    }
    items = [];
    for (const i of underlays) {
      if (!isObj(i) || !isDocId(i.document_id)) return { ok: false, error: "položka underlays potrebuje document_id" };
      if (i.visible === undefined && i.opacity === undefined) return { ok: false, error: "položka underlays potrebuje visible alebo opacity" };
      if (i.visible !== undefined && !isBool(i.visible)) return { ok: false, error: "visible je true alebo false" };
      if (i.opacity !== undefined && !isOpacity(i.opacity)) return { ok: false, error: "opacity je číslo 0 až 1" };
      items.push({
        document_id: i.document_id,
        ...(i.visible !== undefined ? { visible: i.visible } : {}),
        ...(i.opacity !== undefined ? { opacity: i.opacity } : {}),
      });
    }
  }
  if (only !== undefined && items === undefined) return { ok: false, error: "only platí len s underlays" };
  return {
    ok: true,
    request: {
      ...(show !== undefined ? { show } : {}),
      ...(items ? { underlays: items } : {}),
      ...(only !== undefined ? { only } : {}),
      ...(persist !== undefined ? { persist } : {}),
    },
  };
}

/** Op pre viewer: `underlays_set::<base64url JSON>`; neplatná žiadosť vyhodí chybu (stavia ju len server). */
export function underlaysSetOp(request: UnderlaysSetRequest): string {
  const checked = checkUnderlaysSet(request);
  if (!checked.ok) throw new Error(`underlays_set: ${checked.error}`);
  return `underlays_set::${toBase64Url(JSON.stringify(checked.request))}`;
}

/** `underlays_set` z wire formátu; null = neplatné (op sa preskočí). */
export function parseUnderlaysSetOp(joined: string): UnderlaysSetOp | null {
  const raw = joined ? fromBase64Url(joined) : null;
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  const checked = checkUnderlaysSet(v);
  return checked.ok ? { op: "underlays_set", ...checked.request } : null;
}

/** Op -> bridge správa forku (`SET_UNDERLAYS_3D`). */
export function underlaysSetBridgeMessage(o: UnderlaysSetOp): Record<string, unknown> {
  const { op: _op, ...request } = o;
  void _op;
  return { type: "SET_UNDERLAYS_3D", ...request };
}
