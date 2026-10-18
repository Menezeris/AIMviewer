/**
 * Zoznam IFC modelov federácie - čistá funkcia bez závislostí na serveri, aby ju
 * zdieľal viewer (`lib/data/ifc.ts`) aj IFC motor (`lib/engine`, D-084) a jeho skripty.
 */

const IFC_STORAGE_BASE =
  "https://acwoupricatirhlfkhvk.supabase.co/storage/v1/object/public/ifc";

/** Jeden 3D model federácie (D-049): štítok pre UI + verejná URL IFC súboru. */
export interface IfcModel {
  id: string;
  label: string;
  url: string;
  /** Aktuálna revízia súboru (D-086), ak ju DB pozná. */
  revision?: number;
}

/** Kľúč modelu v `model_revisions` = meno súboru v buckete bez `.ifc` (`…/ifc/ASR.ifc` → `ASR`). */
export function modelKey(url: string): string | null {
  const path = url.split(/[?#]/)[0];
  const m = /\/([^/]+)\.ifc$/i.exec(path);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Pripojí aktuálnu revíziu ku každému modelu, ktorý ju má (D-086): `?rev=N` v URL
 * zmení `src` iframe viewera, takže po novej revízii sa model načíta znova a cache
 * prehliadača nevráti starý súbor. Model bez revízie ostáva bez zmeny.
 */
export function withRevisions(
  models: IfcModel[],
  current: { model: string; revision: number }[],
): IfcModel[] {
  const byKey = new Map(current.map((r) => [r.model, r.revision]));
  return models.map((m) => {
    const key = modelKey(m.url);
    const revision = key ? byKey.get(key) : undefined;
    if (revision === undefined) return m;
    const url = new URL(m.url);
    url.searchParams.set("rev", String(revision));
    return { ...m, url: url.toString(), revision };
  });
}

/**
 * IFC modely na render (D-044/D-049). Geometria je klient-side ephemerálna
 * (Postgres sa jej nedotýka); spojka na dáta = IFC GUID cez `guidMap`.
 * Default = ARCH (ASR) + vzduchotechnika (VZT) federované do jednej scény.
 * Override: `NEXT_PUBLIC_IFC_URLS` = "Label|url,Label|url" (alebo len "url,url");
 * legacy `NEXT_PUBLIC_IFC_URL` = jeden model.
 */
export function getIfcModels(): IfcModel[] {
  const multi = process.env.NEXT_PUBLIC_IFC_URLS;
  if (multi) {
    return multi
      .split(",")
      .map((entry, i) => {
        const [a, b] = entry.split("|");
        const url = (b ?? a).trim();
        const label = (b ? a : `Model ${i + 1}`).trim();
        return { id: `m${i}`, label, url };
      })
      .filter((m) => m.url.length > 0);
  }
  const single = process.env.NEXT_PUBLIC_IFC_URL;
  if (single) return [{ id: "ASR", label: "Architektúra", url: single }];
  return [
    { id: "ASR", label: "Architektúra", url: `${IFC_STORAGE_BASE}/ASR.ifc` },
    { id: "VZT", label: "Vzduchotechnika", url: `${IFC_STORAGE_BASE}/VZT.ifc` },
  ];
}
