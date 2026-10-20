import { afterEach, describe, expect, it } from "vitest";

import { guid } from "./__fixtures__/mini-building";
import { MINI_GEOMETRY_BYTES } from "./__fixtures__/mini-geometry";
import { MINI_ROUTE_BYTES } from "./__fixtures__/mini-route";
import { clearEngineCache } from "./cache";
import type { AimRef } from "./join";
import { spaceContains, type NavSpace } from "./route";
import { execEngineTool, type EngineDeps } from "./tools";

const AIM: Record<string, AimRef> = {
  [guid("D1")]: { object_id: "11111111-1111-1111-1111-111111111111", object_ref: "DD01.01", name: "D1", object_type: "asset" },
  [guid("R1")]: { object_id: "22222222-2222-2222-2222-222222222222", object_ref: "1.01", name: "1.01", object_type: "space" },
};

const depsFor = (bytes: Uint8Array<ArrayBuffer>): EngineDeps => ({
  sources: () => [{ id: "ASR", label: "ASR", url: "https://example.test/route.ifc" }],
  lookup: async (guids) => new Map(guids.filter((g) => AIM[g]).map((g) => [g, AIM[g]])),
  resolveTargets: async (targets) =>
    new Map(targets.flatMap((t) => Object.entries(AIM).filter(([, a]) => a.object_ref === t).map(([g]) => [t, g] as [string, string]))),
  fetchImpl: (async () => new Response(bytes, { status: 200, headers: { etag: '"route"' } })) as unknown as typeof fetch,
});

const run = async (input: Record<string, unknown>, bytes: Uint8Array<ArrayBuffer> = MINI_ROUTE_BYTES) => {
  const res = await execEngineTool("ifc_measure", input, depsFor(bytes));
  return { ...res, json: res.isError ? null : JSON.parse(res.content) };
};

const path = (json: { steps: Array<{ kind: string; name: string | null }> }) => json.steps.map((s) => `${s.kind}:${s.name}`);

describe("ifc_measure route (D-121)", () => {
  afterEach(() => clearEngineCache());

  it("bod v pôdoryse miestnosti a vo výške jej obálky", () => {
    const s: NavSpace = {
      globalId: "x",
      name: null,
      storey: null,
      center: [1, 1],
      triangles: Float64Array.from([0, 0, 2, 0, 2, 2, 0, 0, 2, 2, 0, 2]),
      zMin: 0,
      zMax: 3,
    };
    expect(spaceContains(s, [1, 1.5], 1)).toBe(true);
    expect(spaceContains(s, [2.5, 1], 1)).toBe(false);
    expect(spaceContains(s, [1, 1], 4)).toBe(false);
  });

  it("najkratšia cesta medzi miestnosťami cez dvere a schodisko, dolný odhad", async () => {
    const r = await run({ route: "shortest", a: guid("R3"), b: "1.01" });
    expect(r.isError).toBe(false);
    // R3 4 + S2 1 + rameno hypot(3; 3,5) 4,61 + S1 1 + R2 4 + R1 2.
    expect(r.json.length_m).toBeCloseTo(16.6, 5);
    expect(r.json.length_kind).toBe("dolný odhad");
    expect(r.json.note).toMatch(/DOLNÝ ODHAD/);
    expect(path(r.json)).toEqual(["space:2.01", "door:D3", "space:2.02", "stair:ST", "space:1.03", "door:D2", "space:1.02", "door:D1", "space:1.01"]);
    expect(r.json.steps[3]).toMatchObject({ kind: "stair", storey: "2NP", storey_to: "1NP", segment_m: 4.61 });
    expect(r.json.storey_changes).toEqual([{ from: "2NP", to: "1NP", stair: guid("ST") }]);
    expect(r.json.from).toMatchObject({ global_id: guid("R3"), object_ref: null });
    expect(r.json.to).toMatchObject({ global_id: guid("R1"), object_ref: "1.01" });
    expect(r.json.show_in_3d.ids_or_refs).toEqual([AIM[guid("D1")].object_id, AIM[guid("R1")].object_id]);
    expect(r.json.show_in_3d.global_ids).toContain(guid("ST"));
    expect(r.json.graph).toMatchObject({ spaces: 5,
      doors: 6,
      exits: 1,
      stairs: 1,
      upper_external_doors_not_exits: ["DT"],
      revolving_doors_not_exits: ["DR"],
    });
  });

  it("úniková cesta k vonkajším dverám na teréne, nie na strechu", async () => {
    const r = await run({ route: "escape", a: guid("R3") });
    expect(r.isError).toBe(false);
    expect(r.json.exit).toMatchObject({ global_id: guid("DX"), name: "DX" });
    expect(r.json.length_m).toBeCloseTo(18.6, 5);
    expect(path(r.json).at(-1)).toBe("door:DX");
    // Karuselové DR v R2 je bližšie (R2 -> DR 2 m), ale únikovým východom nie je.
    expect(r.json.other_exits).toBeUndefined();
  });

  it("štart v prvku (stôl v miestnosti) a v dverách", async () => {
    const desk = await run({ route: "shortest", a: guid("DESK"), b: guid("DX") });
    expect(desk.json.length_m).toBeCloseTo(6.2, 5);
    expect(path(desk.json)).toEqual(["space:1.02", "door:D1", "space:1.01", "door:DX"]);
    const door = await run({ route: "escape", a: "DD01.01" });
    expect(door.json.length_m).toBe(4);
    expect(path(door.json)).toEqual(["door:D1", "space:1.01", "door:DX"]);
  });

  it("chyby vstupu a model bez hraníc priestorov", async () => {
    expect((await run({ route: "shortest", a: guid("R3") })).content).toMatch(/potrebuje aj b/);
    expect((await run({ route: "escape", a: guid("R3"), b: guid("R1") })).content).toMatch(/b nezadávaj/);
    expect((await run({ route: "walk", a: guid("R3") })).content).toMatch(/shortest \| escape/);
    // Bez hraníc dverí D2 je 2NP odrezané od východu.
    const cut = new TextEncoder().encode(new TextDecoder().decode(MINI_ROUTE_BYTES).replace(/IFCRELSPACEBOUNDARY1STLEVEL\('RSB3[^\n]*\n/, ""));
    clearEngineCache();
    const disconnected = await run({ route: "escape", a: guid("R3") }, cut);
    expect(disconnected.content).toMatch(/dosiahnuteľných 3 z 5 miestností/);
    clearEngineCache();
    const none = await run({ route: "escape", a: guid("W1") }, MINI_GEOMETRY_BYTES);
    expect(none.isError).toBe(true);
    expect(none.content).toMatch(/nemá hranice priestorov/);
  });
});
