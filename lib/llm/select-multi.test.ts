import { describe, expect, it, vi } from "vitest";

// Viacnásobný výber (#217): DB je maketa, ktorá k object_ref vráti uzol a GUID.
vi.mock("server-only", () => ({}));

const OBJECTS: Record<string, { id: string; object_type: string; object_ref: string; name: string }> = {
  "1.02": { id: "11111111-1111-4111-8111-111111111111", object_type: "space", object_ref: "1.02", name: "Retail 1" },
  "1.03": { id: "22222222-2222-4222-8222-222222222222", object_type: "space", object_ref: "1.03", name: "Retail 2" },
};
const GUIDS: Record<string, string> = {
  "11111111-1111-4111-8111-111111111111": "0AAAAAAAAAAAAAAAAAAAA1",
  "22222222-2222-4222-8222-222222222222": "0BBBBBBBBBBBBBBBBBBBB2",
};

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const filters: Record<string, string> = {};
      const q = {
        select: () => q,
        eq: (col: string, v: string) => ((filters[col] = v), q),
        is: () => q,
        limit: async () => {
          if (table === "objects") {
            const row = Object.values(OBJECTS).find((o) => o.object_ref === filters.object_ref || o.id === filters.id);
            return { data: row ? [row] : [], error: null };
          }
          const guid = GUIDS[filters.object_id];
          return { data: guid ? [{ ifc_guid: guid }] : [], error: null };
        },
      };
      return q;
    },
  }),
}));

import { AskToolRuntime } from "./tools";

const opsOf = (url: string) => new URL(url, "http://x").searchParams.get("ops");

describe("show_in_3d select=true s viac prvkami (#217)", () => {
  it("označí všetky a vráti zoznam všetkých", async () => {
    const rt = new AskToolRuntime();
    const res = await rt.exec("show_in_3d", { select: true, ids_or_refs: ["1.02", "1.03"] });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content)).toMatchObject({
      ok: true,
      selected: ["1.02", "1.03"],
      selected_count: 2,
      ifc_guids: ["0AAAAAAAAAAAAAAAAAAAA1", "0BBBBBBBBBBBBBBBBBBBB2"],
    });
    expect(opsOf(rt.finalActions()[0].url as string)).toBe("select::0AAAAAAAAAAAAAAAAAAAA1.0BBBBBBBBBBBBBBBBBBBB2");
  });

  it("UUID aj duplicity: každý prvok raz", async () => {
    const rt = new AskToolRuntime();
    const res = await rt.exec("show_in_3d", {
      select: true,
      ids_or_refs: ["11111111-1111-4111-8111-111111111111", "1.02", "1.03"],
    });
    expect(JSON.parse(res.content)).toMatchObject({ selected_count: 2 });
  });

  it("jeden prvok ostáva ako doteraz (selected je text)", async () => {
    const rt = new AskToolRuntime();
    const res = await rt.exec("show_in_3d", { select: true, ids_or_refs: ["1.02"] });
    const out = JSON.parse(res.content);
    expect(out).toMatchObject({ ok: true, selected: "1.02", ifc_guid: "0AAAAAAAAAAAAAAAAAAAA1" });
    expect(out.selected_count).toBeUndefined();
    expect(opsOf(rt.finalActions()[0].url as string)).toBe("select::0AAAAAAAAAAAAAAAAAAAA1");
  });
});
