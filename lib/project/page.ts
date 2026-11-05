import "server-only";

import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";

import {
  PROJECT_COOKIE,
  PROJECT_HEADER,
  ProjectNotFoundError,
  requestedProjectCode,
  resolveProject,
  type Project,
} from "@/lib/project/current";

/**
 * Project of a page render (D-189): the proxy header (`?project=` of this request), then the
 * session cookie, then the default. Unknown project = 404. One lookup per render (React `cache`);
 * cached reads take `project.id` as an argument.
 */
export const currentPageProject = cache(async (): Promise<Project> => {
  const [h, c] = await Promise.all([headers(), cookies()]);
  const code = requestedProjectCode(h.get(PROJECT_HEADER), c.get(PROJECT_COOKIE)?.value);
  try {
    return await resolveProject({ code });
  } catch (e) {
    if (e instanceof ProjectNotFoundError) notFound();
    throw e;
  }
});
