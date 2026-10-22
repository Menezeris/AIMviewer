/**
 * Kedy studená inštancia MCP predčíta modely IFC motora (D-135, dodatok k D-100/D-101).
 *
 * Doteraz predčítala každá nová inštancia (34,5 MB, pri archíve 7,2 MB) a Vercel inštancie
 * recykluje často (19. až 21. 10.: 182 studených inštancií na 1 278 volaní), takže väčšina
 * stiahnutí padla na rozhovory, ktoré motor nepotrebovali. Teraz:
 * - volanie toolu motora predčíta vždy (rozhovor motor práve potrebuje);
 * - iná požiadavka predčíta, len ak niekto použil motor za posledných `ENGINE_WANT_WINDOW_MS`
 *   (`mcp_call_log`); overuje sa najviac raz za `WANT_CHECK_EVERY_MS` na inštanciu, v `after()`,
 *   takže DB tools na nič nečakajú;
 * - pomalý je tak len prvý prompt s motorom po pauze, ďalšie inštancie toho rozhovoru sa zahrejú
 *   ako doteraz.
 */

export const ENGINE_WANT_WINDOW_MS = 30 * 60_000;
export const WANT_CHECK_EVERY_MS = 60_000;

export interface EngineWarmState {
  /** Predčítanie v tejto inštancii beží alebo dobehlo. */
  preloaded: boolean;
  /** Kedy sa naposledy overovalo, či rozhovor motor používa (ms), null = nikdy. */
  checkedAt: number | null;
}

/** preload = načítaj modely; check = over v `mcp_call_log`, či motor niekto používa; skip = nič. */
export type EngineWarmDecision = "preload" | "check" | "skip";

/**
 * Rozhodnutie pre jednu požiadavku; vráti aj nový stav (zapíše sa hneď, aby súbežné
 * požiadavky tej istej inštancie nespúšťali kontrolu ani predčítanie dvakrát).
 * `engineCall` = požiadavka volá tool motora; `connect` = `initialize` / `tools/list`.
 */
export function engineWarmDecision(
  state: EngineWarmState,
  now: number,
  req: { engineCall: boolean; connect: boolean },
): { decision: EngineWarmDecision; state: EngineWarmState } {
  // Teplý motor: pri pripojení ho predčítanie len overí (HEAD), inak nič.
  if (state.preloaded) return { decision: req.connect ? "preload" : "skip", state };
  if (req.engineCall) return { decision: "preload", state: { ...state, preloaded: true } };
  if (state.checkedAt !== null && now - state.checkedAt < WANT_CHECK_EVERY_MS) return { decision: "skip", state };
  return { decision: "check", state: { ...state, checkedAt: now } };
}

/** Tool, ktorý vždy ide cez IFC motor (`ifc_*`, `search_all`, `calibrate_underlay`). */
export function isEngineTool(name: string, engineTools: ReadonlySet<string>): boolean {
  return engineTools.has(name) || name === "search_all" || name === "calibrate_underlay";
}

/** Mená volaných toolov v JSON-RPC správe alebo dávke (`tools/call` -> `params.name`). */
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
 * Volal niekto tool motora od `since`? Rozhoduje, či studená inštancia predčíta modely.
 * Chyba = false: radšej pomalší prvý prompt s motorom než stiahnutie navyše.
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
