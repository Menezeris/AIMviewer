/**
 * Guard (D-189): every query of a project-bound table or view in the app names the project. A chain
 * `.from("<relation>")` must carry `project_id` (filter, insert row, `.or(projectOrGlobal(...))`) or
 * the revision key `model_revision_id`, or go through `scopeQuery` / `applyObjectFilters`. Anything
 * else is an explicit exception below, with its reason. Dynamic relations (`.from(view)`) are not
 * seen here; they use `scopeQuery` or a literal filter.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { isProjectScoped } from "./scope";

const ROOT = join(__dirname, "..", "..");

/** `file:relation` -> why it reads across projects on purpose. */
const EXCEPTIONS: Record<string, string> = {
  "app/health/page.tsx:objects": "connection test: counts all live objects of the database",
  "lib/project/current.ts:objects": "the resolver itself: finds the IfcProject node by code or id",
  "lib/mcp/call-log.ts:mcp_call_log":
    "the row carries project_id (built by the route); engine warmth looks at every project of the instance",
};

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const SCOPED = /project_id|model_revision_id|projectOrGlobal\(/;

/** Unscoped `.from("<relation>")` chains of one source text: [relation, line]. */
export function unscopedChains(src: string): [string, number][] {
  const out: [string, number][] = [];
  const re = /\.from\(\s*"([a-z_]+)"\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (!isProjectScoped(m[1])) continue;
    const before = src.slice(Math.max(0, m.index - 80), m.index);
    if (/(scopeQuery|applyObjectFilters)\([\s\w.()]*$/.test(before)) continue;
    // The chain runs to the end of the statement (or a blank line).
    const chain = src.slice(m.index, m.index + 1200).split(/;\s*\n|\n\s*\n/)[0];
    if (SCOPED.test(chain)) continue;
    out.push([m[1], src.slice(0, m.index).split("\n").length]);
  }
  return out;
}

describe("project scope guard (D-189)", () => {
  it("detects an unscoped chain and accepts the scoped forms", () => {
    expect(unscopedChains(`db.from("objects").select("id").eq("id", x);`)).toEqual([["objects", 1]]);
    expect(unscopedChains(`db.from("rel_aggregates").select("id").eq("project_id", p);`)).toEqual([]);
    expect(unscopedChains(`db.from("objects").select("id").or(projectOrGlobal(p));`)).toEqual([]);
    expect(unscopedChains(`db.from("ifc_rev_objects").select("x").eq("model", m);`)).toEqual([]);
    expect(unscopedChains(`db.from("rel_member_of").select("x");`)).toEqual([]);
    expect(unscopedChains(`db.from("persons").select("x");`)).toEqual([]);
  });

  it("no project-bound table or view is queried without project_id", () => {
    const offenders: string[] = [];
    for (const f of [...files(join(ROOT, "lib")), ...files(join(ROOT, "app"))]) {
      const rel = relative(ROOT, f).replace(/\\/g, "/");
      for (const [relation, line] of unscopedChains(readFileSync(f, "utf8"))) {
        if (!EXCEPTIONS[`${rel}:${relation}`]) offenders.push(`${rel}:${line} ${relation}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
