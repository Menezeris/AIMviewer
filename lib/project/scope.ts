/**
 * PostgREST filter for "this project or global" (D-189): persons and organizations (and edges
 * between them) have no project and are visible in every project. Use with `.or(...)`.
 */
export function projectOrGlobal(projectId: string): string {
  return `project_id.eq.${projectId},project_id.is.null`;
}

/** Tables that carry `project_id` (D-189, SCHEMA §2.23); their children take the parent's project. */
export const PROJECT_TABLES: ReadonlySet<string> = new Set([
  "objects",
  "relationships",
  "information_containers",
  "model_revisions",
  "model_tasks",
  "saved_views",
  "clash_tests",
  "clash_runs",
  "ids_documents",
  "ids_runs",
  "derivation_runs",
  "verification_runs",
  "icdd_imports",
  "drawing_link_overrides",
  "ifc_guid_aliases",
  "mcp_call_log",
]);

/** Views with `project_id` as the last column (every `v_*`, `rel_*`, `aim_rel_*` and the GUID/revision views). */
const PROJECT_VIEWS = new Set(["ifc_guid_node", "ifc_rev_current", "ifc_storey_map"]);

/**
 * Does a table or view carry `project_id` (D-189)? `rel_member_of` is between global nodes (persons
 * and organizations), so it has none to filter by.
 */
export function isProjectScoped(relation: string): boolean {
  if (relation === "rel_member_of") return false;
  return PROJECT_TABLES.has(relation) || PROJECT_VIEWS.has(relation) || /^(v_|rel_|aim_rel_)/.test(relation);
}

/**
 * Adds the project filter to a query of a dynamic relation when it has `project_id` (generic
 * helpers that read objects, rel views and suffix tables alike).
 */
export function scopeQuery<Q>(q: Q, relation: string, projectId: string): Q {
  if (!isProjectScoped(relation)) return q;
  // An unconstrained Q keeps the PostgREST builder types shallow (a structural bound is too deep).
  return (q as unknown as { eq: (column: string, value: string) => Q }).eq("project_id", projectId);
}
