/**
 * Ktorý viewer sa vloží do /ifc (D-116). Predvolene produkčný viewer forku;
 * na vyskúšanie PR forku pred zlúčením jeho Vercel náhľad, vybraný cez
 * `?viewer=pr-<číslo>` (alebo celú URL náhľadu). Povolené sú len produkčný
 * viewer a náhľady projektu `ifc-lite-viewer` v tíme assetinspaces, aby odkaz
 * nevložil cudzí viewer: host mu posiela AIM dáta (karty, dokumenty).
 *
 * Čisté funkcie bez prehliadača, testované v viewer-source.test.ts.
 */

/** Produkčný viewer forku; override celého deployu cez NEXT_PUBLIC_IFC_VIEWER_URL. */
export const PROD_VIEWER_URL =
  process.env.NEXT_PUBLIC_IFC_VIEWER_URL ?? "https://ifc-lite-viewer.vercel.app";

/** Host náhľadu Vercel projektu ifc-lite-viewer (per deploy aj per vetva). */
const PREVIEW_HOST = /^ifc-lite-viewer-[a-z0-9-]+-assetinspaces-projects\.vercel\.app$/;

/** Kľúč v sessionStorage: voľba prežije navigácie AI docku a MCP v tej istej karte. */
export const VIEWER_CHOICE_KEY = "aim.viewer";

export type ViewerChoice =
  | { kind: "prod" }
  | { kind: "pr"; number: number }
  | { kind: "url"; url: string };

/** Je to URL, ktorú smieme vložiť ako viewer? */
export function isAllowedViewerUrl(raw: string, dev = false): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (dev && u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return true;
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  let prod: URL | null = null;
  try {
    prod = new URL(PROD_VIEWER_URL);
  } catch {
    prod = null;
  }
  return (prod !== null && u.origin === prod.origin) || PREVIEW_HOST.test(u.hostname);
}

/**
 * Hodnota `?viewer=`: `pr-73` (alebo `73`), `prod`, alebo povolená URL.
 * Čokoľvek iné je null: neznáma hodnota nesmie potichu zmeniť viewer.
 */
export function parseViewerParam(raw: string | null | undefined, dev = false): ViewerChoice | null {
  const v = raw?.trim();
  if (!v) return null;
  if (v === "prod" || v === "produkcia") return { kind: "prod" };
  const pr = /^(?:pr-?)?(\d{1,6})$/i.exec(v);
  if (pr) return { kind: "pr", number: Number(pr[1]) };
  if (isAllowedViewerUrl(v, dev)) return { kind: "url", url: v };
  return null;
}

/** Hodnota do URL pre danú voľbu (inverzia parseViewerParam). */
export function viewerParamValue(choice: ViewerChoice): string {
  if (choice.kind === "prod") return "prod";
  if (choice.kind === "pr") return `pr-${choice.number}`;
  return choice.url;
}

/** Krátky popis pre čip nad viewerom. */
export function viewerChoiceLabel(choice: ViewerChoice): string {
  if (choice.kind === "prod") return "Produkcia";
  if (choice.kind === "pr") return `PR #${choice.number}`;
  try {
    return new URL(choice.url).hostname;
  } catch {
    return choice.url;
  }
}

/** Náhľad jedného otvoreného PR forku, ako ho vracia /api/viewer-previews. */
export interface ViewerPreview {
  number: number;
  title: string;
  branch: string;
  /** URL posledného úspešného náhľadu hlavy PR, null kým sa stavia alebo zlyhal. */
  url: string | null;
  updatedAt: string;
}
