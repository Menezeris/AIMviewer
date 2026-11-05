/**
 * D-189: every store reads its project (`.eq("project_id", p)`), writes it on insert and uses the
 * per-project conflict keys. A recording Supabase client keeps the call chain of every query.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { method: string; args: unknown[] };
interface Chain {
  table: string;
  calls: Call[];
}
const chains: Chain[] = [];

function chain(table: string) {
  const c: Chain = { table, calls: [] };
  chains.push(c);
  const single = () => c.calls.some((x) => x.method === "single" || x.method === "maybeSingle");
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") {
          return (resolve: (v: unknown) => unknown) =>
            resolve({ data: single() ? { id: "row-1", properties: {} } : [], error: null, count: 0 });
        }
        return (...args: unknown[]) => {
          c.calls.push({ method: prop, args });
          return proxy;
        };
      },
    },
  );
  return proxy;
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: (t: string) => chain(t), rpc: async () => ({ data: null, error: null }) }),
}));

const P = "11111111-2222-4333-8444-555555555555";

const { supabaseSavedViewStore } = await import("@/lib/views/store");
const { supabaseBcfStore } = await import("@/lib/bcf/store");
const { supabaseClashStore } = await import("@/lib/clash/store");
const { supabaseIdsStore } = await import("@/lib/ids/store");
const { supabaseIdsLibraryStore } = await import("@/lib/ids/library-store");
const { supabaseVerificationStore } = await import("@/lib/verify/store");

beforeEach(() => {
  chains.length = 0;
});

/** Chains of the given project-bound tables. */
const of = (...tables: string[]) => chains.filter((c) => tables.includes(c.table));
const has = (c: Chain, method: string, ...args: unknown[]) =>
  c.calls.some((x) => x.method === method && args.every((a, i) => JSON.stringify(x.args[i]) === JSON.stringify(a)));
/** Read, update or delete filters the project; an insert or upsert carries it in the row. */
function scoped(c: Chain): boolean {
  const write = c.calls.find((x) => x.method === "insert" || x.method === "upsert");
  if (write) {
    const rows = Array.isArray(write.args[0]) ? write.args[0] : [write.args[0]];
    return rows.every((r) => (r as Record<string, unknown>).project_id === P);
  }
  return has(c, "eq", "project_id", P);
}

describe("project_id in the stores (D-189)", () => {
  it("saved views: reads, rename, delete and both inserts carry the project", async () => {
    const s = supabaseSavedViewStore(P);
    await s.list();
    await s.byName("A");
    await s.byId("v1");
    await s.last();
    await s.create({ name: "A", viewpoint: {} as never });
    await s.update("v1", { name: "B" });
    await s.remove("v1");
    await s.setLast({ name: "Posledný pohľad", viewpoint: {} as never });
    const views = of("saved_views");
    expect(views.length).toBeGreaterThanOrEqual(9);
    expect(views.filter((c) => !scoped(c))).toEqual([]);
  });

  it("BCF topics: reads, update and create carry the project", async () => {
    const s = supabaseBcfStore(P);
    await s.create({ title: "T" } as never);
    await s.get({ number: 3 });
    await s.list({ limit: 10 } as never);
    await s.update("t1", { title: "U" } as never);
    await s.runningSessions(new Date());
    await s.vocabulary();
    const topics = of("model_tasks");
    expect(topics).toHaveLength(6);
    expect(topics.filter((c) => !scoped(c))).toEqual([]);
  });

  it("clash: tests and runs per project, upsert on (project_id, code)", async () => {
    const s = supabaseClashStore(P);
    await s.listTests();
    await s.testByCode("VZT-ASR");
    await s.upsertTest({ code: "MOJ", name: "M" } as never);
    await s.deleteTest("t1");
    await s.lastRuns(["t1"]);
    await s.runs("t1", 5);
    await s.run("r1");
    await s.saveRun({ test_id: "t1" } as never, []);
    const rows = of("clash_tests", "clash_runs");
    expect(rows.filter((c) => !scoped(c))).toEqual([]);
    const upsert = of("clash_tests").find((c) => c.calls.some((x) => x.method === "upsert"))!;
    expect(upsert.calls.find((x) => x.method === "upsert")!.args[1]).toEqual({ onConflict: "project_id,code" });
  });

  it("IDS: documents and runs per project", async () => {
    const s = supabaseIdsStore(P);
    await s.listDocuments();
    await s.byCode("IDS-1");
    await s.byId("d1");
    await s.createDocument({ code: "IDS-2", title: "T" } as never);
    await s.deleteDocument("d1");
    await s.lastRuns(["d1"]);
    await s.saveRun({ version_id: "v1" } as never, []);
    const rows = of("ids_documents", "ids_runs");
    expect(rows.length).toBeGreaterThanOrEqual(7);
    expect(rows.filter((c) => !scoped(c))).toEqual([]);
  });

  it("IDS library: containers, revisions, runs and document updates per project", async () => {
    const s = supabaseIdsLibraryStore(P);
    await s.containers();
    await s.models(["d1"]);
    await s.currentRevisions();
    await s.revisionExists("ASR", 79);
    await s.lastRunsByModel(["d1"]);
    await s.updateDocument("d1", { title: "T" } as never);
    const rows = of("information_containers", "model_revisions", "ids_runs", "ids_documents");
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.filter((c) => !scoped(c))).toEqual([]);
  });

  it("verification: a run is written in the project", async () => {
    await supabaseVerificationStore(P).saveRun({ model: "ASR" } as never, []);
    expect(of("verification_runs").filter((c) => !scoped(c))).toEqual([]);
  });
});
