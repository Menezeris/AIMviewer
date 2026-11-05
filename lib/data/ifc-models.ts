/**
 * List of the IFC models of the federation - a pure function without server dependencies, so that
 * the viewer (`lib/data/ifc.ts`), the IFC engine (`lib/engine`, D-084) and its scripts can share it.
 */

/** Public storage of the production Supabase project (fallback when no URL env is set). */
const DEFAULT_SUPABASE_URL = "https://acwoupricatirhlfkhvk.supabase.co";

/** Public object base of Supabase Storage (`<url>/storage/v1/object/public`). */
export function storagePublicBase(env: Record<string, string | undefined> = process.env): string {
  const url = (env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, "");
  return `${url}/storage/v1/object/public`;
}

/** One 3D model of the federation (D-049): a label for the UI + the public URL of the IFC file. */
export interface IfcModel {
  /** Model code within the project (`ASR`); the iframe `models=` and tools use it (D-189). */
  id: string;
  label: string;
  url: string;
  /** Current revision of the file (D-086), if the DB knows it. */
  revision?: number;
  /** The model's identity (D-189): `information_containers.id`. Missing only for env overrides. */
  containerId?: string;
}

/**
 * Key of a model in `model_revisions` = the file name in the bucket without `.ifc` (`.../ifc/ASR.ifc` -> `ASR`);
 * it also knows the revision archive (`.../ifc/archive/ASR/v078.ifc.gz` -> `ASR`, D-135).
 */
export function modelKey(url: string): string | null {
  const path = url.split(/[?#]/)[0];
  const m = /\/archive\/([^/]+)\/v\d+\.ifc\.gz$/i.exec(path) ?? /\/([^/]+)\.ifc$/i.exec(path);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Immutable archive of a revision (D-086) next to the current file: `.../ifc/ASR.ifc` + 78 ->
 * `.../ifc/archive/ASR/v078.ifc.gz`. The key does not change after upload (`immutable`, a year), so
 * the browser downloads the model once per revision, and gzip is about 5 times smaller (D-135).
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
 * The viewer reads the revision archive only with `NEXT_PUBLIC_IFC_ARCHIVE=1` (D-135): only the fork with D-135
 * can load gzip, so Samuel turns it on on Vercel after deploying the fork. Otherwise `?rev=` on the current key.
 */
export function archiveEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_IFC_ARCHIVE === "1";
}

/** Current revision of one model of a project (`model_revisions` + `container_revisions.location`). */
export interface ProjectModelRow {
  container_id: string;
  model: string;
  revision: number;
  /**
   * Archive path in Storage (`model_revisions.archive_path`): OCB `ifc/archive/ASR/v079.ifc.gz`, new
   * projects `ifc/archive/<container uuid>/vNNN.ifc.gz` (D-190); null when unknown.
   */
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
      // Current key next to the archive (`ifc/<dir>.ifc`, dir = code at OCB, container uuid in new
      // projects, D-190); without an archive path the OCB layout by code.
      const dir = r.location ? modelKey(`${base}/${r.location}`) : null;
      const current = new URL(`${base}/ifc/${encodeURIComponent(dir ?? r.model)}.ifc`);
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
 * "Label|url,Label|url" (or just "url,url"); legacy `NEXT_PUBLIC_IFC_URL` = one model.
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
