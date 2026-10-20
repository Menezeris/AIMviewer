/**
 * Rez v stave viewera nesie `axis` render rámca (y = výška) a `crosses` (ktorú os IFC rez pretína).
 * Agent z toho čítal orientáciu zle (eval #97 E4: zvislý rez na IFC Y opísal ako vodorovný),
 * preto stav dostane odvodené `orientation`: rez cez IFC Z (výšku) je vodorovný, inak zvislý.
 */
export function withSectionOrientation(state: unknown): unknown {
  if (!state || typeof state !== "object") return state;
  const s = state as { section?: unknown };
  const section = s.section as { crosses?: unknown; orientation?: unknown } | null | undefined;
  if (!section || typeof section !== "object" || typeof section.crosses !== "string" || section.orientation) return state;
  const orientation = /IFC Z/.test(section.crosses) ? "vodorovný" : "zvislý";
  return { ...s, section: { orientation, ...section } };
}
