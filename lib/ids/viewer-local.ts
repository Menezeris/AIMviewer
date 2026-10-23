/**
 * `view_state.ids_local` (D-162): IDS otvorené v paneloch IDS Studio a Data validation. Pre `get_viewer_state`
 * sa XML dokumentov vyhodí (môže mať stovky kB, čítať ho má `ids_document from_viewer`); ostane kód, verzia,
 * `dirty`, veľkosť a výsledky posledného behu po špecifikáciách. Bez závislosti na tools.
 */

const PARTS = ["studio", "validation"] as const;

/** Stav viewera bez XML dokumentov; undefined, ak viewer `ids_local` nehlási (nič otvorené alebo starší fork). */
export function compactIdsLocal(state: unknown): Record<string, unknown> | undefined {
  const raw = state && typeof state === "object" ? (state as Record<string, unknown>).ids_local : undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of PARTS) {
    const part = (raw as Record<string, unknown>)[key];
    if (!part || typeof part !== "object" || Array.isArray(part)) continue;
    const { xml, ...rest } = part as Record<string, unknown>;
    out[key] = { ...rest, ...(typeof xml === "string" ? { xml_available: true } : {}) };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
