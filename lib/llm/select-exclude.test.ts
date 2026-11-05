/**
 * #242: show_in_3d select=true z filtra (ifc_type...) a #246: style_in_3d hide s výnimkou
 * (exclude_*) nad napodobenou DB; kontroluje sa URL akcia (ops), ktorú dostane viewer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/engine/aim-lookup", () => ({
  engineEnabled: () => false,
  resolveNamesToGuids: async (names: string[]) => new Map(names.filter((n) => n === "KOD-1").map((n) => [n, "K".repeat(22)])),
  resolveTargetsToGuids: async () => new Map(),
}));

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let limit = Infinity;
  const b = {
    select() {
      return b;
    },
    eq(col: string, v: unknown) {
      filters.push((r) => r[col] === v);
      return b;
    },
    ilike(col: string, v: string) {
      filters.push((r) => String(r[col] ?? "").toLowerCase() === v.toLowerCase());
      return b;
    },
    or() {
      return b;
    },
    in(col: string, vs: unknown[]) {
      filters.push((r) => vs.includes(r[col]));
      return b;
    },
    is(col: string, v: unknown) {
      filters.push((r) => (r[col] ?? null) === v);
      return b;
    },
    order() {
      return b;
    },
    limit(n: number) {
      limit = n;
      return b;
    },
    then(resolve: (v: { data: Row[]; error: null }) => unknown) {
      const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, limit);
      return Promise.resolve(resolve({ data: rows, error: null }));
    },
  };
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: (t: string) => builder(t) }),
}));

const { AskToolRuntime } = await import("./tools");

const guid = (i: number) => `G${String(i).padStart(21, "0")}`;
const ops = (rt: InstanceType<typeof AskToolRuntime>): string[] =>
  decodeURIComponent(new URL(rt.finalActions()[0].url, "http://x").searchParams.get("ops") ?? "").split(";");

beforeEach(() => {
  const dampers = Array.from({ length: 24 }, (_, i) => ({
    id: `d${i}`, object_type: "asset", object_ref: `VV.${i}`, name: `Klapka ${i}`, ifc_type: "IfcDamper", predefined_type: "FIREDAMPER", valid_until: null,
  }));
  tables.objects = [
    ...dampers,
    { id: "duct", object_type: "asset", object_ref: "VV.03.02.022", name: "Potrubie", ifc_type: "IfcDuctSegment", predefined_type: null, valid_until: null },
  ];
  tables.ifc_guid_history = [
    ...dampers.map((d, i) => ({ object_id: d.id, ifc_guid: guid(i), valid_until: null })),
    { object_id: "duct", ifc_guid: guid(99), valid_until: null },
  ];
});

describe("show_in_3d select=true s filtrom (#242)", () => {
  it("ifc_type vyberie celú triedu jedným volaním", async () => {
    const rt = new AskToolRuntime();
    const res = await rt.exec("show_in_3d", { select: true, ifc_type: "IfcDamper" });
    expect(res.isError).toBe(false);
    const out = JSON.parse(res.content);
    expect(out).toMatchObject({ ok: true, selected_count: 24 });
    expect(out.ifc_guids).toHaveLength(24);
    expect(ops(rt)[0]).toMatch(/^select:/);
  });

  it("filter bez zhody je zrozumiteľná chyba, bez filtra aj ids stále chyba", async () => {
    const rt = new AskToolRuntime();
    expect((await rt.exec("show_in_3d", { select: true, ifc_type: "IfcNic" })).isError).toBe(true);
    const none = await rt.exec("show_in_3d", { select: true });
    expect(none.isError).toBe(true);
    expect(none.content).toContain("filter");
  });

  it("global_ids fungujú aj pri výbere", async () => {
    const rt = new AskToolRuntime();
    const res = await rt.exec("show_in_3d", { select: true, global_ids: [guid(1), guid(2)] });
    expect(JSON.parse(res.content)).toMatchObject({ selected_count: 2 });
  });
});

describe("style_in_3d hide s výnimkou (#246)", () => {
  it("model + výnimky: hide_sel celého modelu a za ním show výnimiek, jedna akcia", async () => {
    const rt = new AskToolRuntime();
    const res = await rt.exec("style_in_3d", { action: "hide", model: "VZT", exclude_ids_or_refs: ["VV.03.02.022", "KOD-1"], exclude_global_ids: [guid(5)] });
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content)).toMatchObject({ applied: "hide", excluded: 3 });
    expect(rt.finalActions()).toHaveLength(1);
    const [hide, show] = ops(rt);
    expect(hide).toBe("hide_sel::m=VZT");
    expect(show.startsWith("show::")).toBe(true);
    expect(show.slice(6).split(".").sort()).toEqual([guid(5), guid(99), "K".repeat(22)].sort());
  });

  it("filter v DB vetve: výnimky sa odpočítajú z GUIDov na skrytie", async () => {
    const rt = new AskToolRuntime();
    const res = await rt.exec("style_in_3d", { action: "hide", predefined_type: "FIREDAMPER", exclude_global_ids: [guid(0), guid(1)] });
    expect(JSON.parse(res.content)).toMatchObject({ applied: "hide", elements: 22, excluded: 2 });
    const hidden = ops(rt)[0].split(":")[2].split(".");
    expect(hidden).toHaveLength(22);
    expect(hidden).not.toContain(guid(0));
  });

  it("neznáma výnimka sa nahlási, samé neznáme výnimky skrytie zastavia", async () => {
    const rt = new AskToolRuntime();
    const part = await rt.exec("style_in_3d", { action: "hide", model: "VZT", exclude_ids_or_refs: ["VV.03.02.022", "NEEXISTUJE"] });
    expect(JSON.parse(part.content)).toMatchObject({ excluded: 1, excluded_skipped: ["NEEXISTUJE"] });
    const all = await new AskToolRuntime().exec("style_in_3d", { action: "hide", model: "VZT", exclude_ids_or_refs: ["NEEXISTUJE"] });
    expect(all.isError).toBe(true);
  });

  it("exclude platí len s hide", async () => {
    const res = await new AskToolRuntime().exec("style_in_3d", { action: "isolate", model: "VZT", exclude_global_ids: [guid(1)] });
    expect(res.isError).toBe(true);
    expect(res.content).toContain("action=hide");
  });
});
