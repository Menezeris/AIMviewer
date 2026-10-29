import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isValidGeorefV1 } from "./drawing";
import {
  calibrationFromV1,
  isValidCalibration,
  isValidGeorefV2,
  mergeCalibration,
  primaryV1,
  sameSlot,
  toGeorefV2,
  visibilityOnlyUpdate,
  type GeorefCalibration,
  type GeorefV1,
} from "./georef";

const V1: GeorefV1 = {
  version: 1,
  storey_guid: "2VefEmfcj8sx0WLKr$GNnn",
  storey_z: 0,
  page: 1,
  page_size: [3260.04, 1683.72],
  affine: [0.0176, 0, 25.5, 0, 0.0176, -12.1],
  calibration: [
    { pdf_pt: [454.6, 795.3], ifc_m: [33.5, 1.9] },
    { pdf_pt: [1886.9, 823.9], ifc_m: [58.8, 2.4] },
  ],
  opacity: 0.6,
  visible: true,
  discipline: "ASR",
  calibrated_at: null,
};

const plan = (source: "manual" | "auto", tx = 25.5): GeorefCalibration => ({
  ...toGeorefV2(V1).calibrations[0],
  affine: [0.0176, 0, tx, 0, 0.0176, -12.1],
  source,
});

const section = (x: number, source: "manual" | "auto" = "auto"): GeorefCalibration => ({
  page: 1,
  page_size: [3370.56, 2383.92],
  plane: { origin: [x, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  affine: [0.0176, 0, -14, 0, 0.0176, -18.3],
  calibration: [
    { pdf_pt: [200, 1300], ifc_m: [-10.5, 4.6] },
    { pdf_pt: [1600, 1300], ifc_m: [14.2, 4.6] },
  ],
  source,
});

describe("_georef v2 (D-133)", () => {
  it("v1 sa číta ako v2 s jednou ručnou kalibráciou pôdorysu", () => {
    const g = toGeorefV2(V1);
    expect(isValidGeorefV2(g)).toBe(true);
    expect(g.calibrations).toHaveLength(1);
    expect(g.calibrations[0]).toMatchObject({ source: "manual", plane: null, storey_guid: V1.storey_guid });
  });

  it("validácia: pôdorys bez podlažia, nejednotková rovina a zrkadlový nulový affine neprejdú", () => {
    expect(isValidCalibration(section(47.42))).toBe(true);
    expect(isValidCalibration({ ...plan("auto"), storey_guid: null })).toBe(false);
    expect(isValidCalibration({ ...section(1), plane: { origin: [0, 0, 0], u: [0, 2, 0], v: [0, 0, 1] } })).toBe(false);
    expect(isValidCalibration({ ...section(1), plane: { origin: [0, 0, 0], u: [0, 1, 0], v: [0, 1, 0] } })).toBe(false);
    expect(isValidCalibration({ ...plan("auto"), affine: [0, 0, 1, 0, 0, 1] })).toBe(false);
    expect(isValidCalibration({ ...plan("auto"), source: "x" })).toBe(false);
    expect(toGeorefV2({ version: 3 })).toEqual({ version: 2, calibrations: [] });
  });

  it("miesto: strana + podlažie, pri reze rovina do 1 cm", () => {
    expect(sameSlot(plan("auto"), plan("manual"))).toBe(true);
    expect(sameSlot(plan("auto"), { ...plan("auto"), page: 2 })).toBe(false);
    expect(sameSlot(section(47.42), section(47.425))).toBe(true);
    expect(sameSlot(section(47.42), section(47.5))).toBe(false);
    expect(sameSlot(section(47.42), plan("auto"))).toBe(false);
  });

  it("auto neprepíše ručnú bez force, s force áno; iné miesto pridá", () => {
    const blocked = mergeCalibration(V1, plan("auto", 26));
    expect(blocked.ok).toBe(false);
    const forced = mergeCalibration(V1, plan("auto", 26), true);
    expect(forced.ok && forced.georef.calibrations).toHaveLength(1);
    expect(forced.ok && forced.georef.calibrations[0].affine[2]).toBe(26);
    const added = mergeCalibration(V1, section(47.42));
    expect(added.ok && added.georef.calibrations.map((c) => c.source)).toEqual(["manual", "auto"]);
    const manualOverAuto = mergeCalibration({ version: 2, calibrations: [plan("auto")] }, plan("manual", 27));
    expect(manualOverAuto.ok && manualOverAuto.replaced?.source).toBe("auto");
  });

  it("primaryV1 pre dnešný fork: pôdorysná, ručná má prednosť, rezy nie", () => {
    expect(primaryV1({ version: 2, calibrations: [section(47.42)] })).toBeNull();
    const v1 = primaryV1({ version: 2, calibrations: [section(47.42), plan("auto", 26), { ...plan("manual", 27), page: 2 }] })!;
    expect(v1.version).toBe(1);
    expect(v1.affine[2]).toBe(27);
    expect(v1.calibration).toHaveLength(2);
  });
});

describe("jednobodová kalibrácia panela (#317)", () => {
  const one = { ...V1, calibration: [V1.calibration[0]] };
  it("v1 s 1 bodom prejde validáciou zápisu, 0 a 3 body ani nulový affine nie", () => {
    expect(isValidGeorefV1(one)).toBe(true);
    expect(isValidGeorefV1({ ...V1, calibration: [] })).toBe(false);
    expect(isValidGeorefV1({ ...V1, calibration: [...V1.calibration, V1.calibration[0]] })).toBe(false);
    expect(isValidGeorefV1({ ...one, affine: [0, 0, 1, 0, 0, 1] })).toBe(false);
  });
  it("po zápise sa číta späť ako pôdorys (toGeorefV2 -> primaryV1)", () => {
    const merged = mergeCalibration(undefined, calibrationFromV1(one, "manual"), true);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(isValidGeorefV2(merged.georef)).toBe(true);
    expect(primaryV1(toGeorefV2(merged.georef))?.calibration).toEqual([V1.calibration[0]]);
  });
});

describe("visibilityOnlyUpdate (D-168): uloženie visible a opacity z viewera", () => {
  const auto = (): GeorefCalibration => ({
    ...plan("auto"),
    quality: { method: "rooms+icp", median_mm: 12, p90_mm: 30, cv_max_mm: 20, start_points: 8 },
    calibrated_at: "2026-10-22T10:00:00.000Z",
    // auto kalibrácia má viac bodov než v1
    calibration: [...V1.calibration, { pdf_pt: [900, 900], ifc_m: [41, 3] }],
  });

  it("nezmenená poloha: zmení sa len visible a opacity, source a quality ostanú", () => {
    const stored = { version: 2, calibrations: [auto()] };
    const upd = visibilityOnlyUpdate(stored, { ...V1, visible: false, opacity: 0.3 });
    expect(upd).toMatchObject({ source: "auto", visible: false, opacity: 0.3, calibrated_at: "2026-10-22T10:00:00.000Z", quality: { method: "rooms+icp" } });
    expect(upd!.affine).toEqual(auto().affine);
    expect(upd!.calibration).toHaveLength(3);
  });

  it("zmenená poloha, iná strana alebo žiadna kalibrácia = null (ide bežná cesta)", () => {
    const stored = { version: 2, calibrations: [auto()] };
    expect(visibilityOnlyUpdate(stored, { ...V1, affine: [0.0176, 0, 26, 0, 0.0176, -12.1] })).toBeNull();
    expect(visibilityOnlyUpdate(stored, { ...V1, page: 2 })).toBeNull();
    expect(visibilityOnlyUpdate(stored, { ...V1, calibration: [{ pdf_pt: [1, 1], ifc_m: [2, 2] }] })).toBeNull();
    expect(visibilityOnlyUpdate(undefined, V1)).toBeNull();
  });

  it("mergeCalibration s výsledkom nahradí tú istú položku a zachová source manual aj auto", () => {
    const manual = { ...plan("manual"), visible: true };
    const upd = visibilityOnlyUpdate({ version: 2, calibrations: [manual] }, { ...V1, visible: false })!;
    const merged = mergeCalibration({ version: 2, calibrations: [manual] }, upd, true);
    expect(merged.ok && merged.georef.calibrations).toEqual([{ ...manual, visible: false, opacity: 0.6 }]);
  });
});
