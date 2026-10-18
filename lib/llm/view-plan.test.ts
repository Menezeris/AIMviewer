import { describe, expect, it } from "vitest";

import { parseOps } from "../viewer-ops";
import { ViewInputError, planCamera, planSection, planViewMode } from "./view-plan";

const FLOOR = { label: "3NP", guid: "3ig6N2jJz05g7H9Fq$ftkL" };
const ROOM = "1KphWFyMb8dRV6rhVkyU6y";

describe("tools pohľadu (D-083 fáza 1)", () => {
  it("strop nad miestnosťou: rez pod stropnou doskou ďalšieho podlažia", () => {
    const p = planSection({ action: "set", floor: "3NP", offset_m: -0.4 }, FLOOR);
    expect(parseOps(p.ops.join(";"))).toEqual([{ op: "section", axis: "y", storeyGuid: FLOOR.guid, offsetM: -0.4 }]);
    expect(p.result).toMatchObject({ section: { floor: "3NP", offset_m: -0.4 } });
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
    expect(parseOps(p.ops[0])).toEqual([{ op: "camera", preset: "top", projection: "orthographic", guids: [ROOM] }]);
    expect(() => planCamera({ preset: "diagonal" }, [])).toThrow(ViewInputError);
  });

  it("režim 2D na podlaží a reset pohľadu", () => {
    expect(parseOps(planViewMode({ mode: "2d" }, FLOOR).ops[0])).toEqual([{ op: "view", mode: "2d", storeyGuid: FLOOR.guid }]);
    const reset = planViewMode({ mode: "3d", reset: true }, null);
    expect(parseOps(reset.ops.join(";")).map((o) => o.op)).toEqual(["section_clear", "view", "show_all", "reset_colors", "camera"]);
    expect(() => planViewMode({ mode: "2d", reset: true }, null)).toThrow(/reset/);
  });
});
