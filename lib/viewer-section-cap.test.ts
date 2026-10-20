import { describe, expect, it, vi } from "vitest";

import { opToBridgeMessage, parseOps } from "./viewer-ops";
import { parseSectionCapArg, planSectionCap, sectionCapOp } from "./viewer-section-cap";

vi.mock("server-only", () => ({}));

describe("op section_cap (D-120)", () => {
  it("prejde tam a späť až po bridge správu", () => {
    const ops = parseOps(`${sectionCapOp("solid", "#FFAA00")};${sectionCapOp("none")};${sectionCapOp("hatch")}`);
    expect(ops).toEqual([
      { op: "section_cap", cap: "solid", fillColor: "#ffaa00" },
      { op: "section_cap", cap: "none" },
      { op: "section_cap", cap: "hatch" },
    ]);
    expect(opToBridgeMessage(ops[0])).toEqual({ type: "SET_SECTION_CAP", cap: "solid", fillColor: "#ffaa00" });
    expect(opToBridgeMessage(ops[1])).toEqual({ type: "SET_SECTION_CAP", cap: "none" });
  });

  it("zahodí neznámy vzhľad a chybnú farbu z URL", () => {
    expect(parseSectionCapArg("brick")).toBeNull();
    expect(parseSectionCapArg("solid~c=red")).toBeNull();
    expect(parseOps("section_cap:brick:;section_cap:solid~c=12:")).toEqual([]);
  });
});

describe("planSectionCap", () => {
  it("bez cap_style a cap_color nič", () => {
    expect(planSectionCap({ action: "set" })).toBeNull();
  });

  it("cap_style none a solid s farbou", () => {
    expect(planSectionCap({ cap_style: "none" })).toMatchObject({ op: "section_cap:none:", result: { cap_style: "none" } });
    expect(planSectionCap({ cap_style: "solid", cap_color: "#FFFFFF" })).toMatchObject({
      op: "section_cap:solid~c=ffffff:",
      result: { cap_style: "solid", cap_color: "#ffffff" },
    });
  });

  it("samotná farba znamená plnú výplň", () => {
    expect(planSectionCap({ cap_color: "00ff00" })).toMatchObject({ op: "section_cap:solid~c=00ff00:" });
  });

  it("chybný vstup vráti chybu", () => {
    expect(planSectionCap({ cap_style: "brick" })).toHaveProperty("error");
    expect(planSectionCap({ cap_color: "red" })).toHaveProperty("error");
    expect(planSectionCap({ cap_style: "none", cap_color: "#ffffff" })).toHaveProperty("error");
  });
});

describe("set_section s cap_style", () => {
  it("action=widget + cap_style zmení len reznú plochu aktívneho rezu", async () => {
    const { execViewTool } = await import("./llm/view-tools");
    const pushed: { url: string; label: string }[] = [];
    const res = await execViewTool("set_section", { action: "widget", cap_style: "none" }, (a) => pushed.push(a as { url: string; label: string }));
    expect(res).toEqual({ ok: true, cap_style: "none" });
    expect(decodeURIComponent(pushed[0].url)).toMatch(/^\/ifc\?ops=section_cap:none:&r=/);
  });

  it("action=widget so show_widget aj cap_style pošle oboje", async () => {
    const { execViewTool } = await import("./llm/view-tools");
    const pushed: { url: string }[] = [];
    await execViewTool("set_section", { action: "widget", show_widget: false, cap_style: "solid" }, (a) => pushed.push(a as { url: string }));
    expect(decodeURIComponent(pushed[0].url)).toContain("section_gizmo:0:;section_cap:solid:");
  });

  it("action=widget bez show_widget a bez cap_style ostáva chybou", async () => {
    const { execViewTool } = await import("./llm/view-tools");
    await expect(execViewTool("set_section", { action: "widget" }, () => {})).rejects.toThrow(/show_widget/);
  });
});
