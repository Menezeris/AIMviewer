import { revalidateTag, unstable_cache } from "next/cache";

/**
 * ISR cache per project (D-030, D-189): every cached read is tagged `aim` (ETL clears everything)
 * and `aim:<projectId>` (a write in one project clears only that project).
 */
export function projectTag(projectId: string): string {
  return `aim:${projectId}`;
}

/** `unstable_cache` options of a project read: the project id must also be an argument (key). */
export function projectCache(projectId: string): { revalidate: number; tags: string[] } {
  return { revalidate: 60, tags: ["aim", projectTag(projectId)] };
}

/** After a write in the app: clears the cached reads of that project at once. */
export function revalidateProject(projectId: string): void {
  revalidateTag(projectTag(projectId), { expire: 0 });
}

/**
 * A cached read of one project (D-189): `impl(projectId, ...args)` behind `unstable_cache` with the
 * project id in the key (also as the first argument) and the project tag. ALS does not reach into
 * cached functions, so the project is always explicit.
 */
export function cachedProjectRead<A extends unknown[], R>(
  key: string,
  impl: (projectId: string, ...args: A) => Promise<R>,
): (projectId: string, ...args: A) => Promise<R> {
  return (projectId: string, ...args: A): Promise<R> =>
    unstable_cache(impl, [key, projectId], projectCache(projectId))(projectId, ...args);
}
