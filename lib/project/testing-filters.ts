/**
 * Row predicates for the fake PostgREST builders of tests (D-189): the project filters the app sends
 * (`project_id.eq.X,project_id.is.null`, optionally `and(project_id..., or(text))`). Only what the
 * app's project scope uses is understood; anything else matches every row.
 */
import { TEST_PROJECT } from "./testing";

type Row = Record<string, unknown>;

/** A fixture row without `project_id` belongs to the test project (explicit null = global node). */
function cell(r: Row, col: string): unknown {
  return col === "project_id" && r.project_id === undefined ? TEST_PROJECT.id : r[col];
}

/** `eq` of the fake builders, with the fixture rule for `project_id`. */
export function rowEq(r: Row, col: string, v: unknown): boolean {
  return cell(r, col) === v;
}

function split(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of expr) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function term(t: string): (r: Row) => boolean {
  const and = /^and\((.*)\)$/.exec(t);
  if (and) {
    const parts = split(and[1]).map(term);
    return (r) => parts.every((p) => p(r));
  }
  const or = /^or\((.*)\)$/.exec(t);
  if (or) return orFilter(or[1]);
  const m = /^([a-z_]+)\.(eq|is|ilike)\.(.*)$/.exec(t);
  if (!m) return () => true;
  const [, col, op, v] = m;
  if (op === "is") return (r) => (cell(r, col) ?? null) === (v === "null" ? null : v);
  if (op === "eq") return (r) => String(cell(r, col)) === v;
  const re = new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");
  return (r) => re.test(String(r[col] ?? ""));
}

/** Predicate of a PostgREST `or` filter value. */
export function orFilter(expr: string): (r: Row) => boolean {
  const parts = split(expr).map(term);
  return (r) => parts.some((p) => p(r));
}
