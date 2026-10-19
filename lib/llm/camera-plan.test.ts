import { describe, expect, it } from "vitest";

import { opToBridgeMessage, parseOps } from "../viewer-ops";
import { planCamera } from "./camera-plan";
import { ViewInputError } from "./view-plan";

const STAIR = "1KphWFyMb8dRV6rhVkyU6y";

describe("set_camera: relatívny pohyb, fit, filter, kolmo na rez (D-094, D-098)", () => {
  it("oddiaľ o 15 % pri zachovanom smere", () => {
    const p = planCamera({ zoom_percent: -15 }, []);
    expect(p.ops).toEqual(["camera:keep~z=-15:"]);
    expect(parseOps(p.ops[0])).toEqual([{ op: "camera", preset: "keep", guids: [], zoomPercent: -15 }]);
    // Relatívny krok do bridge nejde: host z neho spraví pózu (applyRelativeCamera).
    expect(opToBridgeMessage(parseOps(p.ops[0])[0])).toEqual({ type: "SET_CAMERA", preset: "keep" });
    expect(p.result).toMatchObject({ camera: "keep", zoom_percent: -15 });
    expect(p.label).toContain("oddialenie 15 %");
  });

  it("izolované VZT v iso perspektíve na celú obrazovku", () => {
    const p = planCamera({ preset: "iso", fit: "visible", projection: "perspective" }, []);
    expect(parseOps(p.ops[0])).toEqual([
      { op: "camera", preset: "iso", guids: [], projection: "perspective", fit: "visible" },
    ]);
  });

  it("rez schodiskom kolmo spredu a zafitovanie", () => {
    const p = planCamera({ preset: "section", fit: "visible" }, []);
    expect(opToBridgeMessage(parseOps(p.ops[0])[0])).toEqual({ type: "SET_CAMERA", preset: "section", fit: "visible" });
  });

  it("cieľ filtrom ako style_in_3d: domain aj model -> camera_sel", () => {
    const p = planCamera({ preset: "iso", domain: "hvac", model: "VZT" }, []);
    expect(p.ops[0]).toMatch(/^camera_sel:iso:t=IfcDuctSegment\..+~m=VZT$/);
    const [op] = parseOps(p.ops[0]);
    expect(op).toMatchObject({ op: "camera", preset: "iso", guids: [], selector: { model: "VZT" } });
    expect(opToBridgeMessage(op)).toMatchObject({ type: "SET_CAMERA", selector: { model: "VZT" } });
    expect(p.result).toMatchObject({ selector: { model: "VZT" } });

    const one = planCamera({ ifc_type: "IfcStairFlight" }, []);
    expect(one.ops).toEqual(["camera_sel:keep:t=IfcStairFlight"]);
  });

  it("orbit a posun v jednom volaní, bez presetu a cieľa", () => {
    const p = planCamera({ orbit_h_deg: 45, pan_y_percent: 10 }, []);
    expect(parseOps(p.ops[0])).toEqual([{ op: "camera", preset: "keep", guids: [], orbitH: 45, panY: 10 }]);
    expect(p.result).toMatchObject({ orbit_h_deg: 45, pan_y_percent: 10 });
  });

  it("staré volanie ostáva bez zmeny formátu", () => {
    expect(planCamera({ preset: "top", projection: "orthographic" }, [STAIR]).ops).toEqual([`camera:top~proj=o:${STAIR}`]);
    expect(planCamera({ preset: "fit_all" }, []).ops).toEqual(["camera:fit_all:"]);
  });

  it("chybný vstup", () => {
    expect(() => planCamera({}, [])).toThrow(/Nič na zmenu/);
    expect(() => planCamera({ preset: "diagonal" }, [])).toThrow(ViewInputError);
    expect(() => planCamera({ zoom_percent: -95 }, [])).toThrow(/zoom_percent/);
    expect(() => planCamera({ orbit_v_deg: 90 }, [])).toThrow(/orbit_v_deg/);
    expect(() => planCamera({ zoom_percent: "15" }, [])).toThrow(/zoom_percent/);
    expect(() => planCamera({ fit: "everything" }, [])).toThrow(/fit musí/);
    expect(() => planCamera({ fit: "model" }, [])).toThrow(/fit musí/);
    expect(() => planCamera({ fit: "visible" }, [STAIR])).toThrow(/bez cieľa/);
    expect(() => planCamera({ preset: "fit_all", fit: "visible" }, [])).toThrow(/fit_all/);
    expect(() => planCamera({ domain: "garden" }, [])).toThrow(/domain/);
    expect(() => planCamera({ global_ids: [STAIR], ifc_type: "IfcStair" }, [STAIR])).toThrow(/nie oboma/);
  });

  it("relatívny krok len v samostatnom volaní (D-098)", () => {
    for (const input of [
      { preset: "iso", zoom_percent: 20 },
      { fit: "visible", zoom_percent: 20 },
      { orbit_h_deg: 45, projection: "orthographic" },
    ]) {
      expect(() => planCamera(input, [])).toThrow(/samostatnom volaní/);
    }
    expect(() => planCamera({ pan_x_percent: 10 }, [STAIR])).toThrow(/samostatnom volaní/);
  });

  it("parseOps zahodí kroky mimo rozsahu a camera_sel bez selektora", () => {
    expect(parseOps("camera:keep~z=900~oh=45~fit=x:")).toEqual([{ op: "camera", preset: "keep", guids: [], orbitH: 45 }]);
    expect(parseOps("camera:iso~fit=v:")).toEqual([{ op: "camera", preset: "iso", guids: [], fit: "visible" }]);
    expect(parseOps("camera_sel:iso:")).toEqual([]);
  });
});
