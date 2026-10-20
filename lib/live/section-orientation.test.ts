import { describe, expect, it } from "vitest";

import { appliedText } from "./applied-text";
import { withSectionOrientation } from "./section-orientation";

describe("orientácia rezu v stave viewera (#97 E4)", () => {
  it("rez cez IFC Z je vodorovný, cez IFC X alebo Y zvislý; bez rezu sa stav nemení", () => {
    const vertical = { mode: "3d", section: { axis: "z", crosses: "IFC Y", coordinate: 4.159 } };
    expect(withSectionOrientation(vertical)).toEqual({ mode: "3d", section: { orientation: "zvislý", axis: "z", crosses: "IFC Y", coordinate: 4.159 } });
    expect(withSectionOrientation({ section: { axis: "y", crosses: "IFC Z (výška)", coordinate: 12.2 } })).toMatchObject({ section: { orientation: "vodorovný" } });
    expect(withSectionOrientation({ section: null })).toEqual({ section: null });
    expect(withSectionOrientation(null)).toBeNull();
  });

  it("stav po príkaze nesie orientáciu", () => {
    const text = appliedText("show_in_3d", { cmdId: "c", ok: true, issues: [], state: { section: { axis: "z", crosses: "IFC Y", coordinate: 4.159 } } });
    expect(text).toContain('"orientation":"zvislý"');
  });
});
