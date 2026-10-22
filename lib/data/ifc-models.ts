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

/**
 * Kľúč modelu v `model_revisions` = meno súboru v buckete bez `.ifc` (`…/ifc/ASR.ifc` → `ASR`);
 * pozná aj archív revízie (`…/ifc/archive/ASR/v078.ifc.gz` → `ASR`, D-135).
 */
export function modelKey(url: string): string | null {
  const path = url.split(/[?#]/)[0];
  const m = /\/archive\/([^/]+)\/v\d+\.ifc\.gz$/i.exec(path) ?? /\/([^/]+)\.ifc$/i.exec(path);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Nemenný archív revízie (D-086) vedľa aktuálneho súboru: `…/ifc/ASR.ifc` + 78 →
 * `…/ifc/archive/ASR/v078.ifc.gz`. Kľúč sa po nahratí nemení (`immutable`, rok), takže
 * prehliadač model stiahne raz na revíziu, a gzip je cca 5-krát menší (D-135).
 */
export function archiveUrl(url: string, revision: number): string | null {
  const key = modelKey(url);
  if (key === null || /\.gz$/i.test(url.split(/[?#]/)[0])) return null;
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  u.pathname = u.pathname.replace(/[^/]+$/, `archive/${encodeURIComponent(key)}/v${String(revision).padStart(3, "0")}.ifc.gz`);
  return u.toString();
}

/** Viewer číta archív revízie (D-135); `NEXT_PUBLIC_IFC_ARCHIVE=0` vráti `?rev=` na aktuálnom kľúči. */
export function archiveEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_IFC_ARCHIVE !== "0";
}

/**
 * Pripojí aktuálnu revíziu ku každému modelu, ktorý ju má (D-086). Predvolene URL
 * ukáže na nemenný archív revízie (D-135); bez archívu `?rev=N` na aktuálnom kľúči.
 * Obe zmenia `src` iframe viewera, takže po novej revízii sa model načíta znova a
 * cache prehliadača nevráti starý súbor. Model bez revízie ostáva bez zmeny.
 */
export function withRevisions(
  models: IfcModel[],
  current: { model: string; revision: number }[],
  opts: { archive?: boolean } = {},
): IfcModel[] {
  const archive = opts.archive ?? archiveEnabled();
  const byKey = new Map(current.map((r) => [r.model, r.revision]));
  return models.map((m) => {
    const key = modelKey(m.url);
    const revision = key ? byKey.get(key) : undefined;
    if (revision === undefined) return m;
    const archived = archive ? archiveUrl(m.url, revision) : null;
    if (archived) return { ...m, url: archived, revision };
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
