/**
 * `list_relations` nad pohľadmi IFC vzťahov z kópie revízie (D-183 K3): strana bez uzla AIM sa vráti
 * ako GlobalId alebo kľúč zo súboru (`in_aim: false`), strany s uzlom AIM idú pred ňou.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

/** PostgREST builder: eq / in / is / order (nullsFirst) / limit. */
function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  const orders: { col: string; nullsFirst: boolean }[] = [];
  let limit = Infinity;
  const b = {
    select: () => b,
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
    is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
    order: (col: string, o?: { nullsFirst?: boolean }) => (orders.push({ col, nullsFirst: !!o?.nullsFirst }), b),
    limit: (n: number) => ((limit = n), b),
    then(resolve: (v: { data: Row[]; error: null }) => unknown) {
      let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      rows = [...rows].sort((a, z) => {
        for (const { col, nullsFirst } of orders) {
          const x = a[col] ?? null;
          const y = z[col] ?? null;
          if (x === y) continue;
          if (x === null) return nullsFirst ? -1 : 1;
          if (y === null) return nullsFirst ? 1 : -1;
          return String(x) < String(y) ? -1 : 1;
        }
        return 0;
      });
      return Promise.resolve(resolve({ data: rows.slice(0, limit), error: null }));
    },
  };
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: (t: string) => builder(t) }),
}));

const { AskToolRuntime } = await import("./tools");

const SYS = "00000000-0000-4000-8000-000000000001";
const VYU = "00000000-0000-4000-8000-000000000002";
const DOOR = "00000000-0000-4000-8000-000000000003";

beforeEach(() => {
  tables.objects = [
    { id: SYS, object_type: "system", object_ref: "SYS.1", name: "Prívod 1" },
    { id: VYU, object_type: "asset", object_ref: "VV.1", name: "vyústka" },
    { id: DOOR, object_type: "asset", object_ref: "DD01.01.01", name: "dvere" },
  ].map((o) => ({ ...o, ifc_type: null, predefined_type: null, valid_until: null }));
  tables.rel_assigns_to_group = [
    { id: "g1", from_id: null, to_id: SYS, global_id: "PORT-1", group_global_id: "G-SYS", valid_until: null },
    { id: "g2", from_id: VYU, to_id: SYS, global_id: "G-VYU", group_global_id: "G-SYS", valid_until: null },
  ];
  tables.rel_associates_classification = [
    { id: "k1", from_id: DOOR, to_id: null, global_id: "G-DOOR", classification_key: "IfcClassificationReference:XX99", valid_until: null },
  ];
  tables.classification_references = [];
});

async function run(input: Record<string, unknown>) {
  const res = await new AskToolRuntime().exec("list_relations", input);
  expect(res.isError).toBe(false);
  return JSON.parse(res.content);
}

describe("list_relations nad kópiou revízie (D-183 K3)", () => {
  it("člen s uzlom AIM pred portom bez uzla, port ako GlobalId", async () => {
    const out = await run({ rel_type: "rel_assigns_to_group", to_id: SYS });
    const rows = (out.rows ?? out) as { from: Row; to: Row }[];
    expect(rows.map((r) => r.from.object_ref ?? r.from.global_id)).toEqual(["VV.1", "PORT-1"]);
    expect(rows[1].from).toEqual({ id: null, global_id: "PORT-1", in_aim: false });
    expect(rows[1].to.object_ref).toBe("SYS.1");
  });

  it("klasifikácia bez referencie v AIM vráti kľúč zo súboru", async () => {
    const out = await run({ rel_type: "rel_associates_classification", from_id: DOOR });
    const rows = (out.rows ?? out) as { from: Row; to: Row }[];
    expect(rows[0].to).toEqual({ id: null, key: "IfcClassificationReference:XX99", in_aim: false });
  });
});
