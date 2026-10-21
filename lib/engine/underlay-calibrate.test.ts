import { describe, expect, it } from "vitest";

import {
  CalibrationError,
  applyAffine,
  calibratePairs,
  calibratePlan,
  calibrateSection,
  decompose,
  fitSimilarity,
  footprintCentroid,
  invertAffine,
  parseLevel,
  sliceTriangles,
  type Affine,
  type P2,
  type PageBlock,
  type PageLine,
  type Seg,
} from "./underlay-calibrate";

/** Deterministický šum (LCG), aby testy nezáviseli od Math.random. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Pravá kalibrácia: strana (pt) -> model (m), 1:50 s malou rotáciou. */
function trueAffine(scale: number, deg: number, t: P2, mirror = false): Affine {
  const c = Math.cos((deg * Math.PI) / 180) * scale;
  const s = Math.sin((deg * Math.PI) / 180) * scale;
  const f = mirror ? -1 : 1;
  return [f * c, -s, t[0], f * s, c, t[1]];
}

const PAGE: P2 = [3000, 1700];
const SCALE = 0.0176;

/** Model -> úsečka strany (inverzná kalibrácia) s hrúbkou čiary. */
function toPage(inv: Affine, s: Seg, w = 1.4): PageLine {
  const a = applyAffine(inv, [s[0], s[1]]);
  const b = applyAffine(inv, [s[2], s[3]]);
  return [a[0], a[1], b[0], b[1], w];
}

/** Text na strane v % (počiatok vľavo hore) okolo bodu strany. */
function block(t: string, p: P2, w = 0.8, h = 1.2): PageBlock {
  return { t, x: (p[0] / PAGE[0]) * 100 - w / 2, y: (1 - p[1] / PAGE[1]) * 100 - h / 2, w, h };
}

/** Rám miestností 4x3 (6 x 5 m) ako steny rezu v pôdoryse. */
function planModel(): { cut: Seg[]; spaces: { name: string; centroid: P2 }[] } {
  const cut: Seg[] = [];
  const spaces: { name: string; centroid: P2 }[] = [];
  for (let i = 0; i <= 4; i++) cut.push([30 + i * 6, 0, 30 + i * 6, 15]);
  for (let j = 0; j <= 3; j++) cut.push([30, j * 5, 54, j * 5]);
  // Nepravidelné steny, aby ICP malo čo chytiť aj pozdĺž.
  cut.push([33, 2, 33, 4], [41.5, 7, 44, 7], [50, 11, 50, 13.5]);
  let n = 1;
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 4; i++) spaces.push({ name: `1.${String(n++).padStart(2, "0")}`, centroid: [33 + i * 6, 2.5 + j * 5] });
  }
  return { cut, spaces };
}

describe("podobnosť a rozklad", () => {
  it("fitSimilarity vráti presnú podobnosť aj so zrkadlom", () => {
    for (const mirror of [false, true]) {
      const T = trueAffine(SCALE, 12, [25, -11], mirror);
      const P: P2[] = [[100, 200], [900, 250], [400, 1200]];
      const m = fitSimilarity(P, P.map((p) => applyAffine(T, p)), mirror)!;
      m.forEach((v, i) => expect(v).toBeCloseTo(T[i], 9));
      const d = decompose(m);
      expect(d.mirrored).toBe(mirror);
      expect(d.rotationDeg).toBeCloseTo(12, 6);
      expect(d.scale).toBeCloseTo(SCALE, 9);
    }
  });

  it("invertAffine je inverzia", () => {
    const T = trueAffine(SCALE, -3, [5, 7]);
    const p: P2 = [123, 456];
    const q = applyAffine(invertAffine(T), applyAffine(T, p));
    expect(q[0]).toBeCloseTo(p[0], 9);
    expect(q[1]).toBeCloseTo(p[1], 9);
  });
});

describe("rez a ťažisko", () => {
  // Kváder 2 x 1 x 3 m s rohom v (10, 20, 0), trojuholníky.
  const pos = [10, 20, 0, 12, 20, 0, 12, 21, 0, 10, 21, 0, 10, 20, 3, 12, 20, 3, 12, 21, 3, 10, 21, 3];
  const idx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];

  it("vodorovný rez dá obrys kvádra v (X, Y)", () => {
    const out: Seg[] = [];
    sliceTriangles(pos, idx, { origin: [0, 0, 1.2], u: [1, 0, 0], v: [0, 1, 0] }, out);
    const xs = out.flatMap((s) => [s[0], s[2]]);
    const ys = out.flatMap((s) => [s[1], s[3]]);
    expect(Math.min(...xs)).toBeCloseTo(10, 9);
    expect(Math.max(...xs)).toBeCloseTo(12, 9);
    expect(Math.min(...ys)).toBeCloseTo(20, 9);
    expect(Math.max(...ys)).toBeCloseTo(21, 9);
  });

  it("zvislý rez rovinou X = 11 dá (Y, Z)", () => {
    const out: Seg[] = [];
    sliceTriangles(pos, idx, { origin: [11, 0, 0], u: [0, 1, 0], v: [0, 0, 1] }, out);
    const zs = out.flatMap((s) => [s[1], s[3]]);
    expect(Math.min(...zs)).toBeCloseTo(0, 9);
    expect(Math.max(...zs)).toBeCloseTo(3, 9);
  });

  it("ťažisko pôdorysu", () => {
    const c = footprintCentroid(pos, idx)!;
    expect(c[0]).toBeCloseTo(11, 9);
    expect(c[1]).toBeCloseTo(20.5, 9);
  });
});

describe("text strany", () => {
  it("parseLevel číta výškové kóty", () => {
    expect(parseLevel("+5,000")).toBe(5);
    expect(parseLevel("-0,160")).toBe(-0.16);
    expect(parseLevel("±0,000")).toBe(0);
    expect(parseLevel("+13.250")).toBe(13.25);
    expect(parseLevel("6500")).toBeNull();
    expect(parseLevel("1.05")).toBeNull();
  });
});

describe("calibratePlan", () => {
  it("popisky + ICP nájdu kalibráciu na mm aj s legendou a šumom", () => {
    const T = trueAffine(SCALE, 0.4, [25.5, -12.1]);
    const inv = invertAffine(T);
    const { cut, spaces } = planModel();
    const r = rng(7);
    const lines: PageLine[] = cut.map((s) => toPage(inv, s));
    // Šum: krátke čiary mimo stien (nábytok, kóty) a legenda vpravo.
    for (let k = 0; k < 60; k++) {
      const x = 300 + r() * 1800;
      const y = 200 + r() * 1200;
      lines.push([x, y, x + 20 + r() * 40, y + r() * 30, 1.0]);
    }
    const blocks: PageBlock[] = spaces.map((s) => {
      // Popisok nie je v ťažisku: posun do 0,8 m.
      const p = applyAffine(inv, [s.centroid[0] + (r() - 0.5) * 1.6, s.centroid[1] + (r() - 0.5) * 1.6]);
      return block(s.name, p);
    });
    spaces.forEach((s, i) => blocks.push(block(s.name, [2700, 1500 - i * 25], 0.3, 0.6)));

    const res = calibratePlan({ pageSize: PAGE, blocks, lines, spaces, cut });
    expect(res.start.method).toBe("room_labels");
    expect(res.start.points).toBe(12);
    expect(res.mirrored).toBe(false);
    expect(res.scale_ratio).toBeCloseTo(SCALE / (0.0254 / 72), 1);
    // Rohy strany v metroch: chyba do 5 mm.
    for (const p of [[0, 0], [PAGE[0], 0], [0, PAGE[1]], PAGE] as P2[]) {
      const a = applyAffine(res.affine, p);
      const b = applyAffine(T, p);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(0.005);
    }
    expect(res.quality.median_mm).toBeLessThan(5);
    expect(res.cross_validation_max_mm).toBeLessThan(10);
    expect(res.calibration).toHaveLength(2);
  });

  it("bez popiskov miestností vráti CalibrationError", () => {
    const { cut, spaces } = planModel();
    expect(() => calibratePlan({ pageSize: PAGE, blocks: [block("1.01", [100, 100])], lines: [], spaces, cut })).toThrow(CalibrationError);
  });
});

describe("calibrateSection", () => {
  it("kóty + osi + ICP, pohľad zo zadnej strany (zrkadlo)", () => {
    // Rez: u = poloha po reze (-8 až 13 m), v = výška Z; dosky 0 / 5 / 9,2 / 13,4, steny na osiach.
    const levelsZ = [0, 5, 9.2, 13.4];
    const axes: Record<string, number> = { "1": 12.84, "2": 6.35, "3": -1.14, "4": -7.62 };
    const cut: Seg[] = [];
    for (const z of levelsZ) cut.push([-8, z, 13.5, z], [-8, z - 0.25, 13.5, z - 0.25]);
    for (const h of Object.values(axes)) cut.push([h - 0.15, 0, h - 0.15, 13.4], [h + 0.15, 0, h + 0.15, 13.4]);
    cut.push([2, 0, 2, 3.1], [2, 3.1, 4.5, 3.1]);
    const T = trueAffine(SCALE, 0.05, [-14, -18.3], true);
    const inv = invertAffine(T);
    const lines = cut.map((s) => toPage(inv, s));
    const blocks: PageBlock[] = [];
    for (const z of levelsZ) {
      for (const h of [-9, 14.5]) {
        // Text kóty stojí nad čiarou úrovne (spodok textu 0,1 m nad ňou).
        const p = applyAffine(inv, [h, z + 0.1]);
        blocks.push({ t: z === 0 ? "±0,000" : `+${z.toFixed(3).replace(".", ",")}`, x: (p[0] / PAGE[0]) * 100, y: (1 - p[1] / PAGE[1]) * 100 - 0.7, w: 0.7, h: 0.7 });
      }
    }
    for (const [name, h] of Object.entries(axes)) blocks.push(block(name, applyAffine(inv, [h, 15.5])));

    const res = calibrateSection({ pageSize: PAGE, blocks, lines, axes, cut });
    expect(res.start.method).toBe("levels_axes");
    expect(res.mirrored).toBe(true);
    for (const p of [[0, 0], [PAGE[0], 0], [0, PAGE[1]], PAGE] as P2[]) {
      const a = applyAffine(res.affine, p);
      const b = applyAffine(T, p);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(0.005);
    }
    expect(res.quality.median_mm).toBeLessThan(5);
  });

  it("málo kót vráti CalibrationError", () => {
    expect(() => calibrateSection({ pageSize: PAGE, blocks: [block("+5,000", [10, 10])], lines: [], axes: {}, cut: [] })).toThrow(/výškové kóty/);
  });
});

describe("calibratePairs", () => {
  it("dve dvojice bez doladenia, tri s mediánom chyby", () => {
    const T = trueAffine(SCALE, 1, [3, 4]);
    const P: P2[] = [[100, 100], [2000, 300], [800, 1500]];
    const pairs = P.map((p) => ({ pdf_pt: p, plane_m: applyAffine(T, p) }));
    const two = calibratePairs(pairs.slice(0, 2));
    two.affine.forEach((v, i) => expect(v).toBeCloseTo(T[i], 9));
    expect(two.start.median_mm).toBeNull();
    const three = calibratePairs(pairs);
    expect(three.start.median_mm).toBe(0);
    expect(() => calibratePairs(pairs.slice(0, 1))).toThrow(CalibrationError);
  });
});
