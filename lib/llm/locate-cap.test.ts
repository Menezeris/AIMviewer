/**
 * `search_objects mode=locate` nad viac ako 500 prvkami (eval loc-vzt-ducts-2np, D-183 K3): po K3 majú podlažie aj
 * prvky VZT (526 IfcDuctSegment). Strop 500 bez poradia dával rozpad po podlažiach z náhodnej vzorky
 * (2NP 239 namiesto 249); locate má načítať všetky prvky po stranách.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
/** Najviac riadkov na jednu odpoveď ako PostgREST max_rows. */
const MAX_ROWS = 1000;
let requests: { table: string; from: number; to: number }[] = [];

function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let order: string | null = null;
  let range: [number, number] | null = null;
  let limit = Infinity;
  let head = false;
  const b = {
    select: (_c?: string, o?: { head?: boolean }) => ((head = !!o?.head), b),
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
    ilike: (c: string, v: string) => (filters.push((r) => String(r[c] ?? "").toLowerCase() === v.toLowerCase()), b),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
    is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
    not: (c: string) => (filters.push((r) => (r[c] ?? null) !== null), b),
    or: () => b,
    order: (c: string) => ((order = c), b),
    range: (from: number, to: number) => ((range = [from, to]), b),
    limit: (n: number) => ((limit = n), b),
    then(resolve: (v: { data: Row[] | null; count?: number; error: null }) => unknown) {
      let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (head) return Promise.resolve(resolve({ data: null, count: rows.length, error: null }));
      const count = rows.length;
      if (order) rows = [...rows].sort((a, z) => (String(a[order!]) < String(z[order!]) ? -1 : 1));
      if (range) {
        requests.push({ table, from: range[0], to: range[1] });
        rows = rows.slice(range[0], range[1] + 1);
      }
      return Promise.resolve(resolve({ data: rows.slice(0, Math.min(limit, MAX_ROWS)), count, error: null }));
    },
  };
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: (t: string) => builder(t) }),
}));

const { AskToolRuntime } = await import("./tools");

const pad = (n: number) => String(n).padStart(5, "0");
const F2 = "f0000000-0000-4000-8000-000000000002";
const F3 = "f0000000-0000-4000-8000-000000000003";

beforeEach(() => {
  requests = [];
  // 1200 potrubí: každé tretie na 2NP (400), ostatné na 3NP (800).
  const ducts = Array.from({ length: 1200 }, (_, i) => ({
    id: `d0000000-0000-4000-8000-0000000${pad(i)}`,
    object_type: "asset",
    object_ref: `DUCT.${i}`,
    name: "PO.02",
    ifc_type: "IfcDuctSegment",
    predefined_type: "NOTDEFINED",
    valid_until: null,
  }));
  tables.objects = [
    ...ducts,
    { id: F2, object_type: "floor", object_ref: "2NP", name: "2NP", valid_until: null },
    { id: F3, object_type: "floor", object_ref: "3NP", name: "3NP", valid_until: null },
  ];
  tables.rel_contained_in_spatial_structure = ducts.map((d, i) => ({
    from_id: d.id,
    to_id: i % 3 === 0 ? F2 : F3,
    valid_until: null,
  }));
  tables.rel_aggregates = [];
});

describe("search_objects mode=locate nad 500 prvkov", () => {
  it("rozpad po podlažiach počíta všetky prvky, nie vzorku", async () => {
    const res = await new AskToolRuntime().exec("search_objects", { mode: "locate", ifc_type: "IfcDuctSegment" });
    expect(res.isError).toBe(false);
    const out = JSON.parse(res.content) as {
      total: number;
      located: number;
      truncated: boolean;
      by_floor: { floor: { name: string } | null; count: number }[];
    };
    expect(out.total).toBe(1200);
    expect(out.located).toBe(1200);
    expect(out.truncated).toBe(false);
    const byName = Object.fromEntries(out.by_floor.map((g) => [g.floor?.name ?? "-", g.count]));
    expect(byName).toEqual({ "2NP": 400, "3NP": 800 });
    // Stránky po 1000 so stabilným poradím (PostgREST max_rows).
    expect(requests.filter((r) => r.table === "objects")).toEqual([
      { table: "objects", from: 0, to: 999 },
      { table: "objects", from: 1000, to: 1199 },
    ]);
  });
});

describe("query_view nad pohľadom IFC vzťahu (rel-system-members)", () => {
  const SYS = "50000000-0000-4000-8000-000000000001";
  beforeEach(() => {
    tables.rel_assigns_to_group = [
      ...Array.from({ length: 4 }, (_, i) => ({ id: `m${i}`, from_id: `a${i}`, to_id: SYS, valid_until: null })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, from_id: null, to_id: SYS, global_id: `PORT-${i}`, valid_until: null })),
    ];
  });

  it("count_only vráti aj in_aim a only_in_file", async () => {
    const res = await new AskToolRuntime().exec("query_view", {
      relation: "rel_assigns_to_group",
      filters: [{ column: "to_id", op: "eq", value: SYS }],
      count_only: true,
    });
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content)).toMatchObject({ count: 10, in_aim: 4, only_in_file: 6 });
  });

  it("riadky: total všetkých dvojíc, in_aim pre počet prvkov AIM", async () => {
    const res = await new AskToolRuntime().exec("query_view", {
      relation: "rel_assigns_to_group",
      filters: [{ column: "to_id", op: "eq", value: SYS }],
    });
    const out = JSON.parse(res.content);
    expect(out.total).toBe(10);
    expect(out.in_aim).toBe(4);
    expect(out.hint_in_aim).toMatch(/prvkov AIM je 4/);
  });

  it("bez riadkov zo súboru nič nepridá", async () => {
    tables.rel_assigns_to_group = tables.rel_assigns_to_group.filter((r) => r.from_id !== null);
    const res = await new AskToolRuntime().exec("query_view", {
      relation: "rel_assigns_to_group",
      filters: [{ column: "to_id", op: "eq", value: SYS }],
      count_only: true,
    });
    expect(JSON.parse(res.content)).toEqual({ count: 4 });
  });
});
