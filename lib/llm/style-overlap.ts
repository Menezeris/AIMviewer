/**
 * Priority of overlapping `style_in_3d` rules (D-138, #221). The Lens in the viewer colors
 * by the first match. The host therefore sends the rules of a call in reverse order (`lensPriorityOrder`):
 * a LATER group in `groups` is on top, just as a newer call (mode=add) overrides an older one.
 * A specific route is thus written as the last group, broader colors (systems) before it.
 */

/** Order of rules for the wire: the first in the wire wins, so the last group of the call goes first. */
export function lensPriorityOrder<T>(rules: readonly T[]): T[] {
  return [...rules].reverse();
}

export interface RuleCount {
  name?: unknown;
  count?: unknown;
  inactive?: unknown;
}

/**
 * Warnings for rules without a hit from the rules returned by the viewer (order = from the highest
 * priority). A rule above which there is a rule with a hit may be covered; otherwise its filter found nothing.
 */
export function inactiveRuleWarnings(rules: unknown): string[] {
  if (!Array.isArray(rules)) return [];
  const rows = rules.filter((r): r is RuleCount => !!r && typeof r === "object");
  const out: string[] = [];
  rows.forEach((r, i) => {
    if (r.inactive !== true && !(typeof r.count === "number" && r.count === 0)) return;
    const name = typeof r.name === "string" && r.name ? r.name : `#${i + 1}`;
    const above = rows
      .slice(0, i)
      .filter((a) => typeof a.count === "number" && a.count > 0)
      .map((a) => String(a.name ?? "?"));
    out.push(
      above.length > 0
        ? `Pravidlo '${name}' nezafarbilo nič (0 prvkov). Buď ho prekryli pravidlá s vyššou prioritou (${above.join(", ")}; ` +
            "neskoršia skupina v groups a novšie volanie sú navrchu), alebo mu filter nič nenašiel. Presuň ho v groups " +
            "na koniec (alebo ho pošli ďalším volaním s mode=add), a ak ostane na 0, oprav filter."
        : `Pravidlo '${name}' nezafarbilo nič (0 prvkov): žiadne pravidlo s vyššou prioritou ho neprekrýva, filter nič nenašiel. ` +
            "Oprav filter (typ, systém, podlažie, ids) a povedz to používateľovi.",
    );
  });
  return out;
}
