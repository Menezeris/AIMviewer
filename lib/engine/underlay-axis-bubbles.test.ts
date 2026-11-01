import { describe, expect, it } from "vitest";

import type { MergeResult } from "../data/georef";

import type { MeshElement } from "./measure";
import { bubbleAxes } from "./underlay-axis-bubbles";
import {
  PT_M,
  applyAffine,
  axisStart,
  calibratePlan,
  checkAxes,
  checkRotation,
  decompose,
  gridRotations,
  invertAffine,
  rotationAffine,
  type Affine,
  type P2,
  type PageBlock,
  type PageLine,
  type RefAxis,
  type Seg,
} from "./underlay-calibrate";
import { execCalibrateUnderlay, type UnderlayDeps } from "./underlay-tool";

/**
 * D-184 dodatok (#170): osi z radov bublín. Pôdorys natočený na hárku (SF.01: sieť osí 19° na strane, kalibrácia
 * -109,05°), raster bez čiar konštrukcií (len krúžky osí) a výsek s osou len na jednom konci (TP.01).
 */

const PAGE: P2 = [3260, 1190];
const S = 100 * PT_M;
const ROT = -109.05;
const T: Affine = (() => {
  const m = rotationAffine(S, ROT);
  m[2] = 33.05;
  m[5] = 26.19;
  return m;
})();
const INV = invertAffine(T);
const LETTERS = ["A", "B", "C", "D", "E", "F"];
const NUMBERS = ["1", "2", "3", "4"];
const AX = (i: number) => 62.9 - 6.5 * i;
const AY = (i: number) => 12.85 - 6.5 * i;
const REFS: RefAxis[] = [...LETTERS.map((text, i) => ({ text, dir: "x" as const, at: AX(i), sheets: 3 })), ...NUMBERS.map((text, i) => ({ text, dir: "y" as const, at: AY(i), sheets: 3 }))];

const block = (t: string, p: P2): PageBlock => ({ t, x: (p[0] / PAGE[0]) * 100 - 0.1, y: (1 - p[1] / PAGE[1]) * 100 - 0.3, w: 0.2, h: 0.6 });
/** Bubliny pôdorysu v modeli (m): písmená nad aj pod budovou, čísla len vľavo (os na jednom konci). */
function bubbles(inv: Affine, yTop = 18, yBot = -13.5, xLeft = 24): { blocks: PageBlock[]; at: P2[] } {
  const at: P2[] = [];
  const blocks: PageBlock[] = [];
  LETTERS.forEach((t, i) => {
    for (const y of [yTop, yBot]) {
      at.push([AX(i), y]);
      blocks.push(block(t, applyAffine(inv, [AX(i), y])));
    }
  });
  NUMBERS.forEach((t, i) => {
    at.push([xLeft, AY(i)]);
    blocks.push(block(t, applyAffine(inv, [xLeft, AY(i)])));
  });
  return { blocks, at };
}

/** Krúžok bubliny (polomer 0,25 m) na strane ako 12 úsečiek (raster SF.01 má vo vektoroch len tieto). */
function circles(inv: Affine, at: P2[]): PageLine[] {
  const out: PageLine[] = [];
  for (const c of at) {
    for (let k = 0; k < 12; k++) {
      const a = applyAffine(inv, [c[0] + 0.25 * Math.cos((k * Math.PI) / 6), c[1] + 0.25 * Math.sin((k * Math.PI) / 6)]);
      const b = applyAffine(inv, [c[0] + 0.25 * Math.cos(((k + 1) * Math.PI) / 6), c[1] + 0.25 * Math.sin(((k + 1) * Math.PI) / 6)]);
      out.push([a[0], a[1], b[0], b[1], 0.51]);
    }
  }
  return out;
}

/** Obvodové steny budovy (X 30 až 63, Y -8 až 13) ako rez modelu. */
const OUTLINE: Seg[] = [
  [30, -8, 63, -8],
  [63, -8, 63, 13],
  [63, 13, 30, 13],
  [30, 13, 30, -8],
];

const near = (a: Affine, b: Affine) => Math.max(...([[0, 0], PAGE] as P2[]).map((p) => Math.hypot(applyAffine(a, p)[0] - applyAffine(b, p)[0], applyAffine(a, p)[1] - applyAffine(b, p)[1])));

describe("osi z radov bublín (D-184 dodatok)", () => {
  it("natočená sieť: natočenie a posun z bublín, aj keď sú čísla len na jednom konci a do výrezu zasahuje susedný pôdorys", () => {
    const own = bubbles(INV);
    // Susedný pôdorys hárku (o 848 pt vpravo): jeho rad D, E, F a os 2 zasahujú do výrezu.
    const shift = (b: PageBlock): PageBlock => ({ ...b, x: b.x + (848 / PAGE[0]) * 100 });
    const neighbour = own.blocks.filter((b, i) => (["D", "E", "F"].includes(b.t) && i % 2 === 1) || b.t === "2").map(shift);
    const noise = [block("2", [2900, 300]), block("B", [3100, 900])];
    const g = bubbleAxes(PAGE, [...own.blocks, ...neighbour, ...noise], REFS, S)!;
    expect(g).not.toBeNull();
    expect(g.gridDeg).toBeCloseTo(-ROT - 0, 1);
    expect(g.rows).toEqual(expect.arrayContaining(["ABCDEF", "1234"]));
    const st = axisStart(g.lines, REFS, S, gridRotations(g.gridDeg))!;
    expect(st.rotation).toBeCloseTo(ROT, 1);
    expect(near(st.affine, T)).toBeLessThan(0.02);
    expect(checkAxes(st.affine, g.lines, REFS)).toMatchObject({ ok: true });
    // Sieť v smere strany (TP.01): natočenia sú presne násobky 90°.
    expect(gridRotations(0)).toEqual([0, 90, -180, -90]);
  });

  it("rad bublín sa overí rozostupom osí: popisky s iným rozostupom nie sú rad", () => {
    const bad = LETTERS.map((t, i) => block(t, [400 + i * 120, 600]));
    expect(bubbleAxes(PAGE, bad, REFS, S)).toBeNull();
  });

  it("výsek s osami na jednom konci (TP.01 1NP): rad čísel a jedna os C dajú štart s natočením 0°", () => {
    const A: Affine = [S, 0, -0.014, 0, S, -24.976];
    const inv = invertAffine(A);
    const blocks = [
      ...NUMBERS.slice(0, 3).map((t, i) => block(t, applyAffine(inv, [24, AY(i)]))),
      ...NUMBERS.slice(0, 3).map((t, i) => block(t, applyAffine(inv, [66, AY(i)]))),
      block("C", applyAffine(inv, [AX(2), 18])),
      block("C", applyAffine(inv, [AX(2), -13])),
    ];
    const g = bubbleAxes(PAGE, blocks, REFS, S)!;
    expect(g.gridDeg).toBeCloseTo(0, 3);
    const st = axisStart(g.lines, REFS, S, gridRotations(g.gridDeg))!;
    expect(st.rotation).toBe(0);
    expect(near(st.affine, A)).toBeLessThan(0.02);
  });

  it("raster (len krúžky osí pri stenách): ICP by osi posunulo, ostane štart z osí; natočenie sa kontroluje voči sieti", () => {
    // Bubliny 0,8 m od obvodových stien: ICP ich pritiahne na steny a posunie celý výkres.
    const own = bubbles(INV, 13.8, -8.8, 29.2);
    const lines = circles(INV, own.at);
    const g = bubbleAxes(PAGE, own.blocks, REFS, S)!;
    const res = calibratePlan({ pageSize: PAGE, blocks: own.blocks, lines, spaces: [], cut: OUTLINE, scale: 100, axes: { page: g.lines, ref: REFS, gridDeg: g.gridDeg } });
    expect(res.start.method).toBe("plan_axes");
    expect(res.icp_rejected).toMatchObject({ reason: "axes" });
    expect(res.icp_pairs).toBe(0);
    expect(near(res.affine, T)).toBeLessThan(0.02);
    expect(decompose(res.affine).rotationDeg).toBeCloseTo(ROT, 1);
    // Tolerancia 2° ostáva: voči sieti osí strany sedí, voči násobku 90° nie.
    expect(checkRotation(res.rotation_deg, "plan", g.gridDeg)).toMatchObject({ ok: true });
    expect(checkRotation(res.rotation_deg, "plan").ok).toBe(false);
    expect(checkRotation(res.rotation_deg + 3, "plan", g.gridDeg).ok).toBe(false);
  });
});

/** Stena (kváder) v IFC ako mesh motora (Y-up: x, z, -y). */
function wall(s: Seg, i: number): MeshElement {
  const [x0, y0, x1, y1] = s;
  const nx = -(y1 - y0);
  const ny = x1 - x0;
  const L = Math.hypot(nx, ny);
  const o: P2 = [(nx / L) * 0.1, (ny / L) * 0.1];
  const c = [
    [x0 - o[0], y0 - o[1], -1],
    [x1 - o[0], y1 - o[1], -1],
    [x1 + o[0], y1 + o[1], -1],
    [x0 + o[0], y0 + o[1], -1],
    [x0 - o[0], y0 - o[1], 3],
    [x1 - o[0], y1 - o[1], 3],
    [x1 + o[0], y1 + o[1], 3],
    [x0 + o[0], y0 + o[1], 3],
  ];
  return {
    globalId: `W${i}`,
    expressId: i,
    model: "ASR",
    ifcType: "IfcWall",
    name: null,
    positions: Float32Array.from(c.flatMap(([x, y, z]) => [x, z, -y])),
    indices: Uint32Array.from([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]),
    parts: [0],
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  };
}

describe("calibrate_underlay: natočený raster s osami (D-184 dodatok)", () => {
  it("dry_run nájde polohu z osí, auto ju neuloží (ICP zamietnuté), osi a natočenie sú vo výsledku", async () => {
    const own = bubbles(INV, 13.8, -8.8, 29.2);
    const lines = circles(INV, own.at);
    // Referenčný pôdorys v smere strany s dvojicami popiskov osí (ako ručné ASR pôdorysy).
    const REF_PAGE: P2 = [3000, 1700];
    const R: Affine = [0.0176, 0, 25.5, 0, 0.0176, -12.1];
    const rinv = invertAffine(R);
    const pct = (t: string, p: P2): PageBlock => ({ t, x: (p[0] / REF_PAGE[0]) * 100 - 0.2, y: (1 - p[1] / REF_PAGE[1]) * 100 - 0.3, w: 0.4, h: 0.6 });
    const refBlocks: PageBlock[] = [];
    LETTERS.forEach((t, i) => refBlocks.push(pct(t, applyAffine(rinv, [AX(i), 18])), pct(t, applyAffine(rinv, [AX(i), -14]))));
    NUMBERS.forEach((t, i) => refBlocks.push(pct(t, applyAffine(rinv, [26, AY(i)])), pct(t, applyAffine(rinv, [67, AY(i)]))));
    const writes: unknown[] = [];
    const deps: UnderlayDeps = {
      document: async () => ({ id: "sf", object_ref: "SF01", name: "SF.01", georef: undefined, floors: [{ guid: "G1", name: "1NP" }] }),
      page: async () => ({ blocks: own.blocks, lines: { size: PAGE, segs: lines } }),
      model: async () => ({ id: "ASR", elements: OUTLINE.map(wall), storey: { guid: "G1", name: "1NP", z: 0, spaceGuids: [] } }),
      planSheets: async () => [{ ref: "REF", page: 1, affine: R, pageSize: REF_PAGE as [number, number], blocks: refBlocks }],
      write: async (_id, apply) => {
        const r: MergeResult = apply(undefined);
        if (r.ok) writes.push(r.georef);
        return r;
      },
      writeEnabled: true,
      now: () => new Date("2026-11-01T12:00:00Z"),
    };
    const dry = await execCalibrateUnderlay({ document_id: "SF01", scale: 100 }, deps);
    expect(dry.isError, dry.text).toBe(false);
    const o = JSON.parse(dry.text);
    expect(o.start.method).toBe("plan_axes");
    expect(o.axes_check).toMatchObject({ ok: true, page_axes: "bubbles" });
    expect(o.axes_check.median_mm).toBeLessThan(20);
    expect(o.rotation_check).toMatchObject({ ok: true });
    expect(o.rotation_check.expected_deg).toBeCloseTo(ROT, 1);
    expect(o.icp_rejected).toMatchObject({ reason: "axes" });
    expect(o.plausible).toBe(true);
    expect(near(o.calibration.affine as Affine, T)).toBeLessThan(0.02);

    const auto = JSON.parse((await execCalibrateUnderlay({ document_id: "SF01", scale: 100, mode: "auto" }, deps)).text);
    expect(auto.written).toBe(false);
    expect(auto.note).toMatch(/len štart z osí/);
    expect(writes).toHaveLength(0);
  });
});
