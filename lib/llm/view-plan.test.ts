import { describe, expect, it } from "vitest";

import { parseOps } from "../viewer-ops";
import { planCamera } from "./camera-plan";
import { ViewInputError, planPanels, planSection, planViewMode } from "./view-plan";

const FLOOR = { label: "3NP", guid: "3ig6N2jJz05g7H9Fq$ftkL" };
const ROOM = "1KphWFyMb8dRV6rhVkyU6y";

describe("tools pohľadu (D-083 fáza 1)", () => {
  it("strop nad miestnosťou: rez pod stropnou doskou ďalšieho podlažia", () => {
    const p = planSection({ action: "set", floor: "3NP", offset_m: -0.4 }, FLOOR);
    expect(parseOps(p.ops.join(";"))).toEqual([{ op: "section", axis: "y", storeyGuid: FLOOR.guid, offsetM: -0.4 }]);
    expect(p.result).toMatchObject({ section: { floor: "3NP", offset_m: -0.4 } });
  });

  it("rez nad podlažím vráti eleváciu z AIM DB na kontrolu polohy roviny (D-092)", () => {
    const p = planSection({ action: "set", floor: "3NP", offset_m: 1 }, { ...FLOOR, elevation: 9200 });
    expect(p.result).toMatchObject({ section: { floor: "3NP", offset_m: 1, floor_elevation_model_units: 9200 } });
    expect(planSection({ action: "set", floor: "3NP" }, FLOOR).result.section).not.toHaveProperty("floor_elevation_model_units");
  });

  it("rez: default 1,2 m, zvislý v percentách, zrušenie a chyby vstupu", () => {
    expect(planSection({ action: "set" }, FLOOR).result).toMatchObject({ section: { offset_m: 1.2 } });
    expect(parseOps(planSection({ action: "set", orientation: "vertical_x", position_percent: 30 }, null).ops[0])[0]).toMatchObject({
      axis: "x",
      position: 30,
    });
    expect(planSection({ action: "clear" }, null).ops).toEqual(["section_clear::"]);
    expect(() => planSection({ action: "set" }, null)).toThrow(ViewInputError);
    expect(() => planSection({ action: "set", orientation: "vertical_z" }, FLOOR)).toThrow(/vodorovnom/);
    expect(() => planSection({ action: "set", offset_m: 50 }, FLOOR)).toThrow(/rozsahu/);
  });

  it("kamera zhora na miestnosť bez perspektívy", () => {
    const p = planCamera({ preset: "top", projection: "orthographic" }, [ROOM]);
    expect(parseOps(p.ops[0])).toEqual([{ op: "camera", preset: "top", projection: "orthographic", guids: [ROOM], marginPercent: 40 }]);
    expect(() => planCamera({ preset: "diagonal" }, [])).toThrow(ViewInputError);
  });

  it("režim 2D na podlaží a reset pohľadu", () => {
    expect(parseOps(planViewMode({ mode: "2d" }, FLOOR).ops[0])).toEqual([{ op: "view", mode: "2d", storeyGuid: FLOOR.guid }]);
    const reset = planViewMode({ mode: "3d", reset: true }, null);
    expect(parseOps(reset.ops.join(";")).map((o) => o.op)).toEqual(["section_clear", "view", "show_all", "reset_colors", "clear_selection", "clear_focus", "camera"]);
    expect(() => planViewMode({ mode: "2d", reset: true }, null)).toThrow(/reset/);
  });
});

describe("set_section cez prvok a na súradnici (D-085)", () => {
  const STAIR = "38a9vdh9bF5Qg28GWyHhlr";

  it("rez pozdĺž schodiska: cieľ z DB, os volí viewer", () => {
    const p = planSection({ action: "set", target_ids_or_refs: ["SCH.01"], fit: "along" }, null, [STAIR]);
    expect(parseOps(p.ops.join(";"))).toEqual([{ op: "section", guids: [STAIR], fit: "along" }]);
    expect(p.result).toMatchObject({ section: { fit: "along", targets: 1 } });
  });

  it("stredom prvku potrebuje orientation; bez nájdeného cieľa je to chyba", () => {
    const p = planSection({ action: "set", global_ids: [STAIR], fit: "center", orientation: "horizontal" }, null, [STAIR]);
    expect(parseOps(p.ops.join(";"))).toEqual([{ op: "section", axis: "y", guids: [STAIR], fit: "center" }]);
    expect(() => planSection({ action: "set", global_ids: [STAIR], fit: "center" }, null, [STAIR])).toThrow(ViewInputError);
    expect(() => planSection({ action: "set", target_ids_or_refs: ["X"], fit: "along" }, null, [])).toThrow(ViewInputError);
    expect(() => planSection({ action: "set", global_ids: [STAIR], fit: "diagonal" }, null, [STAIR])).toThrow(ViewInputError);
  });

  it("súradnica IFC na osi orientation", () => {
    const p = planSection({ action: "set", orientation: "vertical_z", coordinate_m: 3.1 }, null);
    expect(parseOps(p.ops.join(";"))).toEqual([{ op: "section", axis: "z", coordinate: 3.1 }]);
    expect(p.result).toMatchObject({ section: { coordinate_m: 3.1, crosses: "IFC Y" } });
  });

  it("dva spôsoby naraz sa odmietnu", () => {
    expect(() => planSection({ action: "set", floor: "3NP", coordinate_m: 1 }, FLOOR)).toThrow(ViewInputError);
    expect(() =>
      planSection({ action: "set", target_ids_or_refs: ["A"], fit: "along", position_percent: 40 }, null, [STAIR]),
    ).toThrow(ViewInputError);
  });
});

describe("set_section: widget rezu (#63)", () => {
  it("show_widget=false pri reze nad podlažím skryje widget, rez ostáva", () => {
    const p = planSection({ action: "set", floor: "3NP", offset_m: 1, show_widget: false }, FLOOR);
    expect(parseOps(p.ops.join(";"))).toEqual([
      { op: "section", axis: "y", storeyGuid: FLOOR.guid, offsetM: 1, showGizmo: false },
    ]);
    expect(p.result).toMatchObject({ section: { floor: "3NP", show_widget: false } });
  });

  it("action=widget prepne len widget a bez show_widget je to chyba", () => {
    expect(parseOps(planSection({ action: "widget", show_widget: false }, null).ops.join(";"))).toEqual([
      { op: "section_gizmo", showGizmo: false },
    ]);
    expect(() => planSection({ action: "widget" }, null)).toThrow(ViewInputError);
  });
});

describe("panely (D-127)", () => {
  it("panels -> op SET_PANELS, all len close, chybný vstup = chyba", () => {
    const p = planPanels({ panels: { all: "close", properties: "open" } })!;
    expect(parseOps(p.op)).toEqual([{ op: "panels", panels: { all: "close", properties: "open" } }]);
    expect(p.result).toEqual({ panels: { all: "close", properties: "open" } });
    expect(planPanels({})).toBeNull();
    expect(() => planPanels({ panels: { all: "open" } })).toThrow(ViewInputError);
    expect(() => planPanels({ panels: { legend: "close" } })).toThrow(/neznámy panel/);
    expect(() => planPanels({ panels: { lens: "hide" } })).toThrow(/open, close/);
    expect(() => planPanels({ panels: {} })).toThrow(/aspoň/);
    expect(() => planPanels({ panels: "lens" })).toThrow(ViewInputError);
  });
});
