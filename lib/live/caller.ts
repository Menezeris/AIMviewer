import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

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

const store = new AsyncLocalStorage<LiveCaller | null>();

export function withCaller<T>(caller: LiveCaller | null, fn: () => T): T {
  return store.run(caller, fn);
}

export function currentCaller(): LiveCaller | null {
  return store.getStore() ?? null;
}
