/**
  * When a cold MCP instance preloads the IFC engine models (D-135, addendum to D-100/D-101).
 *
  * Until now every new instance preloaded (34.5 MB, 7.2 MB with the archive) and Vercel recycles
  * instances often (19 to 21 Oct: 182 cold instances for 1,278 calls), so most of the
  * downloads fell on conversations that did not need the engine. Now:
  * - an engine tool call always preloads (the conversation needs the engine right now);
  * - another request preloads only if someone used the engine in the last `ENGINE_WANT_WINDOW_MS`
  *   (`mcp_call_log`); it is checked at most once per `WANT_CHECK_EVERY_MS` per instance, in `after()`,
  *   so the DB tools wait for nothing;
  * - so only the first prompt with the engine after a pause is slow, the other instances of that conversation warm up
  *   as before.
 */

export const ENGINE_WANT_WINDOW_MS = 30 * 60_000;
export const WANT_CHECK_EVERY_MS = 60_000;

export interface EngineWarmState {
    /** Preloading in this instance is running or has finished. */
  preloaded: boolean;
    /** When it was last checked whether the conversation uses the engine (ms), null = never. */
  checkedAt: number | null;
}

/** preload = load the models; check = verify in `mcp_call_log` whether anyone uses the engine; skip = nothing. */
export type EngineWarmDecision = "preload" | "check" | "skip";

/**
  * Decision for one request; also returns the new state (written immediately so that concurrent
  * requests of the same instance do not start the check or the preload twice).
  * `engineCall` = the request calls an engine tool; `connect` = `initialize` / `tools/list`.
 */
export function engineWarmDecision(
  state: EngineWarmState,
  now: number,
  req: { engineCall: boolean; connect: boolean },
): { decision: EngineWarmDecision; state: EngineWarmState } {
    // Warm engine: on connect the preload only verifies it (HEAD), otherwise nothing.
  if (state.preloaded) return { decision: req.connect ? "preload" : "skip", state };
  if (req.engineCall) return { decision: "preload", state: { ...state, preloaded: true } };
  if (state.checkedAt !== null && now - state.checkedAt < WANT_CHECK_EVERY_MS) return { decision: "skip", state };
  return { decision: "check", state: { ...state, checkedAt: now } };
}

/** A tool that always goes through the IFC engine (`ifc_*`, `search_all`, `calibrate_underlay`). */
export function isEngineTool(name: string, engineTools: ReadonlySet<string>): boolean {
  return engineTools.has(name) || name === "search_all" || name === "calibrate_underlay";
}

/** Names of the called tools in a JSON-RPC message or batch (`tools/call` -> `params.name`). */
export function payloadToolNames(payload: unknown): string[] {
  const msgs = Array.isArray(payload) ? payload : [payload];
  const out: string[] = [];
  for (const m of msgs) {
    if (!m || typeof m !== "object") continue;
    const { method, params } = m as { method?: unknown; params?: unknown };
    const name = (params as { name?: unknown } | undefined)?.name;
    if (method === "tools/call" && typeof name === "string") out.push(name);
  }
  return out;
}

/**
  * Did anyone call an engine tool since `since`? Decides whether a cold instance preloads the models.
  * Error = false: rather a slower first prompt with the engine than an extra download.
 */
export async function engineUsedSince(
  since: Date,
  tools: string[],
  query: (sinceIso: string, tools: string[]) => Promise<boolean>,
): Promise<boolean> {
  try {
    return await query(since.toISOString(), tools);
  } catch (err) {
    console.warn(`[mcp] engine use: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
