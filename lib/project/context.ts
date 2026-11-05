import { AsyncLocalStorage } from "node:async_hooks";

import type { IfcModel } from "@/lib/data/ifc-models";
import type { Project } from "@/lib/project/current";

/**
 * Request context of the app (D-159 caller, D-189 project). No `server-only` here so that the IFC
 * engine and its tests can read the request models; `lib/live/caller.ts` re-exports it for server code.
 */

/**
 * Kto volá tool konektora (D-159): rozhovor (`sid` z `Mcp-Session-Id`), meno klienta a či ide
 * o pracovnú session. Route ho nastaví na celú požiadavku, živý kanál (`liveChannel`, príkazy aj
 * otázky viewera) ho číta bez prevliekania cez každú funkciu.
 */
export interface LiveCaller {
  /** Rozhovor; bez neho (klient nevrátil `Mcp-Session-Id`) viewer príkaz prijme ako doteraz. */
  sid?: string;
  client: string;
  /** Pracovná session (Claude Code) = testovací kanál, nikdy živý viewer používateľa. */
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

function ctx(): RequestContext {
  return store.getStore() ?? { caller: null, project: null, models: null };
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
  const p = store.getStore()?.project;
  if (!p) throw new Error("No project in the request context (D-189): wrap the handler in withRequestProject.");
  return p;
}

export function currentProjectId(): string {
  return currentProject().id;
}

/** The request project or null (callers that have their own fallback). */
export function maybeCurrentProject(): Project | null {
  return store.getStore()?.project ?? null;
}

/** Models of the request project, or null when the request did not load them. */
export function currentModels(): IfcModel[] | null {
  return store.getStore()?.models ?? null;
}
