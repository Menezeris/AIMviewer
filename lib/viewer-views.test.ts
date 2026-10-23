import { describe, expect, it } from "vitest";

import { opToBridgeMessage, parseOps } from "./viewer-ops";
import { MAX_BASKET_GUIDS, isViewWire, parseViewsOp, viewActivateOp, viewCaptureOp, viewsLoadMessage } from "./viewer-views";
import { wireView } from "./views/testing";

describe("pohľady z Presentation (D-161): ops", () => {
  it("view_activate a view_capture prejdú ops reťazcom až na bridge správy forku", () => {
    const ops = [viewActivateOp({ id: "5b5a6f0e-2b7b-4a53-8d3e-7a1f6c2d9e01" }), viewActivateOp({ name: "Pôdorys: 1NP; hlavný" }), viewCaptureOp({ name: "Rez A", capture_id: "c1" }), viewCaptureOp()];
    expect(parseOps(ops.join(";")).map(opToBridgeMessage)).toEqual([
      { type: "VIEW_ACTIVATE", id: "5b5a6f0e-2b7b-4a53-8d3e-7a1f6c2d9e01" },
      { type: "VIEW_ACTIVATE", name: "Pôdorys: 1NP; hlavný" },
      { type: "VIEW_CAPTURE", name: "Rez A", capture_id: "c1" },
      { type: "VIEW_CAPTURE" },
    ]);
  });

  it("neplatné ops sa zahodia (vstup je z URL)", () => {
    expect(parseOps("view_activate::")).toEqual([]);
    expect(parseOps("view_activate::!!!")).toEqual([]);
    expect(parseOps(`view_activate::${viewCaptureOp({}).split("::")[1]}`)).toEqual([]);
    expect(parseViewsOp("view_capture", "e30")).toEqual({ op: "view_capture" });
    expect(parseOps("view_capture::bm90LWpzb24")).toEqual([]);
  });
});

describe("ViewWire", () => {
  it("platný pohľad prejde, neplatný riadok nie", () => {
    expect(isViewWire(wireView())).toBe(true);
    expect(isViewWire({ ...wireView(), camera: null, section: null })).toBe(true);
    expect(isViewWire({ ...wireView(), order: 1.5 })).toBe(false);
    expect(isViewWire({ ...wireView(), name: "" })).toBe(false);
    expect(isViewWire({ ...wireView(), source: "auto" })).toBe(false);
    expect(isViewWire({ ...wireView(), basket: { scope: "all" } })).toBe(false);
    expect(isViewWire({ ...wireView(), basket: { scope: "guids", guids: Array.from({ length: MAX_BASKET_GUIDS + 1 }, () => "G") } })).toBe(false);
    expect(isViewWire({ ...wireView(), section: { planes: [], active: 0 } })).toBe(false);
  });

  it("VIEWS_LOAD nesie zdroj mosta a najviac 500 pohľadov", () => {
    const many = Array.from({ length: 600 }, (_, i) => wireView({ order: i }));
    const msg = viewsLoadMessage(many);
    expect(msg).toMatchObject({ source: "aim-bridge", type: "VIEWS_LOAD" });
    expect(msg.views).toHaveLength(500);
  });
});
