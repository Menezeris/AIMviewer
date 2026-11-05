import type { LiveAppliedPayload } from "./protocol";

/**
 * Browser bridge for live channel commands (D-101), pattern of `viewer-query-bus`.
 *
 * - The viewer on `/ifc` registers and executes commands (`focus`, `ops`) in
 *   place: no `router.push` and no server render of `/ifc` on every action.
 * - Without a viewer (another page) navigation goes as before and `cmdId`s wait
 *   until the viewer executes the ops after loading and acknowledges.
 * - The `APPLIED` acknowledgement from the fork goes back to the channel via `emitApplied`.
 */

export interface LiveApply {
  focus?: string;
  ops?: string;
  /** Action nonce (`r` in the URL): the soft-nav effect does not repeat the same command. */
  nonce?: string;
  cmdIds: string[];
}

type ApplyHandler = (a: LiveApply) => void;
type AppliedSink = (p: LiveAppliedPayload) => void;

let handler: ApplyHandler | null = null;
let sink: AppliedSink | null = null;
let pending: string[] = [];

/** Returns the unregister function - cancels only its own handler, not a later one. */
export function setLiveApplyHandler(h: ApplyHandler): () => void {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
}

/** true = executed in place; false = no viewer, the caller navigates (and defers the cmdId via `deferCmdIds`). */
export function applyLive(a: LiveApply): boolean {
  if (!handler) return false;
  handler(a);
  return true;
}

/** The command goes by navigation to `/ifc`: its cmdId is acknowledged by the viewer after executing the ops from the URL. */
export function deferCmdIds(ids: string[]): void {
  pending.push(...ids);
}

/** cmdIds of commands that arrived by navigation (the viewer acknowledges them after executing the ops from the URL). */
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

/**
 * `/ifc?focus&ops&r` -> command parts; another path (element card, drawing) = null. `project` (D-189) is
 * allowed: the caller applies in place only when it is the project of this window, otherwise it
 * navigates (the proxy switches the project).
 */
export function parseIfcCommandUrl(url: string): { focus?: string; ops?: string; nonce?: string; project?: string } | null {
  const u = new URL(url, "http://local");
  if (u.pathname !== "/ifc") return null;
  const pick = (k: string) => u.searchParams.get(k) || undefined;
  // Other parameters (doc, captures...) need a page - those stay with navigation.
  for (const k of u.searchParams.keys()) if (!["focus", "ops", "r", "project"].includes(k)) return null;
  return { focus: pick("focus"), ops: pick("ops"), nonce: pick("r"), project: pick("project") };
}

/**
 * A command may run in this window without navigation (D-189): it names no project, or the project
 * this window shows (`current` = the window's `?project=`, null = the default project).
 */
export function sameProject(command: string | undefined, current: string | null): boolean {
  return !command || command === current;
}

/**
 * Command URL for the project of the MCP request (D-189): pages of a non-default project carry
 * `?project=<code>`, the default project leaves the URL as it was.
 */
export function withProjectParam(url: string, code: string, defaultCode: string): string {
  if (code === defaultCode || !url.startsWith("/")) return url;
  const u = new URL(url, "http://local");
  u.searchParams.set("project", code);
  return `${u.pathname}${u.search}${u.hash}`;
}

/**
 * An address with a command (`?ops`, `?focus`) opened again by a page refresh or a history step
 * (also a restored browser tab), not by a new link: the command already ran once and the start must not
 * repeat it, otherwise the model loads e.g. sectioned (#313). `nav` = PerformanceNavigationTiming
 * of the document; applies only to the address the document was loaded with, not to later navigation in the app.
 */
export function isRestoredCommandUrl(nav: { type: string; name: string } | undefined, href: string): boolean {
  return !!nav && (nav.type === "reload" || nav.type === "back_forward") && nav.name === href;
}

/** Address without command parts (`focus`, `ops`, `r`), other parameters (e.g. `live`) stay. */
export function withoutCommandParams(href: string): string {
  const u = new URL(href);
  for (const k of ["focus", "ops", "r"]) u.searchParams.delete(k);
  return u.toString();
}
