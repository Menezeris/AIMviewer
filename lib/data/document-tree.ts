/**
 * Dokumenty z IFC (D-101) - čisté pomocné funkcie bez DB, zdieľané server-side
 * dátovou vrstvou (knižnica dokumentov, odkaz na stranu) a testované samostatne.
 */

/**
 * Strana, ktorú označuje IfcDocumentReference: fragment `#page=N` v `Location`
 * (tvar z ASR, `…VYPIS-SKLADIEB.pdf#page=3`), inak `Identification` `page=N`.
 */
export function referencePage(
  location: string | null,
  identification: string | null
): number | null {
  for (const text of [location?.split("#")[1], identification]) {
    const m = text ? /(?:^|[&;])page=(\d+)/.exec(text) : null;
    const page = m ? Number.parseInt(m[1], 10) : NaN;
    if (page >= 1) return page;
  }
  return null;
}

/**
 * Priečinok dokumentu v knižnici = mená nadradených dokumentov zo stromu
 * dokumentácie (`rel_document_information_relationship`, časť → nadradený),
 * zhora nadol. Koreň (celá PD) sa vynecháva, keď je nad ním ešte časť - inak by
 * bol jediným priečinkom pre všetko.
 */
export function documentFolder(
  docId: string,
  parentOf: ReadonlyMap<string, string>,
  nameOf: ReadonlyMap<string, string>
): string[] {
  const chain: string[] = [];
  const seen = new Set<string>([docId]);
  for (let p = parentOf.get(docId); p && !seen.has(p); p = parentOf.get(p)) {
    seen.add(p);
    chain.unshift(nameOf.get(p) ?? p);
  }
  return chain.length > 1 ? chain.slice(1) : chain;
}
