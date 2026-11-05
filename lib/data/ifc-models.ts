/**
 * Zoznam IFC modelov federácie - čistá funkcia bez závislostí na serveri, aby ju
 * zdieľal viewer (`lib/data/ifc.ts`) aj IFC motor (`lib/engine`, D-084) a jeho skripty.
 */

/** Public storage of the production Supabase project (fallback when no URL env is set). */
const DEFAULT_SUPABASE_URL = "https://acwoupricatirhlfkhvk.supabase.co";

/** Public object base of Supabase Storage (`<url>/storage/v1/object/public`). */
export function storagePublicBase(env: Record<string, string | undefined> = process.env): string {
  const url = (env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, "");
  return `${url}/storage/v1/object/public`;
}

/** Jeden 3D model federácie (D-049): štítok pre UI + verejná URL IFC súboru. */
export interface IfcModel {
  /** Model code within the project (`ASR`); the iframe `models=` and tools use it (D-189). */
  id: string;
  label: string;
  url: string;
  /** Aktuálna revízia súboru (D-086), ak ju DB pozná. */
  revision?: number;
  /** The model's identity (D-189): `information_containers.id`. Missing only for env overrides. */
  containerId?: string;
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

/**
 * Viewer číta archív revízie len pri `NEXT_PUBLIC_IFC_ARCHIVE=1` (D-135): gzip vie načítať až
 * fork s D-135, preto ho Samuel zapne na Verceli po nasadení forku. Inak `?rev=` na aktuálnom kľúči.
 */
export function archiveEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_IFC_ARCHIVE === "1";
}

/**
 * Pripojí aktuálnu revíziu ku každému modelu, ktorý ju má (D-086). So zapnutým archívom
 * (`archiveEnabled`) URL ukáže na nemenný archív revízie (D-135), inak `?rev=N` na aktuálnom kľúči.
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

/** Current revision of one model of a project (`model_revisions` + `container_revisions.location`). */
export interface ProjectModelRow {
  container_id: string;
  model: string;
  revision: number;
  /** Archive path in Storage (`ifc/archive/ASR/v079.ifc.gz`), null when unknown. */
  location: string | null;
}

/**
 * IFC models of a project from the DB (D-189): one per container with a current revision, sorted
 * by code. No model code is assumed. With the archive (D-135) the URL is the revision's archive
 * location, otherwise the current key `ifc/<code>.ifc?rev=N` as before. The label is the code until
 * the naming decision (Samuel, 5 Nov).
 */
export function modelsFromRows(
  rows: ProjectModelRow[],
  opts: { archive?: boolean; base?: string } = {},
): IfcModel[] {
  const archive = opts.archive ?? archiveEnabled();
  const base = opts.base ?? storagePublicBase();
  return [...rows]
    .sort((a, b) => a.model.localeCompare(b.model))
    .map((r) => {
      const current = new URL(`${base}/ifc/${encodeURIComponent(r.model)}.ifc`);
      let url: string;
      if (archive && r.location) url = `${base}/${r.location.replace(/^\/+/, "")}`;
      else if (archive) url = archiveUrl(current.toString(), r.revision) ?? current.toString();
      else {
        current.searchParams.set("rev", String(r.revision));
        url = current.toString();
      }
      return { id: r.model, label: r.model, url, revision: r.revision, containerId: r.container_id };
    });
}

/**
 * Env override of the model list (local verification, D-135): `NEXT_PUBLIC_IFC_URLS` =
 * "Label|url,Label|url" (alebo len "url,url"); legacy `NEXT_PUBLIC_IFC_URL` = one model.
 * Without either null: the models come from the DB per project (D-189), nothing is hardcoded.
 */
export function envIfcModels(env: Record<string, string | undefined> = process.env): IfcModel[] | null {
  const multi = env.NEXT_PUBLIC_IFC_URLS;
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
  const single = env.NEXT_PUBLIC_IFC_URL;
  if (single) return [{ id: modelKey(single) ?? "m0", label: modelKey(single) ?? "Model", url: single }];
  return null;
}
