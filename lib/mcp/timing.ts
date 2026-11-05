/**
  * Timer of one MCP tool call (D-100): total time and time per phase
  * (exec, broadcast, lens, readback, engine_load). No dependencies, so it can be
  * tested and used outside the route.
 */

export interface CallTimer {
    /** Measures `fn` as phase `name`; a repeated phase is summed. */
  phase<T>(name: string, fn: () => Promise<T>): Promise<T>;
    /** Adds an already measured time (e.g. loading a model from the engine cache). */
  add(name: string, ms: number): void;
    /** Total time since the start and the phases rounded to ms. */
  done(): { ms: number; phases: Record<string, number> };
}

export function startTimer(now: () => number = () => performance.now()): CallTimer {
  const started = now();
  const phases: Record<string, number> = {};
  const add = (name: string, ms: number) => {
    phases[name] = (phases[name] ?? 0) + ms;
  };
  return {
    async phase(name, fn) {
      const t = now();
      try {
        return await fn();
      } finally {
        add(name, now() - t);
      }
    },
    add,
    done() {
      const rounded: Record<string, number> = {};
      for (const [k, v] of Object.entries(phases)) rounded[k] = Math.round(v);
      return { ms: Math.round(now() - started), phases: rounded };
    },
  };
}
