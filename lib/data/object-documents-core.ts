/**
 * Pure parts of the documents of an object (D-104): the record shape, merging of the rows of
 * `v_object_documents` and the texts for the AIM card. Without `server-only`, because
 * `lib/aim-panel.ts` also runs in the browser; the DB read is in `object-documents.ts`.
 *
 * The view returns a row for each path (a zone and a parent zone); here they are turned into
 * one record per document and page with the nearest path, other carriers go to
 * `alsoVia`.
 */

/** A node that fell into the reader's hands (a document or a carrier). */
export interface ObjectDocumentNode {
  id: string;
  object_type: string;
  object_ref: string | null;
  name: string | null;
}

export interface ObjectDocument {
  documentId: string;
  name: string | null;
  identification: string | null;
  page?: number;
  /** Kind of carrier: direct | type | zone | group | system | spatial_zone | floor | space. */
  via: string;
  /** Carrier of the document (zone, group, storey...). */
  viaName?: string;
  /** The carrier nearest to the object, if different (NJ - 3NP under "Nájomné priestory", rental spaces). */
  through?: string;
  alsoVia?: string[];
}

export interface ViewRow {
  document_id: string;
  page: number | null;
  via: string;
  via_id: string | null;
  via_nearest_id: string | null;
}

/** View rows (sorted by depth) -> one record per document and page. */
export function dedupeObjectDocuments(
  rows: readonly ViewRow[],
  nodes: ReadonlyMap<string, ObjectDocumentNode>,
): ObjectDocument[] {
  const label = (id: string | null) =>
    id ? nodes.get(id)?.name ?? nodes.get(id)?.object_ref ?? id : undefined;
  const out = new Map<string, ObjectDocument>();
  for (const r of rows) {
    const key = `${r.document_id}:${r.page ?? ""}`;
    const holder = label(r.via_id);
    const seen = out.get(key);
    if (seen) {
      // The same document also via another carrier (e.g. a zone and a parent zone).
      if (holder && holder !== seen.viaName && !seen.alsoVia?.includes(holder)) {
        seen.alsoVia = [...(seen.alsoVia ?? []), holder];
      }
      continue;
    }
    const doc = nodes.get(r.document_id);
    const through = r.via_nearest_id && r.via_nearest_id !== r.via_id ? label(r.via_nearest_id) : undefined;
    out.set(key, {
      documentId: r.document_id,
      name: doc?.name ?? null,
      identification: doc?.object_ref ?? null,
      ...(r.page ? { page: r.page } : {}),
      via: r.via,
      ...(holder ? { viaName: holder } : {}),
      ...(through ? { through } : {}),
    });
  }
  return [...out.values()];
}

const VIA_LABEL: Record<string, string> = {
  type: "typ",
  zone: "zónu",
  group: "skupinu",
  system: "systém",
  spatial_zone: "priestorovú zónu",
  floor: "podlažie",
  space: "miestnosť",
};

/** Path in Slovak for the card: "priamo" (directly), "cez zónu Nájomné priestory (NJ - 3NP)" (via the zone Rental spaces). */
export function viaText(d: Pick<ObjectDocument, "via" | "viaName" | "through">): string {
  if (d.via === "direct") return "priamo";
  const what = VIA_LABEL[d.via] ?? d.via;
  return `cez ${what}${d.viaName ? ` ${d.viaName}` : ""}${d.through ? ` (${d.through})` : ""}`;
}

/** Kind of document (D-104: information type ISO 19650, e.g. DR Výkres). */
export interface DocumentType {
  code: string;
  name: string | null;
}

/** "DR Výkres" (code and name), or just the code. */
export function typeText(t: DocumentType | undefined): string | undefined {
  return t ? [t.code, t.name].filter(Boolean).join(" ") : undefined;
}
