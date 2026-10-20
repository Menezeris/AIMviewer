/**
 * Čisté časti dokumentov objektu (D-104): tvar záznamu, zlúčenie riadkov
 * `v_object_documents` a texty pre AIM kartu. Bez `server-only`, lebo
 * `lib/aim-panel.ts` beží aj v prehliadači; čítanie z DB je v `object-documents.ts`.
 *
 * Pohľad vracia riadok pre každú cestu (zóna aj nadradená zóna); tu z nich je
 * jeden záznam na dokument a stranu s najbližšou cestou, ďalší nositelia idú do
 * `alsoVia`.
 */

/** Uzol, ktorý pri čítaní padol do rúk (dokument alebo nositeľ). */
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
  /** Druh nositeľa: direct | type | zone | group | system | spatial_zone | floor | space. */
  via: string;
  /** Nositeľ dokumentu (zóna, skupina, podlažie...). */
  viaName?: string;
  /** Najbližší nositeľ k objektu, ak je iný (NJ - 3NP pod Nájomné priestory). */
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

/** Riadky pohľadu (zoradené podľa hĺbky) -> jeden záznam na dokument a stranu. */
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
      // Ten istý dokument aj cez ďalšieho nositeľa (napr. zóna aj nadradená zóna).
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

/** Cesta po slovensky pre kartu: "priamo", "cez zónu Nájomné priestory (NJ - 3NP)". */
export function viaText(d: Pick<ObjectDocument, "via" | "viaName" | "through">): string {
  if (d.via === "direct") return "priamo";
  const what = VIA_LABEL[d.via] ?? d.via;
  return `cez ${what}${d.viaName ? ` ${d.viaName}` : ""}${d.through ? ` (${d.through})` : ""}`;
}

/** Druh dokumentu (D-104: typ informácie ISO 19650, napr. DR Výkres). */
export interface DocumentType {
  code: string;
  name: string | null;
}

/** "DR Výkres" (kód a meno), alebo len kód. */
export function typeText(t: DocumentType | undefined): string | undefined {
  return t ? [t.code, t.name].filter(Boolean).join(" ") : undefined;
}
