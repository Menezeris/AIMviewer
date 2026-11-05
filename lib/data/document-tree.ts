/**
 * Documents from IFC (D-104) - pure helper functions without DB, shared by the server-side
 * data layer (document library, page reference) and tested separately.
 */

/**
 * The page denoted by an IfcDocumentReference: the fragment `#page=N` in `Location`
 * (shape from ASR, `...VYPIS-SKLADIEB.pdf#page=3`), otherwise `Identification` `page=N`.
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
 * Folder of a document in the library = names of parent documents from the documentation
 * tree (`rel_document_information_relationship`, part -> parent),
 * top-down. The root (the whole PD) is omitted when there is still a part above it - otherwise it
 * would be the only folder for everything.
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
