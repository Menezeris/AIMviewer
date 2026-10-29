/**
 * IDS z AIM vo vieweri (D-162, #285): wire formát správ `IDS_LOAD`, `IDS_SAVED` (host -> viewer) a `IDS_SAVE`
 * (viewer -> host), zrkadlo `apps/viewer/src/aim/ids-protocol.ts` vo forku, a viewer op `ids_open`, ktorým
 * chat otvorí IDS v paneli IDS Studio alebo Data validation -> IDS validation.
 *
 * Op nesie len kód a voľby (XML do správy o živom kanáli nepatrí): klient hosta si XML stiahne z
 * `GET /api/ids?code=` a pošle vieweru `IDS_LOAD`.
 * Op: `ids_open::<base64url JSON {code, target, version?, spec?, run?}>`.
 */

import { fromBase64Url, toBase64Url } from "./viewer-lens";

export const IDS_SOURCE = "aim-bridge" as const;
export const IDS_TARGETS = ["studio", "validation"] as const;
export type IdsTarget = (typeof IDS_TARGETS)[number];
/** Strop XML v správe viewera (rovnaký ako vo forku). */
export const MAX_IDS_XML = 2_000_000;
const MAX_TEXT = 200;

export interface IdsOpenReq {
  code: string;
  target: IdsTarget;
  /** Predvolene posledná verzia. */
  version?: number;
  /** Identifikátor, názov alebo id špecifikácie: beh sa obmedzí na ňu. */
  spec?: string;
  /** Spustiť kontrolu hneď po načítaní (panel validácie). */
  run?: boolean;
}

export type IdsOpenOp = { op: "ids_open" } & IdsOpenReq;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= MAX_TEXT;
const isVersion = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;
const isTarget = (v: unknown): v is IdsTarget => typeof v === "string" && (IDS_TARGETS as readonly string[]).includes(v);

export function idsOpenOp(req: IdsOpenReq): string {
  return `ids_open::${toBase64Url(JSON.stringify(req))}`;
}

/** `ids_open` z wire formátu; null = neplatné (op sa preskočí). */
export function parseIdsOp(joined: string): IdsOpenOp | null {
  const raw = joined ? fromBase64Url(joined) : null;
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || !isText(v.code) || !isTarget(v.target)) return null;
  const spec = isText(v.spec) ? v.spec.trim() : undefined;
  return {
    op: "ids_open",
    code: v.code.trim(),
    target: v.target,
    ...(isVersion(v.version) ? { version: v.version } : {}),
    ...(spec ? { spec } : {}),
    ...(v.run === true ? { run: true } : {}),
  };
}

/** Čo vráti `GET /api/ids?code=` a z čoho sa skladá `IDS_LOAD`. */
export interface IdsDocumentPayload {
  code: string;
  version: number;
  title: string;
  xml: string;
}

export function idsLoadMessage(req: IdsOpenReq, doc: IdsDocumentPayload): Record<string, unknown> {
  return {
    type: "IDS_LOAD",
    code: doc.code,
    version: doc.version,
    title: doc.title.slice(0, MAX_TEXT),
    xml: doc.xml,
    target: req.target,
    ...(req.spec ? { spec: req.spec } : {}),
    ...(req.run ? { run: true } : {}),
  };
}

/** Uloženie z panela viewera (`IDS_SAVE`) po overení tvaru; null = neplatné. */
export interface IdsSaveWire {
  target: IdsTarget;
  xml: string;
  code?: string;
  base_version?: number;
  title?: string;
}

export function parseIdsSave(data: unknown): IdsSaveWire | null {
  if (!isObj(data) || !isTarget(data.target) || typeof data.xml !== "string" || !data.xml.trim() || data.xml.length > MAX_IDS_XML) return null;
  if (data.code !== undefined && !isText(data.code)) return null;
  if (data.base_version !== undefined && !isVersion(data.base_version)) return null;
  if (data.title !== undefined && !isText(data.title)) return null;
  return {
    target: data.target,
    xml: data.xml,
    ...(data.code ? { code: (data.code as string).trim() } : {}),
    ...(data.base_version ? { base_version: data.base_version as number } : {}),
    ...(data.title ? { title: (data.title as string).trim() } : {}),
  };
}

export type IdsSaveResult =
  | { ok: true; code: string; version: number }
  | { ok: false; error: string; latest_version?: number };

export function idsSavedMessage(target: IdsTarget, result: IdsSaveResult): Record<string, unknown> {
  return result.ok
    ? { type: "IDS_SAVED", target, ok: true, code: result.code, version: result.version }
    : { type: "IDS_SAVED", target, ok: false, error: result.error.slice(0, 2000), ...(result.latest_version ? { latest_version: result.latest_version } : {}) };
}
