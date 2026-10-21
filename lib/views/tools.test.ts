import { describe, expect, it } from "vitest";

import { opToBridgeMessage, parseOps } from "../viewer-ops";

import { LAST_VIEW_NAME, MAX_VIEW_GUIDS, captureFromState, planRestore } from "./plan";
import { G1, G2, G3, STOREY, VIEW_STATE, testDeps } from "./testing";
import { execSavedViewTool, listSavedViews, restoreSavedView } from "./tools";

const run = async (deps: ReturnType<typeof testDeps>, args: Record<string, unknown>) => {
  const r = await execSavedViewTool("saved_view", args, deps);
  return { ...r, json: r.isError ? null : JSON.parse(r.text) };
};

describe("saved_view (D-122)", () => {
  it("save uloží stav viewera, revízie a podlažie a prepíše 'Posledný pohľad'", async () => {
    const deps = testDeps();
    const r = await run(deps, { action: "save", name: "Pôdorys technickej miestnosti 3.14", description: "rez nad 2NP" });
    expect(r.isError).toBe(false);
    const row = deps.store.rows.find((x) => x.kind === "saved")!;
    expect(row.hidden).toEqual([G3]);
    expect(row.isolated).toEqual([G1, G2]);
    expect(row.selection).toEqual([G1]);
    expect(row.model_revisions).toEqual({ ASR: 7, VZT: 3 });
    expect(row.viewpoint.storey_label).toBe("2NP");
    expect(row.viewpoint.section?.coordinate).toBe(4.2);
    expect(r.json.saved).toMatchObject({ name: "Pôdorys technickej miestnosti 3.14", storey: "2NP", hidden: 1, isolated: 2 });
    const last = await deps.store.last();
    expect(last?.name).toBe(LAST_VIEW_NAME);
    expect(last?.isolated).toEqual([G1, G2]);
  });

  it("rovnaké meno (bez ohľadu na veľkosť písmen) prepíše len s overwrite", async () => {
    const deps = testDeps();
    await run(deps, { action: "save", name: "Rez A" });
    const again = await run(deps, { action: "save", name: "rez a" });
    expect(again.isError).toBe(true);
    expect(again.text).toContain("overwrite=true");
    const ok = await run(deps, { action: "save", name: "rez a", overwrite: true });
    expect(ok.json.overwritten).toBe(true);
    expect(deps.store.rows.filter((x) => x.kind === "saved")).toHaveLength(1);
  });

  it("bez otvoreného viewera sa neuloží nič", async () => {
    const deps = testDeps();
    deps.viewState = async () => "viewer neodpovedal (nie je otvorený s ?live=)";
    const r = await run(deps, { action: "save", name: "X" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("neodpovedal");
    expect(deps.store.rows).toHaveLength(0);
  });

  it("rename a delete; 'Posledný pohľad' sa nepremenúva ani nemaže", async () => {
    const deps = testDeps();
    await run(deps, { action: "save", name: "A" });
    await run(deps, { action: "save", name: "B" });
    expect((await run(deps, { action: "rename", name: "A", new_name: "b" })).text).toContain("už existuje");
    expect((await run(deps, { action: "rename", name: "A", new_name: "C" })).json.renamed).toEqual({ from: "A", to: "C" });
    expect((await run(deps, { action: "delete", name: "posledný pohľad" })).isError).toBe(true);
    expect((await run(deps, { action: "save", name: LAST_VIEW_NAME })).isError).toBe(true);
    expect((await run(deps, { action: "delete", name: "C" })).json.deleted).toBe("C");
    const missing = await run(deps, { action: "delete", name: "C" });
    expect(missing.text).toContain("Uložené: B");
  });

  it("zoznam opíše pohľady bez zoznamov GUID", async () => {
    const deps = testDeps();
    await run(deps, { action: "save", name: "A" });
    const list = await listSavedViews(deps);
    expect(list.count).toBe(1);
    expect(list.saved_views[0]).toMatchObject({ name: "A", mode: "3d", selection: 1, hidden: 1, isolated: 2 });
    expect(JSON.stringify(list)).not.toContain(G3);
    expect(list.last?.name).toBe(LAST_VIEW_NAME);
  });

  it("obnova s posunom rezu ('o meter nižšie') zapíše posledný pohľad s novým rezom", async () => {
    const deps = testDeps();
    await run(deps, { action: "save", name: "A" });
    const plan = await restoreSavedView({ saved_view: "a", section_offset_m: -1 }, deps);
    expect(plan.ops).toContain("section:y~c=3.2~g=0:");
    expect(plan.result).toMatchObject({ restored: "A", section_offset_m: -1 });
    const last = await deps.store.last();
    expect(last?.viewpoint.section?.coordinate).toBe(3.2);
    expect(deps.store.rows.find((x) => x.kind === "saved")?.last_used_at).toBe("2026-10-20T12:30:00.000Z");
    // "ako minule, ale o meter nižšie" = posledný pohľad znova s posunom
    const again = await restoreSavedView({ saved_view: "Posledný pohľad", section_offset_m: -1 }, deps);
    expect(again.ops).toContain("section:y~c=2.2~g=0:");
  });

  it("neznámy pohľad povie, aké sú", async () => {
    const deps = testDeps();
    await run(deps, { action: "save", name: "A" });
    await expect(restoreSavedView({ saved_view: "Z" }, deps)).rejects.toThrow("Uložené: A");
  });
});

describe("plán obnovy (D-122)", () => {
  const row = () => {
    const { state } = captureFromState(VIEW_STATE);
    return { id: "x", kind: "saved" as const, name: "A", description: null, model_revisions: {}, author: null, created_at: "", updated_at: "", last_used_at: null, ...state };
  };

  it("poradie: čistý stav, režim, rez, izolácia, skrytie, výber, póza kamery na konci", () => {
    const { plan } = planRestore(row(), undefined);
    const kinds = plan.ops.map((o) => o.split(":")[0]);
    expect(kinds).toEqual(["section_clear", "view", "show_all", "reset_colors", "clear_selection", "clear_focus", "section", "isolate", "hide", "select", "pose"]);
    const msgs = parseOps(plan.ops.join(";")).map(opToBridgeMessage);
    expect(msgs.at(-1)).toEqual({
      type: "SET_CAMERA",
      preset: "keep",
      projection: "orthographic",
      viewpoint: { position: { x: 10, y: -5, z: 30 }, target: { x: 10, y: -5, z: 3 }, up: { x: 0, y: 1, z: 0 }, orthoSize: 12.5 },
    });
    expect(msgs).toContainEqual({ type: "ISOLATE", guids: [G1, G2] });
    expect(msgs).toContainEqual({ type: "HIDE", guids: [G3] });
  });

  it("2D pohľad vráti režim aj podlažie", () => {
    const r = { ...row(), viewpoint: { ...row().viewpoint, mode: "2d" as const } };
    expect(planRestore(r, 0).plan.ops[1]).toBe(`view:2d:${STOREY}`);
  });

  it("posun bez rezu so súradnicou a mimo rozsahu je chyba", () => {
    const noSection = { ...row(), viewpoint: { ...row().viewpoint, section: null } };
    expect(() => planRestore(noSection, -1)).toThrow("section_offset_m");
    expect(() => planRestore(row(), 500)).toThrow("section_offset_m");
    expect(planRestore(noSection, undefined).plan.ops.some((o) => o.startsWith("section:"))).toBe(false);
  });

  it("starší viewer bez GUID: skrytie a izolácia sa neuložia a poznámka to povie", () => {
    const { hidden_guids: _h, isolated_guids: _i, ...old } = VIEW_STATE;
    void _h;
    void _i;
    const { state, notes } = captureFromState(old);
    expect(state.hidden).toEqual([]);
    expect(state.isolated).toBeNull();
    expect(notes.join(" ")).toContain("starší viewer");
  });

  it("zoznamy majú strop mosta", () => {
    const many = Array.from({ length: 700 }, (_, i) => `G${String(i).padStart(21, "0")}`);
    const { state, notes } = captureFromState({ ...VIEW_STATE, hidden_count: 700, hidden_guids: many });
    expect(state.hidden).toHaveLength(MAX_VIEW_GUIDS);
    expect(notes.join(" ")).toContain("skrytých je 700");
  });
});

describe("op pose (D-122)", () => {
  it("neplatná póza sa zahodí (vstup je z URL)", () => {
    expect(parseOps("pose:1,2,3,4,5,6,0,0,0:")).toEqual([]);
    expect(parseOps("pose:1,2,3:")).toEqual([]);
    expect(parseOps("pose:1,2,3,4,5,6,0,0,1~o=0:")).toEqual([]);
    expect(parseOps("pose:1,2,3,4,5,6,0,0,1~proj=p:")).toEqual([
      { op: "pose", viewpoint: { position: { x: 1, y: 2, z: 3 }, target: { x: 4, y: 5, z: 6 }, up: { x: 0, y: 0, z: 1 } }, projection: "perspective" },
    ]);
  });
});
