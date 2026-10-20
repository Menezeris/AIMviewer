import { describe, expect, it, vi } from "vitest";

const { DOC } = vi.hoisted(() => ({ DOC: "dd6745e7-4427-4467-98dd-c5f080eb3866" }));
const ELEMENT = "fff37f74-3202-4099-8c9b-a8d28229261c";

// Moduly sú server-only (D-026); DB vráti len dokument, na ktorý tool siaha.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => {
  const row = { id: DOC, object_type: "document", object_ref: "REZ-A", name: "Rez A", ifc_type: null, predefined_type: null };
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    limit: async () => ({ data: [row], error: null }),
  };
  return { getSupabaseAdmin: () => ({ from: () => query }) };
});

import { AskToolRuntime } from "./tools";

describe("open_drawing s výrezom strany (D-117)", () => {
  it("region otvorí kartu vo vieweri s výrezom v %", async () => {
    const rt = new AskToolRuntime();
    const res = await rt.exec("open_drawing", { document_id: DOC, page: 1, region: { x: 50, y: 0, width: 50, height: 50 } });
    expect(JSON.parse(res.content)).toMatchObject({
      ok: true,
      opened: "viewer_document",
      page: 1,
      region: { x: 50, y: 0, width: 50, height: 50 },
    });
    expect(decodeURIComponent(rt.finalActions()[0].url)).toContain(`doc:1~r=50_0_50_50:${DOC}`);
  });

  it("výrez sa oreže do strany a chybný výrez je chyba", async () => {
    const rt = new AskToolRuntime();
    const res = await rt.exec("open_drawing", { document_id: DOC, region: { x: 80, y: 90, width: 40, height: 40 } });
    expect(JSON.parse(res.content).region).toEqual({ x: 80, y: 90, width: 20, height: 10 });
    const bad = await rt.exec("open_drawing", { document_id: DOC, region: { x: 120, y: 0, width: 10, height: 10 } });
    expect(bad.isError).toBe(true);
    expect(bad.content).toContain("region");
  });

  it("focus_id vo vieweri vráti poznámku, bez výrezu ostáva op ako doteraz", async () => {
    const rt = new AskToolRuntime();
    const res = await rt.exec("open_drawing", { document_id: DOC, in_viewer: true, focus_id: ELEMENT });
    expect(JSON.parse(res.content).note).toContain("region");
    expect(decodeURIComponent(rt.finalActions()[0].url)).toContain(`doc::${DOC}`);
  });
});
