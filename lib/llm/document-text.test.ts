import { describe, expect, it } from "vitest";

import { foldText, matchBlocks, parseBlocks, queryStems, regionAround, type TextBlock } from "./document-text";

// Výrez z pôdorysu D.1.1.01 1NP (riadky z etl/pdf_text.py, bbox v % strany).
const BLOCKS: TextBlock[] = [
  { t: "1.05", x: 38.33, y: 56.05, w: 0.75, h: 1.2 },
  { t: "Technická miestnosť", x: 37.48, y: 57.46, w: 2.46, h: 0.8 },
  { t: "Technické priestory", x: 82.25, y: 9.72, w: 1.92, h: 0.66 },
  { t: "SN11 01 sklenená priečka, požiarna odolnosť EI30", x: 85, y: 40, w: 10, h: 0.7 },
  { t: "250", x: 99, y: 99.5, w: 0.8, h: 0.4 },
];

describe("text dokumentov s polohou (D-123)", () => {
  it("dopyt sa skladá ako v RPC: bez diakritiky, slová od 6 písmen bez koncovky, kódy celé", () => {
    expect(foldText("Požiarna ODOLNOSŤ")).toBe("poziarna odolnost");
    expect(queryStems("požiarna odolnosť DD01 1.05")).toEqual(["poziar", "odolno", "dd01", "1.05"]);
    expect(queryStems(" .. ")).toEqual([]);
  });

  it("zhoda so všetkými slovami má prednosť a skloňovanie nevadí", () => {
    const m = matchBlocks(BLOCKS, "požiarnej odolnosti");
    expect(m.map((x) => x.text)).toEqual(["SN11 01 sklenená priečka, požiarna odolnosť EI30"]);
  });

  it("keď slová ležia v rôznych riadkoch, vráti riadky s najviac slovami zhora nadol", () => {
    const m = matchBlocks(BLOCKS, "1.05 technická");
    expect(m.map((x) => x.text)).toEqual(["Technické priestory", "1.05", "Technická miestnosť"]);
    expect(matchBlocks(BLOCKS, "výťah")).toEqual([]);
  });

  it("výrez pre open_drawing region má najmenej 15 % na os, stred v riadku a leží na strane", () => {
    const [m] = matchBlocks(BLOCKS, "1.05");
    expect(m.bbox).toEqual({ x: 38.3, y: 56.1, width: 0.8, height: 1.2 });
    expect(m.region.width).toBe(15);
    expect(m.region.x + m.region.width / 2).toBeCloseTo(38.33 + 0.75 / 2, 0);
    const corner = regionAround(BLOCKS[4]);
    expect(corner.x + corner.width).toBeLessThanOrEqual(100);
    expect(corner.y + corner.height).toBeLessThanOrEqual(100);
    expect(regionAround({ x: 0, y: 0, w: 100, h: 100 })).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("neplatné riadky z JSONB zahodí", () => {
    expect(parseBlocks(null)).toEqual([]);
    expect(parseBlocks([{ t: "a", x: 1, y: 1, w: 1, h: 1 }, { t: 1 }, { t: "b", x: "1" }])).toHaveLength(1);
  });
});
