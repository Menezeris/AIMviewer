import { AsyncLocalStorage } from "node:async_hooks";

import type { IfcModel } from "@/lib/data/ifc-models";
import type { Project } from "@/lib/project/current";

/**
 * Request context of the app (D-159 caller, D-189 project). No `server-only` here so that the IFC
 * engine and its tests can read the request models; `lib/live/caller.ts` re-exports it for server code.
 */

/**
  * Who calls a connector tool (D-159): the conversation (`sid` from `Mcp-Session-Id`), the client name and whether it is
  * a working session. The route sets it for the whole request, the live channel (`liveChannel`, commands and
  * viewer questions) reads it without threading it through every function.
 */
export interface LiveCaller {
    /** Conversation; without it (the client did not return `Mcp-Session-Id`) the viewer accepts the command as before. */
  sid?: string;
  client: string;
    /** Working session (Claude Code) = test channel, never the user's live viewer. */
  work: boolean;
}

/**
 * Request context (D-189): the caller and the project of the request. The project is set once
 * per request (`withRequestProject` in `lib/api-guard.ts`, the MCP route); cached reads never
 * read it from here (ALS inside `unstable_cache` does not work), they take `projectId` as an
 * argument.
 */
interface RequestContext {
  caller: LiveCaller | null;
  project: Project | null;
  /** IFC models of the project with their current revision, loaded once per request. */
  models: IfcModel[] | null;
}

const store = new AsyncLocalStorage<RequestContext>();

/**
 * Test-only fallback context (vitest setup), on `globalThis` so it survives `vi.resetModules()`;
 * never set in the app, where a request sets its own.
 */
const TEST_KEY = Symbol.for("aim.testRequestContext");
type WithTest = { [TEST_KEY]?: RequestContext | null };

/** vitest: the context code sees outside `withProject` (fixture project and models); null clears it. */
export function setTestRequestContext(c: { project: Project; models?: IfcModel[] | null } | null): void {
  if (!process.env.VITEST) throw new Error("setTestRequestContext is for tests only.");
  (globalThis as WithTest)[TEST_KEY] = c ? { caller: null, project: c.project, models: c.models ?? null } : null;
}

function stored(): RequestContext | undefined {
  return store.getStore() ?? (globalThis as WithTest)[TEST_KEY] ?? undefined;
}

function ctx(): RequestContext {
  return stored() ?? { caller: null, project: null, models: null };
}

export function withCaller<T>(caller: LiveCaller | null, fn: () => T): T {
  return store.run({ ...ctx(), caller }, fn);
}

export function currentCaller(): LiveCaller | null {
  return store.getStore()?.caller ?? null;
}

/** Runs `fn` with the request project (and optionally its models); keeps the caller. */
export function withProject<T>(project: Project, fn: () => T, models: IfcModel[] | null = null): T {
  return store.run({ ...ctx(), project, models }, fn);
}

/** The request project; throws outside a request that resolved one (no silent default). */
export function currentProject(): Project {
  const p = stored()?.project;
  if (!p) throw new Error("No project in the request context (D-189): wrap the handler in withRequestProject.");
  return p;
}

export function currentProjectId(): string {
  return currentProject().id;
}

/** The request project or null (callers that have their own fallback). */
export function maybeCurrentProject(): Project | null {
  return stored()?.project ?? null;
}

/** Models of the request project, or null when the request did not load them. */
export function currentModels(): IfcModel[] | null {
  return stored()?.models ?? null;
}
