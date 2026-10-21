import { describe, expect, it, vi } from "vitest";

const { ROWS } = vi.hoisted(() => ({
  // 139 vyústiek ako v ASR+VZT (eval D-126, N2), id zoradené.
  ROWS: Array.from({ length: 139 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    object_type: "asset",
    object_ref: `VV.${String(i).padStart(3, "0")}`,
    name: `VV.${String(i).padStart(3, "0")}`,
    ifc_type: "IfcAirTerminal",
    predefined_type: i < 2 ? "GRILLE" : "DIFFUSER",
    valid_until: null,
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
      is: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
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
    expect(pages).toBeLessThanOrEqual(3);
  });

  it("úplný zoznam ostáva pole riadkov ako predtým, prázdny radí fulltext", async () => {
    const grilles = JSON.parse((await new AskToolRuntime().exec("search_objects", { predefined_type: "GRILLE" })).content);
    expect(grilles.map((r: { object_ref: string }) => r.object_ref)).toEqual(["VV.000", "VV.001"]);
    const none = JSON.parse((await new AskToolRuntime().exec("search_objects", { ifc_type: "IfcDoor" })).content);
    expect(none).toMatchObject({ rows: [] });
    expect(none.hint).toContain("search_everything");
  });
});
