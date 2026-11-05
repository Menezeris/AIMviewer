/**
  * `view_state.ids_local` (D-162): IDS open in the IDS Studio and Data validation panels. For `get_viewer_state`
  * the document XML is dropped (it can have hundreds of kB, `ids_document from_viewer` is meant to read it); what remains is the code, version,
  * `dirty`, the size and the results of the last run per specification. No dependency on tools.
 */

const PARTS = ["studio", "validation"] as const;

/** Viewer state without document XML; undefined if the viewer does not report `ids_local` (nothing open or an older fork). */
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
