import "server-only";

import { withProject } from "@/lib/live/caller";
import {
  PROJECT_COOKIE,
  PROJECT_HEADER,
  ProjectNotFoundError,
  requestedProjectCode,
  resolveProject,
  type Project,
} from "@/lib/project/current";
import { projectModelsShort } from "@/lib/project/models";

/** Value of one cookie from a `Cookie` header. */
export function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Project code of an API request (D-189): `?project=` on the URL, then the proxy header, then the
 * session cookie, then the default (`AIM_DEFAULT_PROJECT`, `OCB`). `cookies: false` = the MCP
 * connector, which has only its URL.
 */
export function requestProjectCode(req: Request, opts: { cookies?: boolean } = {}): string {
  let param: string | null = null;
  try {
    param = new URL(req.url).searchParams.get("project");
  } catch {
    param = null;
  }
  if (param !== null) return requestedProjectCode(param === "" ? "default" : param);
  if (opts.cookies === false) return requestedProjectCode();
  return requestedProjectCode(req.headers.get(PROJECT_HEADER), cookieValue(req.headers.get("cookie"), PROJECT_COOKIE));
}

export function projectNotFoundResponse(e: ProjectNotFoundError): Response {
  return Response.json({ error: e.message }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

/** Resolves the request project and runs `fn` with it (and its models) in the request context. */
export async function runWithRequestProject<T>(
  project: Project,
  fn: () => Promise<T> | T,
): Promise<T> {
  const models = await projectModelsShort(project.id).catch(() => null);
  return withProject(project, fn, models);
}

/**
 * Wrapper of an API route handler (D-189): the project is resolved once per request and rides in
 * the request context (`currentProject()`), with the project's models for the IFC engine. Unknown
 * project = 404.
 */
export function withRequestProject<A extends [Request, ...unknown[]]>(
  handler: (...args: A) => Promise<Response> | Response,
  opts: {
    cookies?: boolean;
    /** Project code carried by the route itself (BCF path); null = the usual sources. */
    code?: (...args: A) => Promise<string | null> | string | null;
  } = {},
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    let project: Project;
    try {
      const own = opts.code ? await opts.code(...args) : null;
      project = await resolveProject({ code: own ?? requestProjectCode(args[0], opts) });
    } catch (e) {
      if (e instanceof ProjectNotFoundError) return projectNotFoundResponse(e);
      throw e;
    }
    return runWithRequestProject(project, () => handler(...args));
  };
}
