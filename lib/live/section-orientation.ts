/**
 * A section in the viewer state carries the render frame `axis` (y = height) and `crosses` (which IFC axis the section crosses).
 * The agent read the orientation wrongly from it (eval #97 E4: a vertical section on IFC Y was described as horizontal),
 * so the state gets a derived `orientation`: a section across IFC Z (height) is horizontal, otherwise vertical.
 */
export function withSectionOrientation(state: unknown): unknown {
  if (!state || typeof state !== "object") return state;
  const s = state as { section?: unknown };
  const section = s.section as { crosses?: unknown; orientation?: unknown } | null | undefined;
  if (!section || typeof section !== "object" || typeof section.crosses !== "string" || section.orientation) return state;
  const orientation = /IFC Z/.test(section.crosses) ? "vodorovný" : "zvislý";
  return { ...s, section: { orientation, ...section } };
}
