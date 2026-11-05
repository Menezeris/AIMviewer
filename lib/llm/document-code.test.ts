import { describe, expect, it, vi } from "vitest";

const { DOC, ROWS } = vi.hoisted(() => {
  const DOC = "ead882e9-0901-4548-a55f-9eea40773c81";
  return {
    DOC,
    ROWS: [
      {
        id: DOC,
        object_type: "document",
        object_ref: "OCB_SO01_PBR_D-1-3-04_PODORYS-3NP",
        name: "D.1.3.04 Pôdorys 3NP PBR",
        ifc_type: null,
        predefined_type: null,
        valid_until: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000001",
        object_type: "document",
        object_ref: "OCB_SO01_ASR_D-1-1-01_PODORYS-1NP",
        name: "D.1.1.01 Pôdorys 1NP",
        ifc_type: null,
        predefined_type: null,
        valid_until: null,
      },
    ] as Record<string, unknown>[],
  };
});

// Server-only moduly (D-026); tabuľka objects vyhodnocuje eq / ilike / is ako PostgREST.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => {
  const table = (name: string) => {
    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
    const rows = () => (name === "objects" ? ROWS.filter((r) => filters.every((f) => f(r))) : []);
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
      is: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
      not: (col: string, _op: "is", v: unknown) => (filters.push((r) => (r[col] ?? null) !== v), q),
      ilike: (col: string, pattern: string) => {
        const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");
        filters.push((r) => re.test(String(r[col] ?? "")));
        return q;
      },
      in: () => q,
      order: () => q,
      limit: async () => ({ data: rows(), error: null }),
      then: (res: (v: unknown) => unknown) => res({ data: rows(), error: null }),
    };
    return q;
  };
  return { getSupabaseAdmin: () => ({ from: table, rpc: async () => ({ data: [], error: null }) }) };
});

import { AskToolRuntime } from "./tools";

describe("dokument podľa kódu z názvu (eval 2026-10-20, V8/V9)", () => {
  it("get_object nájde výkres D.1.3.04, hoci object_ref je OCB_..._D-1-3-04_...", async () => {
    const res = await new AskToolRuntime().exec("get_object", { id_or_ref: "D.1.3.04" });
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content)).toMatchObject({ id: DOC, object_type: "document", matched_by: "document_code" });
  });

  it("search_documents prijme kód ako document_id (čítanie strany)", async () => {
    const res = await new AskToolRuntime().exec("search_documents", { document_id: "D.1.3.04", page: 1 });
    expect(res.content).not.toMatch(/sa nenašiel/);
  });

  it("neznámy alebo nekódový vstup ostane nenájdený", async () => {
    for (const id_or_ref of ["D.9.9.99", "1.05"]) {
      const res = await new AskToolRuntime().exec("get_object", { id_or_ref });
      expect(JSON.parse(res.content)).toMatchObject({ found: false });
    }
  });
});
