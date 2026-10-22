/**
 * Priorita prekrývajúcich sa pravidiel `style_in_3d` (D-138, #221). Lens vo viewera farbí
 * prvou zhodou. Host preto posiela pravidlá volania v opačnom poradí (`lensPriorityOrder`):
 * NESKORŠIA skupina v `groups` je navrchu, rovnako ako novšie volanie (mode=add) prebije staršie.
 * Konkrétna trasa sa teda zapíše ako posledná skupina, širšie farby (systémy) pred ňu.
 */

/** Poradie pravidiel pre wire: prvé vo wire vyhráva, tak posledná skupina volania ide dopredu. */
export function lensPriorityOrder<T>(rules: readonly T[]): T[] {
  return [...rules].reverse();
}

export interface RuleCount {
  name?: unknown;
  count?: unknown;
  inactive?: unknown;
}

/**
 * Varovania pre pravidlá bez zásahu z pravidiel, ktoré vrátil viewer (poradie = od najvyššej
 * priority). Pravidlo, nad ktorým je pravidlo so zásahom, môže byť prekryté; inak mu filter nič nenašiel.
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
