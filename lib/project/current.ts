import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The one project resolver of the app (D-189). A project is the IfcProject node in `objects`
 * (`object_type = 'project'`); its `id` is the project id and its `object_ref` is the project
 * code (`IfcProject.Name`, e.g. `OCB`). Every request resolves its project once through here;
 * step 6 (shared sign-in) only changes where the code comes from.
 */
export interface Project {
  id: string;
  code: string;
  name: string;
}

/** Unknown project code or id: routes answer 404, pages `notFound()`. */
export class ProjectNotFoundError extends Error {
  readonly status = 404;
  constructor(readonly ref: string) {
    super(`Project '${ref}' does not exist.`);
    this.name = "ProjectNotFoundError";
  }
}

/** Cookie that keeps the project chosen with `?project=` for the browser session (D-189). */
export const PROJECT_COOKIE = "aim_project";
/** Request header the proxy sets from `?project=` or the cookie, so the first request sees it. */
export const PROJECT_HEADER = "x-aim-project";

const CODE_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A code that may reach the DB; anything else is treated as unknown. */
export function isProjectCode(code: string): boolean {
  return CODE_RE.test(code);
}

/** Default project from configuration (`AIM_DEFAULT_PROJECT`, default `OCB`). */
export function defaultProjectCode(env: Record<string, string | undefined> = process.env): string {
  const code = env.AIM_DEFAULT_PROJECT?.trim();
  return code ? code : "OCB";
}

/**
 * The code a request asks for: explicit value (URL `?project=`, proxy header, cookie) or the
 * default. Empty and `default` mean the default project.
 */
export function requestedProjectCode(
  ...candidates: (string | null | undefined)[]
): string {
  for (const c of candidates) {
    const v = c?.trim();
    if (!v) continue;
    if (v.toLowerCase() === "default") break;
    return v;
  }
  return defaultProjectCode();
}

const TTL_MS = 60_000;
const byCode = new Map<string, { project: Project; at: number }>();
const byId = new Map<string, { project: Project; at: number }>();

/** Test hook: forget cached projects. */
export function clearProjectCache(): void {
  byCode.clear();
  byId.clear();
}

type Loader = (key: { code?: string; id?: string }) => Promise<Project | null>;

async function loadFromDb(key: { code?: string; id?: string }): Promise<Project | null> {
  const { getSupabaseAdmin } = await import("@/lib/supabase/server");
  return loadProjectRow(getSupabaseAdmin(), key);
}

/** Reads the IfcProject node by code or id (live nodes only). */
export async function loadProjectRow(
  sb: SupabaseClient,
  key: { code?: string; id?: string },
): Promise<Project | null> {
  let q = sb
    .from("objects")
    .select("id, object_ref, name")
    .eq("object_type", "project")
    .is("valid_until", null);
  q = key.id ? q.eq("id", key.id) : q.eq("object_ref", key.code ?? "");
  const { data, error } = await q.limit(2);
  if (error) throw new Error(`objects (project): ${error.message}`);
  const rows = (data ?? []) as { id: string; object_ref: string | null; name: string | null }[];
  if (rows.length !== 1 || !rows[0].object_ref) return null;
  const r = rows[0];
  return { id: r.id, code: r.object_ref as string, name: r.name ?? (r.object_ref as string) };
}

/** Test hook slot on `globalThis`, so it survives `vi.resetModules()` in route tests. */
const LOADER_KEY = Symbol.for("aim.projectLoader");
type WithLoader = { [LOADER_KEY]?: Loader | null };
const loader: Loader = (key) => ((globalThis as WithLoader)[LOADER_KEY] ?? loadFromDb)(key);

/** Test hook: replace the DB loader (null = back to the DB). */
export function setProjectLoader(l: Loader | null): void {
  (globalThis as WithLoader)[LOADER_KEY] = l;
  clearProjectCache();
}

/**
 * `{ code }` or `{ id }` -> the project; without either the default project. Cached for 60 s
 * per instance (the same window as ISR, D-030). Unknown or invalid = `ProjectNotFoundError`.
 */
export async function resolveProject(
  key: { code?: string | null; id?: string | null } = {},
  now: () => number = Date.now,
): Promise<Project> {
  const id = key.id?.trim() || undefined;
  const code = id ? undefined : key.code?.trim() || defaultProjectCode();
  if (id !== undefined && !UUID_RE.test(id)) throw new ProjectNotFoundError(id);
  if (code !== undefined && !isProjectCode(code)) throw new ProjectNotFoundError(code);

  const cache = id ? byId : byCode;
  const ck = (id ?? code) as string;
  const hit = cache.get(ck);
  if (hit && now() - hit.at < TTL_MS) return hit.project;

  const project = await loader(id ? { id } : { code });
  if (!project) throw new ProjectNotFoundError(ck);
  const entry = { project, at: now() };
  byCode.set(project.code, entry);
  byId.set(project.id, entry);
  return project;
}
