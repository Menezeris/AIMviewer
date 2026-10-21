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
    expect(p.ops[0]).toMatch(/^camera_sel:iso~mg=40:t=IfcDuctSegment\..+~m=VZT$/);
    const [op] = parseOps(p.ops[0]);
    expect(op).toMatchObject({ op: "camera", preset: "iso", guids: [], selector: { model: "VZT" } });
    expect(opToBridgeMessage(op)).toMatchObject({ type: "SET_CAMERA", selector: { model: "VZT" } });
    expect(p.result).toMatchObject({ selector: { model: "VZT" } });

    const one = planCamera({ ifc_type: "IfcStairFlight" }, []);
    expect(one.ops).toEqual(["camera_sel:keep~mg=40:t=IfcStairFlight"]);
  });

  it("orbit a posun v jednom volaní, bez presetu a cieľa", () => {
    const p = planCamera({ orbit_h_deg: 45, pan_y_percent: 10 }, []);
    expect(parseOps(p.ops[0])).toEqual([{ op: "camera", preset: "keep", guids: [], orbitH: 45, panY: 10 }]);
    expect(p.result).toMatchObject({ orbit_h_deg: 45, pan_y_percent: 10 });
  });

  it("staré op bez okraja ostáva platné a ide do forku bez padding", () => {
    expect(planCamera({ preset: "top", projection: "orthographic" }, [STAIR]).ops).toEqual([`camera:top~proj=o~mg=40:${STAIR}`]);
    expect(planCamera({ preset: "fit_all" }, []).ops).toEqual(["camera:fit_all:"]);
    const [old] = parseOps(`camera:top~proj=o:${STAIR}`);
    expect(opToBridgeMessage(old)).toEqual({ type: "SET_CAMERA", preset: "top", projection: "orthographic", guids: [STAIR] });
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

describe("set_camera: okraj a časť cieľa (D-128, #172)", () => {
  it("cieľ s preset=section dostane predvolený okraj 40 % a padding 1,4 do forku", () => {
    const p = planCamera({ preset: "section", target_ids_or_refs: ["SN02.01.0006"] }, [STAIR]);
    expect(p.ops).toEqual([`camera:section~mg=40:${STAIR}`]);
    const [op] = parseOps(p.ops[0]);
    expect(op).toEqual({ op: "camera", preset: "section", guids: [STAIR], marginPercent: 40 });
    expect(opToBridgeMessage(op)).toEqual({ type: "SET_CAMERA", preset: "section", guids: [STAIR], padding: 1.4 });
    expect(p.result).toMatchObject({ camera: "section", targets: 1, margin_percent: 40 });
    expect(p.result.note).toMatch(/visible/);
  });

  it("atika vľavo: area=left a vlastný okraj prejdú až do bridge správy", () => {
    const p = planCamera({ preset: "section", margin_percent: 80, area: "left" }, [STAIR, STAIR]);
    const [op] = parseOps(p.ops[0]);
    expect(opToBridgeMessage(op)).toEqual({ type: "SET_CAMERA", preset: "section", guids: [STAIR, STAIR], padding: 1.8, area: "left" });
    expect(p.label).toContain("ľavá časť");
    expect(p.label).toContain("okraj 80 %");
    expect(p.result).toMatchObject({ area: "left", margin_percent: 80 });
  });

  it("okraj 0 = od hrany po hranu, nie predvolený", () => {
    const [op] = parseOps(planCamera({ margin_percent: 0 }, [STAIR]).ops[0]);
    expect(opToBridgeMessage(op)).toMatchObject({ padding: 1 });
  });

  it("area nad výberom; samotný fit=selection ostáva bez okraja ako tlačidlo", () => {
    const sel = planCamera({ preset: "front", fit: "selection", area: "back" }, []);
    expect(opToBridgeMessage(parseOps(sel.ops[0])[0])).toEqual({ type: "SET_CAMERA", preset: "front", fit: "selection", padding: 1.4, area: "back" });
    expect(planCamera({ fit: "selection" }, []).ops).toEqual(["camera:keep~fit=s:"]);
  });

  it("filter cieľa s area ide cez camera_sel", () => {
    const p = planCamera({ preset: "section", ifc_type: "IfcWall", area: "right" }, []);
    expect(p.ops[0]).toBe("camera_sel:section~mg=40~ar=r:t=IfcWall");
    expect(opToBridgeMessage(parseOps(p.ops[0])[0])).toMatchObject({ selector: { types: ["IfcWall"] }, area: "right", padding: 1.4 });
  });

  it("chybný vstup", () => {
    expect(() => planCamera({ preset: "section", area: "left" }, [])).toThrow(/potrebujú cieľ/);
    expect(() => planCamera({ fit: "visible", margin_percent: 20 }, [])).toThrow(/potrebujú cieľ/);
    expect(() => planCamera({ area: "middle" }, [STAIR])).toThrow(/area musí/);
    expect(() => planCamera({ margin_percent: 400 }, [STAIR])).toThrow(/margin_percent/);
    expect(() => planCamera({ margin_percent: "40" }, [STAIR])).toThrow(/margin_percent/);
    expect(() => planCamera({ zoom_percent: 20, margin_percent: 20 }, [])).toThrow(/samostatnom volaní|potrebujú cieľ/);
  });

  it("parseOps zahodí okraj mimo rozsahu a neznámu časť", () => {
    expect(parseOps(`camera:keep~mg=900~ar=x:${STAIR}`)).toEqual([{ op: "camera", preset: "keep", guids: [STAIR] }]);
    expect(parseOps(`camera:keep~mg=0~ar=k:${STAIR}`)).toEqual([{ op: "camera", preset: "keep", guids: [STAIR], marginPercent: 0, area: "back" }]);
  });
});
