/**
 * Časovač jedného volania MCP toolu (D-100): celkový čas a čas po fázach
 * (exec, broadcast, lens, readback, engine_load). Bez závislostí, aby sa dal
 * testovať aj použiť mimo route.
 */

export interface CallTimer {
  /** Zmeria `fn` ako fázu `name`; opakovaná fáza sa sčíta. */
  phase<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /** Pripíše už zmeraný čas (napr. načítanie modelu z cache motora). */
  add(name: string, ms: number): void;
  /** Celkový čas od štartu a fázy zaokrúhlené na ms. */
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
