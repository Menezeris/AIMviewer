import { describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({ db: { tables: {} as Record<string, Record<string, unknown>[]> } }));

// Napodobená PostgREST nad riadkami v pamäti: eq/in/is/order/range.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (name: string) => ({
      select: () => {
        let rows = [...(db.tables[name] ?? [])];
        let range: [number, number] | null = null;
        const q = {
          eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
          in: (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), q),
          is: (c: string, v: unknown) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), q),
          order: () => q,
          range: (a: number, b: number) => ((range = [a, b]), q),
          then: (res: (v: unknown) => unknown) => res({ data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null }),
        };
        return q;
      },
    }),
  }),
}));

import { loadListHostValues } from "./list-host-values";

const edge = (relation: string, element_id: string, space_id: string, space_ref: string | null, role: string | null = "inside") => ({
  relation, element_id, space_id, space_ref, space_name: space_ref === null ? "Zasadačka" : `Miestnosť ${space_ref}`, role,
});
const obj = (id: string, ifc_guid: string | null, valid_until: string | null = null) => ({ id, ifc_guid, valid_until });

describe("loadListHostValues (D-174)", () => {
  it("referenced: GlobalId -> priestory (viac oddelené), partial označené, zaniknuté a bez GUID vynechané", async () => {
    db.tables = {
      v_space_elements: [
        edge("referenced", "e1", "s1", "3.02"),
        edge("referenced", "e1", "s2", "3.01", "partial"),
        edge("referenced", "e2", "s1", "3.02"),
        edge("referenced", "e3", "s1", "3.02"),
        edge("referenced", "e4", "s3", "9.99"),
        edge("referenced", "e5", "s1", "3.02"),
        edge("boundary", "e1", "s1", "3.02"),
      ],
      objects: [obj("e1", "G1"), obj("e2", "G2"), obj("e3", "G3", "2026-10-01"), obj("e4", "G4"), obj("e5", null), obj("s1", null), obj("s2", null), obj("s3", null, "2026-09-01")],
    };
    const out = await loadListHostValues("derived_referenced");
    expect(out.values).toEqual({ G1: "3.01 (čiastočne), 3.02", G2: "3.02" });
    expect(out).toMatchObject({ count: 2, truncated: false });
  });

  it("boundary číta len hranice a nepridáva 'čiastočne'; bez hrán prázdny výsledok", async () => {
    db.tables = {
      v_space_elements: [edge("boundary", "e1", "s1", "3.02", "physical"), edge("referenced", "e2", "s1", "3.02")],
      objects: [obj("e1", "G1"), obj("e2", "G2"), obj("s1", null)],
    };
    expect((await loadListHostValues("derived_boundary")).values).toEqual({ G1: "3.02" });
    db.tables = { v_space_elements: [], objects: [] };
    expect(await loadListHostValues("derived_referenced")).toEqual({ values: {}, count: 0, truncated: false });
  });

  it("priestor bez kódu použije názov", async () => {
    db.tables = { v_space_elements: [edge("referenced", "e1", "s1", null)], objects: [obj("e1", "G1"), obj("s1", null)] };
    expect((await loadListHostValues("derived_referenced")).values).toEqual({ G1: "Zasadačka" });
  });
});
