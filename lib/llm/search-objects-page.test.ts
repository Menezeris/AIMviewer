import { describe, expect, it, vi } from "vitest";

const { ROWS } = vi.hoisted(() => ({
  // 139 vyústiek ako v ASR+VZT (eval D-126, N2), id zoradené.
  ROWS: Array.from({ length: 139 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    object_type: "asset",
    // Dĺžky ako na produkcii: object_ref je IFC GlobalId (22 znakov), meno kód vyústky.
    object_ref: `21EwBzpoD2audfgTy${String(i).padStart(5, "0")}`,
    name: `VV.03.02.${String(i).padStart(3, "0")}`,
    ifc_type: "IfcAirTerminal",
    predefined_type: i < 2 ? "GRILLE" : "DIFFUSER",
  })) as Record<string, unknown>[],
}));

// Server-only moduly (D-026); objects vie is / ilike / order / range s presným počtom ako PostgREST.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => {
  const table = () => {
    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
    let from = 0;
    let to = Infinity;
    const rows = () => ROWS.filter((r) => filters.every((f) => f(r)));
    const q = {
      select: () => q,
      is: (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), q),
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
      ilike: (col: string, v: string) => (filters.push((r) => String(r[col]).toLowerCase() === v.toLowerCase()), q),
      or: () => q,
      order: () => q,
      range: (a: number, b: number) => ((from = a), (to = b), q),
      then: (res: (v: unknown) => unknown) => res({ data: rows().slice(from, to + 1), count: rows().length, error: null }),
    };
    return q;
  };
  return { getSupabaseAdmin: () => ({ from: table }) };
});

import { AskToolRuntime } from "./tools";

describe("search_objects mode=list stránkuje (eval D-126, N2)", () => {
  it("stránky idú za sebou bez medzery: všetkých 139, hoci 100 riadkov sa do výsledku nezmestí", async () => {
    const rt = new AskToolRuntime();
    const seen: string[] = [];
    let offset: number | null = 0;
    let pages = 0;
    while (offset !== null) {
      const res = await rt.exec("search_objects", { ifc_type: "IfcAirTerminal", limit: 100, offset });
      expect(res.content).not.toContain("(orezané)");
      const page = JSON.parse(res.content);
      expect(page).toMatchObject({ total: 139, offset, returned: page.rows.length });
      seen.push(...page.rows.map((r: { object_ref: string }) => r.object_ref));
      offset = page.next_offset;
      pages += 1;
    }
    expect(new Set(seen).size).toBe(139);
    // 139 pri strope 100 sú aspoň 2 strany; bez vynechaných stĺpcov boli 3 (63 riadkov na stranu).
    expect(pages).toBe(2);
  });

  it("stĺpce určené filtrom sú raz v same, riadky ich nemajú", async () => {
    const res = JSON.parse((await new AskToolRuntime().exec("search_objects", { predefined_type: "GRILLE" })).content);
    expect(res).toMatchObject({ total: 2, truncated: false, same: { predefined_type: "GRILLE" } });
    expect(res.rows.map((r: { name: string }) => r.name)).toEqual(["VV.03.02.000", "VV.03.02.001"]);
    expect(res.rows[0]).not.toHaveProperty("predefined_type");
    expect(res.rows[0]).toHaveProperty("ifc_type", "IfcAirTerminal");
  });

  it("bez filtra stĺpca ostáva pole celých riadkov, prázdny výsledok radí fulltext", async () => {
    const all = JSON.parse((await new AskToolRuntime().exec("search_objects", { query: "VV", limit: 5 })).content);
    expect(all).toMatchObject({ total: 139, returned: 5 });
    expect(all).not.toHaveProperty("same");
    expect(all.rows[0]).toHaveProperty("ifc_type");
    const none = JSON.parse((await new AskToolRuntime().exec("search_objects", { ifc_type: "IfcDoor" })).content);
    expect(none).toMatchObject({ rows: [] });
    expect(none.hint).toContain("search_everything");
  });
});
