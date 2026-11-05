import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const calls: { fn: string; args: Record<string, unknown> }[] = [];
let missing = false;
vi.mock("../supabase/server", () => ({
  getSupabaseAdmin: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "model_task_import_comment" && missing) return { data: null, error: { code: "PGRST202", message: "Could not find the function public.model_task_import_comment" } };
      if (fn === "model_task_import_comment" && args.p_comment === "boom") return { data: null, error: { code: "XX000", message: "boom" } };
      return { data: { guid: "g", author: args.p_author, date: args.p_date ?? "now", comment: args.p_comment }, error: null };
    },
  }),
}));

import { isMissingFunction, supabaseBcfStore } from "./store";

beforeEach(() => {
  calls.length = 0;
  missing = false;
});

describe("addComment s pôvodným dátumom (import .bcfzip)", () => {
  it("s dátumom volá model_task_import_comment", async () => {
    const c = await supabaseBcfStore().addComment("t1", "a@b.sk", "text", "2026-01-02T03:04:05.000Z");
    expect(calls.map((x) => x.fn)).toEqual(["model_task_import_comment"]);
    expect(c?.date).toBe("2026-01-02T03:04:05.000Z");
  });

  it("posiela pôvodný guid komentára (p_guid) a bez neho null", async () => {
    const store = supabaseBcfStore();
    await store.addComment("t1", "a@b.sk", "text", "2026-01-02T03:04:05.000Z", "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
    await store.addComment("t1", "a@b.sk", "text", "2026-01-02T03:04:05.000Z");
    expect(calls.map((x) => x.args.p_guid)).toEqual(["aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", null]);
  });

  it("bez dátumu volá pôvodnú model_task_add_comment", async () => {
    await supabaseBcfStore().addComment("t1", "a@b.sk", "text");
    expect(calls.map((x) => x.fn)).toEqual(["model_task_add_comment"]);
  });

  it("pred migráciou (funkcia chýba) padne na dnešné správanie a ďalej sa nepokúša", async () => {
    missing = true;
    const store = supabaseBcfStore();
    await store.addComment("t1", "a@b.sk", "jedna", "2026-01-02T03:04:05.000Z");
    await store.addComment("t1", "a@b.sk", "dva", "2026-01-02T03:04:05.000Z");
    expect(calls.map((x) => x.fn)).toEqual(["model_task_import_comment", "model_task_add_comment", "model_task_add_comment"]);
  });

  it("iná chyba funkcie sa nezakryje fallbackom", async () => {
    // po predošlom teste je fallback v platnosti 5 minút: čas posunieme za jeho okno
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);
    try {
      await expect(supabaseBcfStore().addComment("t1", "a@b.sk", "boom", "2026-01-02T03:04:05.000Z")).rejects.toThrow(/boom/);
    } finally {
      vi.useRealTimers();
    }
    expect(calls.map((x) => x.fn)).toEqual(["model_task_import_comment"]);
  });

  it("isMissingFunction pozná PostgREST aj Postgres kód", () => {
    expect(isMissingFunction({ code: "PGRST202" })).toBe(true);
    expect(isMissingFunction({ code: "42883" })).toBe(true);
    expect(isMissingFunction({ code: "XX000", message: "boom" })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });
});
