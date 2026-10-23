import { describe, expect, it } from "vitest";

import { opToBridgeMessage, parseOps } from "../viewer-ops";

import { LAST_VIEW_NAME, MAX_VIEW_GUIDS, captureFromState, describeView, planRestore } from "./plan";
import { CAPTURED_ID, G1, G2, G3, STOREY, VIEW_STATE, testDeps, wireView } from "./testing";
import { execSavedViewTool, listSavedViews, restoreSavedView } from "./tools";
import { saveWire } from "./wire";

const run = async (deps: ReturnType<typeof testDeps>, args: Record<string, unknown>) => {
  const r = await execSavedViewTool("saved_view", args, deps);
  return { ...r, json: r.isError ? null : JSON.parse(r.text) };
};

describe("saved_view (D-161)", () => {
  it("save pošle viewera VIEW_CAPTURE, počká na zápis hosta a zapíše 'Posledný pohľad'", async () => {
    const deps = testDeps();
    const r = await run(deps, { action: "save", name: "Pôdorys technickej miestnosti 3.14", description: "rez nad 2NP" });
    expect(r.isError).toBe(false);
    expect(deps.captured).toHaveLength(1);
    expect(deps.captured[0].name).toBe("Pôdorys technickej miestnosti 3.14");
    expect(deps.captured[0].capture_id).toMatch(/^[0-9a-f-]{36}$/);
    const row = deps.store.rows.find((x) => x.kind === "saved")!;
    expect(row.id).toBe(CAPTURED_ID);
    expect(row.description).toBe("rez nad 2NP");
    expect(row.author).toBe("Claude (MCP)");
    expect(r.json.saved).toMatchObject({ name: "Pôdorys technickej miestnosti 3.14", id: CAPTURED_ID, objects: 120, camera: { projection: "orthographic" } });
    expect(r.json.saved.section.planes[0]).toMatchObject({ axis: "y", coordinate: 4.2, enabled: true });
    expect(r.json.saved).not.toHaveProperty("mode");
    const last = await deps.store.last();
    expect(last?.name).toBe(LAST_VIEW_NAME);
    expect(last?.description).toContain("Pôdorys technickej miestnosti 3.14");
    expect(deps.changed).toBe(0);
  });

  it("D-161: view_type, locked a underlay_* sa prijmú a ignorujú s poznámkou", async () => {
    const deps = testDeps();
    const r = await run(deps, { action: "save", name: "Rez A-A", view_type: "section", locked: true, underlay_document_id: "x", underlay_page: 2 });
    expect(r.isError).toBe(false);
    expect(r.json.notes.join(" ")).toContain("view_type, locked, underlay_document_id, underlay_page sa ignoruje");
  });

  it("zápis z viewera je vypnutý: do DB sa nič nedostane a tool to povie", async () => {
    const deps = testDeps();
    deps.onCapture = async () => undefined;
    const r = await run(deps, { action: "save", name: "X" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("VIEWS_WRITE_ENABLED");
    expect(deps.store.rows).toHaveLength(0);
  });

  it("rovnaké meno (bez ohľadu na veľkosť písmen) prepíše len s overwrite: starý pohľad zmizne a viewer dostane zoznam", async () => {
    const deps = testDeps();
    await run(deps, { action: "save", name: "Rez A" });
    const again = await run(deps, { action: "save", name: "rez a" });
    expect(again.isError).toBe(true);
    expect(again.text).toContain("overwrite=true");
    // Druhé uloženie vo vieweri dostane nové id; host mu pre kolíziu mena pridá príponu.
    const NEW_ID = "7c1d2e3f-0000-4000-8000-00000000abcd";
    deps.capture = async (req) => {
      deps.captured.push(req);
      await saveWire(deps.store, wireView({ id: NEW_ID, name: req.name }), {});
      return { ok: true, view: { id: NEW_ID, name: req.name }, issues: [] };
    };
    const ok = await run(deps, { action: "save", name: "rez a", overwrite: true });
    expect(ok.json.overwritten).toBe(true);
    const saved = deps.store.rows.filter((x) => x.kind === "saved");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: NEW_ID, name: "rez a" });
    expect((saved[0].viewpoint as unknown as { name: string }).name).toBe("rez a");
    expect(deps.changed).toBe(1);
  });

  it("starší viewer bez VIEW_CAPTURE (stav bez `view`): uloženie cez view_state ako dnes, s poznámkou", async () => {
    const deps = testDeps();
    deps.capture = async () => ({ ok: true, view: undefined, issues: ["pohľady: neplatná správa"] });
    const r = await run(deps, { action: "save", name: "Starý" });
    expect(r.isError).toBe(false);
    const row = deps.store.rows.find((x) => x.kind === "saved")!;
    expect(row.hidden).toEqual([G3]);
    expect(row.isolated).toEqual([G1, G2]);
    expect(row.viewpoint.storey_label).toBe("2NP");
    expect(r.json.notes.join(" ")).toContain("viewer je starší");
  });

  it("viewer nič neuložil (prázdny model) alebo capture zlyhal: chyba", async () => {
    const deps = testDeps();
    deps.capture = async () => ({ ok: true, view: null, issues: ["VIEW_CAPTURE: nič na uloženie"] });
    expect((await run(deps, { action: "save", name: "X" })).text).toContain("nič na uloženie");
    deps.capture = async () => ({ ok: false, reason: "viewer neodpovedal (nie je otvorený s ?live=)" });
    const r = await run(deps, { action: "save", name: "X" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("neodpovedal");
    expect(deps.store.rows).toHaveLength(0);
  });

  it("rename a delete zapíšu DB a oznámia viewera; 'Posledný pohľad' sa nepremenúva ani nemaže", async () => {
    const deps = testDeps();
    await run(deps, { action: "save", name: "A" });
    await saveWire(deps.store, wireView({ id: "7c1d2e3f-0000-4000-8000-00000000abcd", name: "B", order: 1 }), {});
    expect((await run(deps, { action: "rename", name: "A", new_name: "b" })).text).toContain("už existuje");
    expect((await run(deps, { action: "rename", name: "A", new_name: "C" })).json.renamed).toEqual({ from: "A", to: "C" });
    const renamed = deps.store.rows.find((x) => x.id === CAPTURED_ID)!;
    expect((renamed.viewpoint as unknown as { name: string }).name).toBe("C");
    expect(deps.changed).toBe(1);
    expect((await run(deps, { action: "delete", name: "posledný pohľad" })).isError).toBe(true);
    expect((await run(deps, { action: "save", name: LAST_VIEW_NAME })).isError).toBe(true);
    expect((await run(deps, { action: "delete", name: "C" })).json.deleted).toBe("C");
    expect(deps.changed).toBe(2);
    const missing = await run(deps, { action: "delete", name: "C" });
    expect(missing.text).toContain("Uložené: B");
  });

  it("zoznam: poradie pásu Presentation, bez zoznamov GUID a bez režimu", async () => {
    const deps = testDeps();
    await saveWire(deps.store, wireView({ id: "7c1d2e3f-0000-4000-8000-00000000abcd", name: "Druhý", order: 1 }), {});
    await saveWire(deps.store, wireView({ name: "Prvý", order: 0 }), {});
    const list = await listSavedViews(deps);
    expect(list.count).toBe(2);
    expect(list.saved_views.map((v) => v.name)).toEqual(["Prvý", "Druhý"]);
    expect(list.saved_views[0]).toMatchObject({ id: CAPTURED_ID, objects: 120, basket: { scope: "all", hidden: 1 }, transition_ms: 1000 });
    expect(JSON.stringify(list)).not.toContain(G3);
    expect(list.saved_views[0]).not.toHaveProperty("mode");
  });

  it("obnova pohľadu z Presentation: VIEW_ACTIVATE, posun rezu po aktivácii a posledný pohľad s novým rezom", async () => {
    const deps = testDeps();
    await run(deps, { action: "save", name: "A" });
    const plan = await restoreSavedView({ saved_view: "a", section_offset_m: -1 }, deps);
    expect(plan.ops[0].startsWith("view_activate::")).toBe(true);
    expect(parseOps(plan.ops[0]).map(opToBridgeMessage)).toEqual([{ type: "VIEW_ACTIVATE", id: CAPTURED_ID }]);
    expect(plan.ops[1]).toBe("section:y~c=3.2~g=0:");
    expect(plan.result).toMatchObject({ restored: "A", section_offset_m: -1, view: { id: CAPTURED_ID, name: "A" } });
    const last = await deps.store.last();
    const lastWire = (last?.viewpoint as unknown as { section: { planes: { coordinate: number }[] } }).section;
    expect(lastWire.planes[0].coordinate).toBe(3.2);
    expect(deps.store.rows.find((x) => x.kind === "saved")?.last_used_at).toBe("2026-10-20T12:30:00.000Z");
    // "ako minule, ale o meter nižšie": posledný pohľad aktivuje pôvodný pohľad podľa `viewpoint.id`.
    const again = await restoreSavedView({ saved_view: "Posledný pohľad", section_offset_m: -1 }, deps);
    expect(parseOps(again.ops[0]).map(opToBridgeMessage)).toEqual([{ type: "VIEW_ACTIVATE", id: CAPTURED_ID }]);
    expect(again.ops[1]).toBe("section:y~c=2.2~g=0:");
  });

  it("posun rezu sa nedá použiť bez rezu, s boxom ani bez súradnice", async () => {
    const deps = testDeps();
    await saveWire(deps.store, wireView({ name: "Bez rezu", section: null }), {});
    await expect(restoreSavedView({ saved_view: "Bez rezu", section_offset_m: -1 }, deps)).rejects.toThrow("nemá rez");
    const box = { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };
    const base = wireView().section!.planes[0];
    await saveWire(deps.store, wireView({ id: "7c1d2e3f-0000-4000-8000-00000000abcd", name: "Box", section: { planes: [{ ...base, box }], active: 0 } }), {});
    await expect(restoreSavedView({ saved_view: "Box", section_offset_m: -1 }, deps)).rejects.toThrow("rezný box");
    const noCoord = { ...base, coordinate: undefined };
    await saveWire(deps.store, wireView({ id: "7c1d2e3f-0000-4000-8000-00000000abce", name: "Percento", section: { planes: [noCoord], active: 0 } }), {});
    await expect(restoreSavedView({ saved_view: "Percento", section_offset_m: -1 }, deps)).rejects.toThrow("súradnicu");
    // bez posunu sa pohľad otvorí aj tak
    expect((await restoreSavedView({ saved_view: "Box" }, deps)).ops).toHaveLength(1);
  });

  it("neznámy pohľad povie, aké sú", async () => {
    const deps = testDeps();
    await run(deps, { action: "save", name: "A" });
    await expect(restoreSavedView({ saved_view: "Z" }, deps)).rejects.toThrow("Uložené: A");
  });
});

describe("plán obnovy starého riadku (D-122, záloha po D-161)", () => {
  const row = () => {
    const { state } = captureFromState(VIEW_STATE);
    return { id: "x", kind: "saved" as const, name: "A", description: null, model_revisions: {}, author: null, created_at: "", updated_at: "", last_used_at: null, ...state };
  };

  it("poradie: čistý stav, rez, izolácia, skrytie, výber, póza kamery na konci; bez záložky", () => {
    const { plan } = planRestore(row(), undefined);
    const kinds = plan.ops.map((o) => o.split(":")[0]);
    expect(kinds).toEqual(["section_clear", "show_all", "reset_colors", "clear_selection", "clear_focus", "section", "isolate", "hide", "select", "pose"]);
    const msgs = parseOps(plan.ops.join(";")).map(opToBridgeMessage);
    expect(msgs.at(-1)).toEqual({
      type: "SET_CAMERA",
      preset: "keep",
      projection: "orthographic",
      viewpoint: { position: { x: 10, y: -5, z: 30 }, target: { x: 10, y: -5, z: 3 }, up: { x: 0, y: 1, z: 0 }, orthoSize: 12.5 },
    });
    expect(msgs).toContainEqual({ type: "ISOLATE", guids: [G1, G2] });
    expect(msgs).toContainEqual({ type: "HIDE", guids: [G3] });
    expect(plan.ops.some((o) => o.startsWith("tab:"))).toBe(false);
  });

  it("starý pôdorys (mode 2d) bez rezu: vodorovný rez 1,2 m nad podlažím, bez záložky a zámku", () => {
    const r = { ...row(), viewpoint: { ...row().viewpoint, mode: "2d" as const, section: null } };
    const { plan } = planRestore(r, 0);
    expect(plan.ops).toContain(`section:y~h=1.2:${STOREY}`);
    expect(plan.ops.some((o) => o.startsWith("view:") || o.startsWith("tab:"))).toBe(false);
    expect(plan.result).not.toHaveProperty("locked");
    expect(plan.result).not.toHaveProperty("tab");
  });

  it("starý rezný box sa obnoví ako section_box; posun naň nejde", () => {
    const box = { min: { x: 1, y: 2, z: 0 }, max: { x: 3, y: 4, z: 3.5 } };
    const { state } = captureFromState({ ...VIEW_STATE, section: { box, show_gizmo: false } });
    expect(state.viewpoint.section).toEqual({ box, show_gizmo: false });
    const r = { ...row(), viewpoint: { ...state.viewpoint } };
    const { plan } = planRestore(r, undefined);
    expect(plan.ops).toContain("section_box:1,2,0,3,4,3.5:");
    expect(parseOps("section_box:1,2,0,3,4,3.5:").map(opToBridgeMessage)).toEqual([{ type: "SET_SECTION_BOX", box }]);
    expect(() => planRestore(r, -1)).toThrow("rezný box");
    expect(describeView(r)).not.toHaveProperty("view_type");
    expect(describeView(r)).not.toHaveProperty("mode");
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
