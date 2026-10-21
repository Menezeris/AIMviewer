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
    expect(parseSectionCapArg("hatch~p=zigzag~s=8~w=1")).toBeNull();
    expect(parseSectionCapArg("hatch~p=diagonal~a=500~s=8~w=1")).toBeNull();
    expect(parseSectionCapArg("hatch~p=diagonal~s=1~w=1")).toBeNull();
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
    expect(planSectionCap({ hatch_pattern: "zigzag" })).toHaveProperty("error");
    expect(planSectionCap({ hatch_spacing_px: 100 })).toHaveProperty("error");
    expect(planSectionCap({ hatch_line_width_px: 0 })).toHaveProperty("error");
    expect(planSectionCap({ hatch_angle_deg: "45" })).toHaveProperty("error");
    expect(planSectionCap({ hatch_pattern: "dots", hatch_angle_deg: 30 })).toMatchObject({ error: expect.stringMatching(/len pre diagonal/) });
    expect(planSectionCap({ cap_style: "solid", hatch_pattern: "cross" })).toMatchObject({ error: expect.stringMatching(/cap_style=hatch/) });
    expect(planSectionCap({ cap_color: "red" })).toHaveProperty("error");
    expect(planSectionCap({ cap_style: "none", cap_color: "#ffffff" })).toHaveProperty("error");
  });
});

describe("vzor šrafy (D-128, #173)", () => {
  it("cap_style=hatch bez vzoru = diagonála 45°, 8 px, 1 px, nezávisle od uloženej voľby", () => {
    const p = planSectionCap({ cap_style: "hatch" });
    expect(p).toMatchObject({
      op: "section_cap:hatch~p=diagonal~a=45~s=8~w=1:",
      result: { cap_style: "hatch", hatch_pattern: "diagonal", hatch_angle_deg: 45, hatch_spacing_px: 8, hatch_line_width_px: 1 },
    });
    const [op] = parseOps((p as { op: string }).op);
    expect(opToBridgeMessage(op)).toEqual({ type: "SET_SECTION_CAP", cap: "hatch", pattern: "diagonal", angleDeg: 45, spacingPx: 8, widthPx: 1 });
  });

  it("samotné parametre šrafy znamenajú hatch; farba ide s nimi", () => {
    const p = planSectionCap({ hatch_angle_deg: 30, hatch_spacing_px: 12, cap_color: "#EF4444" }) as { op: string; label: string; result: object };
    expect(p.op).toBe("section_cap:hatch~c=ef4444~p=diagonal~a=30~s=12~w=1:");
    expect(p.result).toMatchObject({ cap_style: "hatch", cap_color: "#ef4444", hatch_angle_deg: 30 });
    expect(p.label).toContain("diagonálna 30°");
  });

  it("mapovanie vzorov na renderer: opačná diagonála, mriežka, krížová, bodky", () => {
    const msg = (input: Record<string, unknown>) => opToBridgeMessage(parseOps((planSectionCap(input) as { op: string }).op)[0]);
    expect(msg({ hatch_pattern: "diagonal_reverse" })).toMatchObject({ pattern: "diagonal", angleDeg: -45 });
    expect(msg({ hatch_pattern: "diagonal_reverse", hatch_angle_deg: 60 })).toMatchObject({ angleDeg: -60 });
    expect(msg({ hatch_pattern: "cross" })).toMatchObject({ pattern: "crossHatch", angleDeg: 0, secondaryAngleDeg: -90 });
    expect(msg({ hatch_pattern: "crosshatch" })).toMatchObject({ pattern: "crossHatch", angleDeg: 45, secondaryAngleDeg: -45 });
    const dots = msg({ hatch_pattern: "dots", hatch_line_width_px: 2 });
    expect(dots).toEqual({ type: "SET_SECTION_CAP", cap: "hatch", pattern: "concrete", spacingPx: 8, widthPx: 2 });
    expect(msg({ hatch_pattern: "vertical" })).not.toHaveProperty("angleDeg");
  });

  it("staré op hatch bez vzoru ostáva platné (fork vráti uloženú šrafu)", () => {
    expect(parseSectionCapArg("hatch")).toEqual({ op: "section_cap", cap: "hatch" });
    expect(parseSectionCapArg("solid~p=diagonal")).toEqual({ op: "section_cap", cap: "solid" });
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

describe("set_section so šrafou bez cap_style", () => {
  it("action=widget + hatch_pattern zmení len vzor šrafy aktívneho rezu", async () => {
    const { execViewTool } = await import("./llm/view-tools");
    const pushed: { url: string }[] = [];
    const res = await execViewTool("set_section", { action: "widget", hatch_pattern: "crosshatch" }, (a) => pushed.push(a as { url: string }));
    expect(res).toEqual({ ok: true, cap_style: "hatch", hatch_pattern: "crosshatch", hatch_angle_deg: 45, hatch_spacing_px: 8, hatch_line_width_px: 1 });
    expect(decodeURIComponent(pushed[0].url)).toMatch(/^\/ifc\?ops=section_cap:hatch~p=crossHatch~a=45~a2=-45~s=8~w=1:&r=/);
  });
});
