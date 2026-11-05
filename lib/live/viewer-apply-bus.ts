import type { LiveAppliedPayload } from "./protocol";

/**
 * Most v prehliadači pre príkazy živého kanála (D-101), vzor `viewer-query-bus`.
 *
 * - Viewer na `/ifc` sa zaregistruje a príkazy (`focus`, `ops`) vykoná na
 *   mieste: bez `router.push` a bez serverového renderu `/ifc` pri každom úkone.
 * - Bez viewera (iná stránka) ide navigácia ako doteraz a `cmdId` počkajú,
 *   kým viewer po načítaní ops vykoná a potvrdí.
 * - Potvrdenie `APPLIED` z forku ide späť do kanála cez `emitApplied`.
 */

export interface LiveApply {
  focus?: string;
  ops?: string;
  /** Nonce akcie (`r` v URL): efekt soft-nav ten istý príkaz už nezopakuje. */
  nonce?: string;
  cmdIds: string[];
}

type ApplyHandler = (a: LiveApply) => void;
type AppliedSink = (p: LiveAppliedPayload) => void;

let handler: ApplyHandler | null = null;
let sink: AppliedSink | null = null;
let pending: string[] = [];

/** Vráti odregistrovanie - zruší len vlastný handler, nie neskorší. */
export function setLiveApplyHandler(h: ApplyHandler): () => void {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
}

/** true = vykonané na mieste; false = nie je viewer, volajúci naviguje (a cmdId odloží cez `deferCmdIds`). */
export function applyLive(a: LiveApply): boolean {
  if (!handler) return false;
  handler(a);
  return true;
}

/** Príkaz ide navigáciou na `/ifc`: jeho cmdId potvrdí viewer po vykonaní ops z URL. */
export function deferCmdIds(ids: string[]): void {
  pending.push(...ids);
}

/** cmdId príkazov, ktoré prišli navigáciou (viewer ich potvrdí po vykonaní ops z URL). */
export function takePendingCmdIds(): string[] {
  const out = pending;
  pending = [];
  return out;
}

export function setAppliedSink(s: AppliedSink): () => void {
  sink = s;
  return () => {
    if (sink === s) sink = null;
  };
}

export function emitApplied(p: LiveAppliedPayload): void {
  sink?.(p);
}

/** `/ifc?focus&ops&r` -> časti príkazu; iná cesta (karta prvku, výkres) = null. */
export function parseIfcCommandUrl(url: string): { focus?: string; ops?: string; nonce?: string } | null {
  const u = new URL(url, "http://local");
  if (u.pathname !== "/ifc") return null;
  const pick = (k: string) => u.searchParams.get(k) || undefined;
  // Iné parametre (doc, captures...) potrebujú stránku - tie ostanú navigácii.
  for (const k of u.searchParams.keys()) if (!["focus", "ops", "r"].includes(k)) return null;
  return { focus: pick("focus"), ops: pick("ops"), nonce: pick("r") };
}

/**
 * Adresa s príkazom (`?ops`, `?focus`) otvorená znova obnovou stránky alebo krokom v histórii
 * (aj obnovená karta prehliadača), nie novým odkazom: príkaz už raz prebehol a štart ho nemá
 * zopakovať, inak sa model načíta napr. prerezaný (#313). `nav` = PerformanceNavigationTiming
 * dokumentu; platí len pre adresu, ktorou sa dokument načítal, nie pre neskoršiu navigáciu v appke.
 */
export function isRestoredCommandUrl(nav: { type: string; name: string } | undefined, href: string): boolean {
  return !!nav && (nav.type === "reload" || nav.type === "back_forward") && nav.name === href;
}

/** Adresa bez častí príkazu (`focus`, `ops`, `r`), ostatné parametre (napr. `live`) ostanú. */
export function withoutCommandParams(href: string): string {
  const u = new URL(href);
  for (const k of ["focus", "ops", "r"]) u.searchParams.delete(k);
  return u.toString();
}
