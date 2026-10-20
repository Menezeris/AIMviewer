import { describe, expect, it } from "vitest";

import {
  SECTION_CLEAR_OP,
  cameraOp,
  clampDocRegion,
  docOp,
  docRegionInput,
  opToBridgeMessage,
  parseOps,
  sectionOp,
  viewModeOp,
} from "./viewer-ops";

const G1 = "0MJFXziqDE$gGyPWwro9fq";
const G2 = "27hbQtAoP6qvoEYhPARoI7";
const DOC = "117dbd02-47d9-4fae-8170-5f8b2ea76040";

const bridge = (raw: string) => parseOps(raw).map(opToBridgeMessage);

describe("viewer ops - existujúce operácie (D-066, D-082)", () => {
  it("ofarbenie, skrytie, selektor, výber a resety sa prekladajú bez zmeny", () => {
    expect(
      bridge(`colorize:ef4444:${G1}.${G2};hide_sel::t=IfcWall.IfcSlab~m=VZT;select::${G1};show_all::;reset_colors::`),
    ).toEqual([
      { type: "COLORIZE", guids: [G1, G2], color: "#ef4444" },
      { type: "HIDE", selector: { types: ["IfcWall", "IfcSlab"], model: "VZT" } },
      { type: "SELECT", guid: G1 },
      { type: "SHOW_ALL" },
      { type: "RESET_COLORS" },
    ]);
  });

  it("clear_focus zruší len zvýraznenie (D-101, #94)", () => {
    expect(bridge("clear_focus::")).toEqual([{ type: "CLEAR_FOCUS" }]);
    expect(bridge("clear_selection::")).toEqual([{ type: "CLEAR_SELECTION" }]);
  });

  it("chybné časti sa zahodia", () => {
    expect(parseOps("colorize:red:A;isolate::;bogus:x:y")).toEqual([]);
  });
});

describe("viewer ops - pohľad (D-083)", () => {
  it("rez nad podlažím: builder -> parse -> bridge správa", () => {
    expect(bridge(sectionOp({ storeyGuid: G2, offsetM: -0.4 }))).toEqual([
      { type: "SET_SECTION", action: "set", axis: "y", storeyGuid: G2, offsetM: -0.4 },
    ]);
    // Bez výšky platí 1,2 m (výška pôdorysného rezu).
    expect(bridge(`section:y:${G2}`)[0]).toMatchObject({ offsetM: 1.2 });
  });

  it("zvislý rez v percentách a zrušenie rezu", () => {
    expect(bridge(`${sectionOp({ axis: "x", position: 40, flipped: true })};${SECTION_CLEAR_OP}`)).toEqual([
      { type: "SET_SECTION", action: "set", axis: "x", position: 40, flipped: true },
      { type: "SET_SECTION", action: "clear" },
    ]);
  });

  it("rez bez podlažia aj polohy, alebo zvislý s podlažím, sa zahodí", () => {
    expect(parseOps("section:y:")).toEqual([]);
    expect(parseOps(`section:x~h=1:${G2}`)).toEqual([]);
    expect(parseOps(`section:y~h=99:${G2}`)[0]).toMatchObject({ offsetM: 1.2 });
  });

  it("kamera s projekciou a cieľom", () => {
    expect(bridge(cameraOp("top", [G1, G2], "orthographic"))).toEqual([
      { type: "SET_CAMERA", preset: "top", projection: "orthographic", guids: [G1, G2] },
    ]);
    expect(bridge(cameraOp("iso"))).toEqual([{ type: "SET_CAMERA", preset: "iso" }]);
    expect(parseOps("camera:diagonal:")).toEqual([]);
  });

  it("režim a podlažie, dokument so stranou", () => {
    expect(bridge(`${viewModeOp("2d", G2)};${docOp(DOC, 3)};${viewModeOp("3d")}`)).toEqual([
      { type: "SET_VIEW_MODE", mode: "2d", storeyGuid: G2 },
      { type: "DOCUMENT_OPEN", documentId: DOC, page: 3 },
      { type: "SET_VIEW_MODE", mode: "3d" },
    ]);
    expect(parseOps("doc:1:nie-uuid")).toEqual([]);
  });

  it("dokument s výrezom strany (D-117): percentá na drôte, zlomky v bridge správe", () => {
    const op = docOp(DOC, 2, { x: 50, y: 0, w: 50, h: 25 });
    expect(op).toBe(`doc:2~r=50_0_50_25:${DOC}`);
    expect(bridge(op)).toEqual([
      { type: "DOCUMENT_OPEN", documentId: DOC, page: 2, region: { x: 0.5, y: 0, w: 0.5, h: 0.25 } },
    ]);
    // Bez strany: výrez na strane, kde karta je.
    expect(parseOps(docOp(DOC, undefined, { x: 10, y: 10, w: 20, h: 20 }))).toEqual([
      { op: "doc", documentId: DOC, region: { x: 10, y: 10, w: 20, h: 20 } },
    ]);
    // Chybný výrez sa zahodí, dokument sa otvorí celý.
    expect(parseOps(`doc:3~r=10_abc_5_5:${DOC}`)).toEqual([{ op: "doc", documentId: DOC, page: 3 }]);
    expect(parseOps(`doc:3~r=120_0_10_10:${DOC}`)).toEqual([{ op: "doc", documentId: DOC, page: 3 }]);
  });

  it("výrez strany sa oreže do strany", () => {
    expect(clampDocRegion({ x: -10, y: 90, w: 30, h: 30 })).toEqual({ x: 0, y: 90, w: 20, h: 10 });
    expect(clampDocRegion({ x: 99.9, y: 0, w: 0.05, h: 10 })).toEqual({ x: 99, y: 0, w: 1, h: 10 });
    expect(clampDocRegion({ x: 0, y: 0, w: 0, h: 10 })).toBeUndefined();
    expect(docRegionInput({ x: 50, y: 0, width: 50, height: 50 })).toEqual({ x: 50, y: 0, w: 50, h: 50 });
    expect(docRegionInput({ x: 50, y: 0, width: "50", height: 50 })).toBeUndefined();
    expect(docRegionInput("vpravo hore")).toBeUndefined();
    expect(parseOps("view:4d:")).toEqual([]);
  });

  it("ops prežijú URL kódovanie (GUID s $)", () => {
    const raw = [sectionOp({ storeyGuid: G1 }), cameraOp("top", [G1])].join(";");
    const back = new URLSearchParams(`ops=${encodeURIComponent(raw)}`).get("ops")!;
    expect(parseOps(back)).toHaveLength(2);
  });
});

describe("viewer ops - rez cez prvok a na súradnici (D-085)", () => {
  const STAIR = "38a9vdh9bF5Qg28GWyHhlr";

  it("pozdĺž / naprieč: os volí viewer, správa nenesie axis", () => {
    const raw = sectionOp({ guids: [STAIR], fit: "along" });
    expect(raw).toBe(`section:auto~fit=along:${STAIR}`);
    const [op] = parseOps(raw);
    expect(op).toEqual({ op: "section", guids: [STAIR], fit: "along" });
    expect(opToBridgeMessage(op)).toEqual({ type: "SET_SECTION", action: "set", guids: [STAIR], fit: "along" });
    expect(parseOps(sectionOp({ guids: [STAIR], fit: "across", flipped: true }))).toEqual([
      { op: "section", guids: [STAIR], fit: "across", flipped: true },
    ]);
  });

  it("stredom prvku na zadanej osi a presná súradnica IFC", () => {
    expect(parseOps(sectionOp({ guids: [STAIR], fit: "center", axis: "y" }))).toEqual([
      { op: "section", axis: "y", guids: [STAIR], fit: "center" },
    ]);
    const raw = sectionOp({ axis: "z", coordinate: -12.5 });
    expect(raw).toBe("section:z~c=-12.5:");
    expect(opToBridgeMessage(parseOps(raw)[0])).toEqual({ type: "SET_SECTION", action: "set", axis: "z", coordinate: -12.5 });
  });

  it("neplatné kombinácie sa zahodia", () => {
    for (const raw of [
      `section:x~fit=along:${STAIR}`, // along s pevnou osou
      `section:auto~fit=center:${STAIR}`, // center bez osi
      "section:auto~fit=along:", // bez cieľa
      `section:auto~fit=diagonal:${STAIR}`,
      `section:x~c=5:${STAIR}`, // súradnica s cieľom
      "section:x~c=abc:",
      "section:x~c=1e9:",
      `section:auto~fit=along:${Array(101).fill(STAIR).join(".")}`,
    ]) {
      expect(parseOps(raw), raw).toEqual([]);
    }
  });
});

describe("viewer ops - widget rezu (#63)", () => {
  it("g=0/1 pri reze a section_gizmo idú do bridge ako showGizmo", () => {
    const op = parseOps(sectionOp({ axis: "z", coordinate: 3, showGizmo: false }))[0];
    expect(opToBridgeMessage(op)).toEqual({ type: "SET_SECTION", action: "set", axis: "z", coordinate: 3, showGizmo: false });
    expect(opToBridgeMessage(parseOps("section_gizmo:1:")[0])).toEqual({ type: "SET_SECTION", action: "gizmo", showGizmo: true });
    expect(parseOps("section_gizmo:x:")).toEqual([]);
    expect(sectionOp({ storeyGuid: G2, offsetM: 1 })).not.toContain("g=");
  });
});
