/**
 * D-189 cleanup: a library release writes its IDS into the catalog of one project, so `library_vydaj`
 * gets the project as `p_project` (the database rejects a release without it).
 */
import { describe, expect, it, vi } from "vitest";

const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: { vydanie_id: "v-1", ids: [] }, error: null };
    },
  }),
}));

const { supabaseSkladVydania } = await import("./vydanie-db");

describe("supabaseSkladVydania", () => {
  it("passes the project to library_vydaj", async () => {
    const P = "11111111-2222-4333-8444-555555555555";
    const out = await supabaseSkladVydania("assetin", P).vydaj({
      kod: "v1", autor: "test", sprava: null, schema_verzia: "1.5", diagnostiky: {}, ocakavane: {}, polozky: [],
    });
    expect(out.vydanie_id).toBe("v-1");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("library_vydaj");
    expect(rpcCalls[0].args.p_project).toBe(P);
    expect(rpcCalls[0].args.p_kniznica).toBe("assetin");
  });
});
