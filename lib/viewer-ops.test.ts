import { describe, expect, it } from "vitest";

import {
  SECTION_CLEAR_OP,
  cameraOp,
  docOp,
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
    expect(parseOps("view:4d:")).toEqual([]);
  });

  it("ops prežijú URL kódovanie (GUID s $)", () => {
    const raw = [sectionOp({ storeyGuid: G1 }), cameraOp("top", [G1])].join(";");
    const back = new URLSearchParams(`ops=${encodeURIComponent(raw)}`).get("ops")!;
    expect(parseOps(back)).toHaveLength(2);
  });
});
