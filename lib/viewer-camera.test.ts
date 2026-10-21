import { describe, expect, it } from "vitest";

import { hasRelativeStep, relativeViewpoint, visibleArea, type ViewerCamera } from "./viewer-camera";
import { appliedText } from "./live/applied-text";

/** Kamera 10 m južne od cieľa vo výške cieľa, pohľad na sever (IFC: Y sever, Z hore). */
const SOUTH: ViewerCamera = {
  position: { x: 0, y: -10, z: 0 },
  target: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 0, z: 1 },
  projection: "perspective",
  fov_deg: 90,
  aspect: 2,
};

const close = (v: { x: number; y: number; z: number }, x: number, y: number, z: number) => {
  expect(v.x).toBeCloseTo(x, 6);
  expect(v.y).toBeCloseTo(y, 6);
  expect(v.z).toBeCloseTo(z, 6);
};

describe("relativeViewpoint (D-098)", () => {
  it("zoom: oddiaľ o 15 % = vzdialenosť x 1,15, priblíž o 25 % = / 1,25", () => {
    close(relativeViewpoint(SOUTH, { zoomPercent: -15 }).position, 0, -11.5, 0);
    close(relativeViewpoint(SOUTH, { zoomPercent: 25 }).position, 0, -8, 0);
  });

  it("zoom v ortografii mení polovicu výšky pohľadu, nie polohu", () => {
    const vp = relativeViewpoint({ ...SOUTH, projection: "orthographic", ortho_size: 20 }, { zoomPercent: -50 });
    expect(vp.orthoSize).toBeCloseTo(30, 6);
    close(vp.position, 0, -10, 0);
  });

  it("orbit_h kladný = kamera obehne cieľ doľava", () => {
    // Pri pohľade na sever je vľavo západ (-X).
    const vp = relativeViewpoint(SOUTH, { orbitH: 90 });
    close(vp.position, -10, 0, 0);
    close(vp.target, 0, 0, 0);
  });

  it("orbit_v kladný = viac zhora, drží vzdialenosť a strop 89°", () => {
    const vp = relativeViewpoint(SOUTH, { orbitV: 30 });
    close(vp.position, 0, -10 * Math.cos(Math.PI / 6), 10 * Math.sin(Math.PI / 6));
    const top = relativeViewpoint(SOUTH, { orbitV: 89 });
    const again = relativeViewpoint({ ...SOUTH, position: top.position }, { orbitV: 30 });
    expect(Math.atan2(again.position.z, Math.hypot(again.position.x, again.position.y)) * 180 / Math.PI).toBeCloseTo(89, 6);
  });

  it("orbit_v z pôdorysu: kamera ide na stranu oproti hornej hrane obrazu", () => {
    const top: ViewerCamera = { ...SOUTH, position: { x: 0, y: 0, z: 10 }, up: { x: 0, y: 1, z: 0 } };
    const vp = relativeViewpoint(top, { orbitV: -45 });
    expect(vp.position.y).toBeLessThan(0);
    expect(vp.position.x).toBeCloseTo(0, 6);
  });

  it("posun o % šírky a výšky pohľadu presunie kameru aj cieľ", () => {
    // fov 90° na 10 m: polovica výšky 10 m, šírky 20 m; doprava = +X, hore = +Z.
    const vp = relativeViewpoint(SOUTH, { panX: 10, panY: -10 });
    close(vp.target, 4, 0, -2);
    close(vp.position, 4, -10, -2);
  });

  it("hasRelativeStep: fit nie je relatívny krok", () => {
    expect(hasRelativeStep({ fit: "visible" })).toBe(false);
    expect(hasRelativeStep({ panY: 5 })).toBe(true);
    expect(hasRelativeStep({ marginPercent: 40, area: "left" })).toBe(false);
  });
});

describe("visibleArea (D-128)", () => {
  it("perspektíva: výška = 2 * vzdialenosť * tan(FOV/2), šírka * pomer, smery obrazu v IFC", () => {
    const v = visibleArea(SOUTH)!;
    expect(v.height_m).toBeCloseTo(20, 3);
    expect(v.width_m).toBeCloseTo(40, 3);
    close(v.center, 0, 0, 0);
    // Pohľad na sever: doprava = východ (+X), hore = +Z.
    close(v.right, 1, 0, 0);
    close(v.up, 0, 0, 1);
  });

  it("ortografia: výška = 2 * ortho_size bez ohľadu na vzdialenosť", () => {
    const v = visibleArea({ ...SOUTH, projection: "orthographic", ortho_size: 0.63, aspect: 1.5 })!;
    expect(v.height_m).toBeCloseTo(1.26, 3);
    expect(v.width_m).toBeCloseTo(1.89, 3);
  });

  it("chýbajúci pomer alebo ortho_size = null, nehádame", () => {
    expect(visibleArea({ ...SOUTH, aspect: undefined })).toBeNull();
    expect(visibleArea({ ...SOUTH, projection: "orthographic" })).toBeNull();
    expect(visibleArea({ ...SOUTH, position: SOUTH.target })).toBeNull();
  });

  it("potvrdenie set_camera nesie visible, iné tooly nie", () => {
    const applied = { cmdId: "c1", ok: true, issues: [], state: { camera: SOUTH } };
    expect(appliedText("set_camera", applied)).toContain('"visible":{"center":{"x":0,"y":0,"z":0},"width_m":40,"height_m":20');
    expect(appliedText("set_section", applied)).not.toContain("visible");
    expect(appliedText("set_camera", { ...applied, state: { camera: null } })).not.toContain("visible");
  });
});
