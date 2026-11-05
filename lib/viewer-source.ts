/**
 * Which viewer is embedded in /ifc (D-116). By default the production viewer of the fork;
 * to try out a fork PR before merging, its Vercel preview, chosen via
 * `?viewer=pr-<number>` (or the full preview URL). Only the production
 * viewer and previews of the `ifc-lite-viewer` project in the assetinspaces team are allowed, so that a link
 * cannot embed a foreign viewer: the host sends it AIM data (cards, documents).
 *
 * Pure functions without a browser, tested in viewer-source.test.ts.
 */

/** Production viewer of the fork; override of the whole deploy via NEXT_PUBLIC_IFC_VIEWER_URL. */
export const PROD_VIEWER_URL =
  process.env.NEXT_PUBLIC_IFC_VIEWER_URL ?? "https://ifc-lite-viewer.vercel.app";

/** Host of a preview of the ifc-lite-viewer Vercel project (per deploy and per branch). */
const PREVIEW_HOST = /^ifc-lite-viewer-[a-z0-9-]+-assetinspaces-projects\.vercel\.app$/;

/** Key in sessionStorage: the choice survives AI dock and MCP navigations in the same tab. */
export const VIEWER_CHOICE_KEY = "aim.viewer";

export type ViewerChoice =
  | { kind: "prod" }
  | { kind: "pr"; number: number }
  | { kind: "url"; url: string };

/**
 * Page address after "Vyčistiť uložený stav a načítať znova" (clear saved state and reload) (D-163): without `?viewer=`,
 * so that the PR preview choice (e.g. an already closed one) from the link is not saved again.
 */
export function urlWithoutViewerChoice(href: string): string {
  const u = new URL(href);
  u.searchParams.delete("viewer");
  return u.toString();
}

/** Is it a URL we may embed as the viewer? */
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
 * Value of `?viewer=`: `pr-73` (or `73`), `prod`, or an allowed URL.
 * Anything else is null: an unknown value must not silently change the viewer.
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

/** Value for the URL for the given choice (inverse of parseViewerParam). */
export function viewerParamValue(choice: ViewerChoice): string {
  if (choice.kind === "prod") return "prod";
  if (choice.kind === "pr") return `pr-${choice.number}`;
  return choice.url;
}

/** Short description for the chip above the viewer. */
export function viewerChoiceLabel(choice: ViewerChoice): string {
  if (choice.kind === "prod") return "Produkcia";
  if (choice.kind === "pr") return `PR #${choice.number}`;
  try {
    return new URL(choice.url).hostname;
  } catch {
    return choice.url;
  }
}

/** Preview of one open PR of the fork, as returned by /api/viewer-previews. */
export interface ViewerPreview {
  number: number;
  title: string;
  branch: string;
  /** URL of the last successful preview of the PR head, null while it is building or failed. */
  url: string | null;
  updatedAt: string;
}
