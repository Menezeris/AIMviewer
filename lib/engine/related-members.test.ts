import { describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({ db: { tables: {} as Record<string, Record<string, unknown>[]> } }));

// Napodobená PostgREST nad riadkami v pamäti: in/is/order/range (D-126).
vi.mock("server-only", () => ({}));
vi.mock("../supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (name: string) => ({
      select: () => {
        let rows = [...(db.tables[name] ?? [])];
        let range: [number, number] | null = null;
        const q = {
          in: (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), q),
          is: (c: string, v: unknown) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), q),
          order: () => q,
          range: (a: number, b: number) => ((range = [a, b]), q),
          then: (res: (v: unknown) => unknown) =>
            res({ data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null }),
        };
        return q;
      },
    }),
  }),
}));

import { fetchRelatedMembers } from "./related-members";

const obj = (id: string, object_type: string, extra: Record<string, unknown> = {}) => ({
  id,
  object_type,
  object_ref: id,
  name: id,
  ifc_type: null,
  valid_until: null,
  ...extra,
});

describe("fetchRelatedMembers (search_all related)", () => {
  it("zóna -> priestory cez rel_assigns_to_group, aktér -> objekty, systém a zaniknutý člen nie", async () => {
    db.tables = {
      objects: [
        obj("Z", "zone"),
        obj("SYS", "system"),
        obj("ORG", "organization"),
        obj("S1", "space", { ifc_type: "IfcSpace" }),
        obj("S2", "space", { ifc_type: "IfcSpace" }),
        obj("S3", "space", { valid_until: "2026-10-01" }),
        obj("A1", "asset"),
      ],
      rel_assigns_to_group: [
        { id: "e1", from_id: "S1", to_id: "Z", valid_until: null },
        { id: "e2", from_id: "S2", to_id: "Z", valid_until: null },
        { id: "e3", from_id: "S3", to_id: "Z", valid_until: null },
        { id: "e4", from_id: "A1", to_id: "SYS", valid_until: null },
      ],
      rel_assigns_to_actor: [{ id: "e5", from_id: "ORG", to_id: "A1", valid_until: null }],
    };
    const out = await fetchRelatedMembers(["Z", "SYS", "ORG", "A1"]);
    expect(out.map((g) => [g.via, g.node.object_id, g.members_total, g.members.map((m) => m.object_id)])).toEqual([
      ["rel_assigns_to_group", "Z", 2, ["S1", "S2"]],
      ["rel_assigns_to_actor", "ORG", 1, ["A1"]],
    ]);
  });

  it("bez zón a aktérov medzi zhodami nevolá hrany", async () => {
    db.tables = { objects: [obj("A1", "asset")] };
    expect(await fetchRelatedMembers(["A1"])).toEqual([]);
  });
});
