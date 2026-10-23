import { beforeEach, describe, expect, it, vi } from "vitest";

import { orderTerms, pageInfo, parseRelated, sortRows } from "./query-view";

const { db } = vi.hoisted(() => ({ db: { tables: {} as Record<string, Record<string, unknown>[]>, calls: [] as string[] } }));

// Napodobená PostgREST: filtre, poradie a range nad riadkami v pamäti (D-126).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => {
  const builder = (name: string, cols: string, opts?: { count?: string; head?: boolean }) => {
    let rows = [...(db.tables[name] ?? [])];
    const pick = (r: Record<string, unknown>) =>
      cols === "*" ? r : Object.fromEntries(cols.split(", ").map((c) => [c, r[c]]));
    const orders: { col: string; asc: boolean }[] = [];
    let range: [number, number] | null = null;
    let lim: number | null = null;
    const q = {
      eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
      is: (c: string, v: unknown) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), q),
      in: (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), q),
      order: (col: string, o?: { ascending?: boolean }) => (orders.push({ col, asc: o?.ascending !== false }), q),
      range: (a: number, b: number) => ((range = [a, b]), q),
      limit: (n: number) => ((lim = n), q),
      then: (res: (v: unknown) => unknown) => {
        db.calls.push(name);
        const total = rows.length;
        let out = [...rows].sort((x, y) => {
          for (const o of orders) {
            const a = String(x[o.col]);
            const b = String(y[o.col]);
            if (a !== b) return (a < b ? -1 : 1) * (o.asc ? 1 : -1);
          }
          return 0;
        });
        if (range) out = out.slice(range[0], range[1] + 1);
        if (lim !== null) out = out.slice(0, lim);
        out = out.map(pick);
        return res({ data: opts?.head ? null : out, count: opts?.count ? total : null, error: null });
      },
    };
    return q;
  };
  return {
    getSupabaseAdmin: () => ({
      from: (name: string) => ({ select: (cols: string, opts?: { count?: string; head?: boolean }) => builder(name, cols, opts) }),
    }),
  };
});

import { AskToolRuntime } from "./tools";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SPACE = uuid(9999);

beforeEach(() => {
  db.calls = [];
  // 139 vyústiek v náhodnom poradí (DB bez order vracia ľubovoľne), 133 hrán na priestor.
  const terminals = Array.from({ length: 139 }, (_, i) => ({
    id: uuid(((i * 37) % 139) + 1),
    object_type: "asset",
    object_ref: `AT-${i}`,
    name: `Vyústka ${i}`,
    ifc_type: "IfcAirTerminal",
    valid_until: null,
  }));
  const doors = Array.from({ length: 5 }, (_, i) => ({
    id: uuid(500 + i),
    object_type: "asset",
    object_ref: `D-${i}`,
    name: null,
    ifc_type: "IfcDoor",
    valid_until: null,
  }));
  db.tables = {
    objects: [...terminals, ...doors, { id: SPACE, object_type: "space", object_ref: "2.01", name: "2.01", ifc_type: "IfcSpace", valid_until: null }],
    rel_referenced_in_spatial_structure: [
      ...terminals.slice(0, 16).map((t, i) => ({ id: uuid(3000 + i), from_id: t.id, to_id: SPACE, valid_until: null })),
      ...doors.map((d, i) => ({ id: uuid(4000 + i), from_id: d.id, to_id: SPACE, valid_until: null })),
    ],
  };
});

const run = async (input: Record<string, unknown>) => {
  const rt = new AskToolRuntime();
  const res = await rt.exec("query_view", input);
  return { ...res, json: res.isError ? null : JSON.parse(res.content) };
};

describe("query_view stránkovanie (D-126, #181)", () => {
  it("hlási total, truncated a next_offset; strany sa neprekrývajú a spolu dajú všetko", async () => {
    const filters = [{ column: "ifc_type", op: "eq", value: "IfcAirTerminal" }];
    const p1 = await run({ relation: "objects", filters, select: ["id"], limit: 100 });
    expect(p1.json).toMatchObject({ total: 139, returned: 100, truncated: true, next_offset: 100 });
    const p2 = await run({ relation: "objects", filters, select: ["id"], limit: 100, offset: p1.json.next_offset });
    expect(p2.json).toMatchObject({ total: 139, returned: 39, truncated: false, next_offset: null });
    const ids = [...p1.json.rows, ...p2.json.rows].map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(139);
  });

  it("za order pridá kľúč relácie, takže rovnaké hodnoty majú stále poradie", async () => {
    const a = await run({ relation: "objects", order: { column: "ifc_type" }, select: ["id"], limit: 10 });
    const b = await run({ relation: "objects", order: { column: "ifc_type" }, select: ["id"], limit: 10 });
    expect(a.json.rows).toEqual(b.json.rows);
    expect(orderTerms("objects", { column: "ifc_type", ascending: true }).map((t) => t.column)).toEqual(["ifc_type", "id"]);
    expect(orderTerms("v_space_elements", null).map((t) => t.column)).toEqual(["space_id", "element_id", "relation"]);
  });

  it("related: prvky typu X so vzťahom na priestor Y jedným volaním (podľa object_ref)", async () => {
    const res = await run({
      relation: "objects",
      related: { relation: "rel_referenced_in_spatial_structure", node: "2.01" },
      filters: [{ column: "ifc_type", op: "eq", value: "IfcAirTerminal" }],
      select: ["object_ref"],
    });
    expect(res.json).toMatchObject({ total: 16, returned: 16, truncated: false });
    const count = await run({
      relation: "objects",
      related: { relation: "rel_referenced_in_spatial_structure", node: SPACE },
      count_only: true,
    });
    expect(count.json).toEqual({ count: 21 });
  });

  it("D-156: v_space_elements nesie relation=boundary a rel_space_boundary sa dá čítať aj cez related", async () => {
    const door = db.tables.objects.find((o) => o.object_ref === "D-0")!.id as string;
    db.tables.v_space_elements = [
      { space_ref: "1.01", element_ref: "D-0", element_ifc_type: "IfcDoor", relation: "boundary", role: "physical" },
      { space_ref: "1.01", element_ref: "D-1", element_ifc_type: "IfcDoor", relation: "contained", role: null },
    ];
    db.tables.rel_space_boundary = [{ id: uuid(7000), from_id: door, to_id: SPACE, role: "physical", valid_until: null }];
    const view = await run({
      relation: "v_space_elements",
      filters: [{ column: "space_ref", op: "eq", value: "1.01" }],
      select: ["element_ref", "relation", "role"],
    });
    expect(view.json.rows).toContainEqual({ element_ref: "D-0", relation: "boundary", role: "physical" });
    const rel = await run({ relation: "rel_space_boundary", select: ["from_id", "role"] });
    expect(rel.json.rows).toEqual([{ from_id: door, role: "physical" }]);
    const related = await run({
      relation: "objects",
      related: { relation: "rel_space_boundary", node: "2.01" },
      select: ["object_ref"],
    });
    expect(related.json.rows.map((r: { object_ref: string }) => r.object_ref)).toEqual(["D-0"]);
  });

  it("nepodporovaný vstup je chyba, nie ticho ignorovaný", async () => {
    expect((await run({ relation: "objects", offset: -1 })).isError).toBe(true);
    expect((await run({ relation: "objects", order: { column: "a;drop" } })).isError).toBe(true);
    expect((await run({ relation: "objects", filters: ["ifc_type"] })).isError).toBe(true);
    expect((await run({ relation: "objects", related: { relation: "relationships", node: "2.01" } })).isError).toBe(true);
    expect((await run({ relation: "v_space_elements", related: { relation: "rel_aggregates", node: "2.01" } })).isError).toBe(true);
    const missing = await run({ relation: "objects", related: { relation: "rel_aggregates", node: "nie-je" } });
    expect(missing.content).toContain("nie je object_ref");
  });
});

describe("pomocné funkcie", () => {
  it("parseRelated: predvolený smer to, neznámy kľúč je chyba", () => {
    const rels = new Set(["rel_assigns_to_group"]);
    expect(parseRelated({ relation: "rel_assigns_to_group", node: "Z1" }, "objects", rels)).toEqual({
      relation: "rel_assigns_to_group",
      node: "Z1",
      direction: "to",
    });
    expect(() => parseRelated({ relation: "rel_assigns_to_group", node: "Z1", depth: 2 }, "objects", rels)).toThrow(/depth/);
    expect(parseRelated(undefined, "objects", rels)).toBeNull();
  });

  it("sortRows: null na konci, zostupne obráti", () => {
    const rows = [{ a: null, id: "2" }, { a: "x", id: "1" }, { a: "x", id: "0" }];
    expect(sortRows(rows, [{ column: "a", ascending: true }, { column: "id", ascending: true }]).map((r) => r.id)).toEqual(["0", "1", "2"]);
    expect(pageInfo(10, 5, 5)).toEqual({ total: 10, returned: 5, offset: 5, truncated: false, next_offset: null });
  });
});
