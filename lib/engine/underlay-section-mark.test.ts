import { describe, expect, it } from "vitest";

import type { PageBlock } from "./underlay-calibrate";
import { pageAxisLines, planLabelLines, refAxesFromSheets, sectionFromPlans, sectionMarkFromName, type PlanSheet } from "./underlay-section-mark";

/** Popisok strany: text, x %, y % (vľavo hore), rozmer ako ETL (D-123). */
const b = (t: string, x: number, y: number): PageBlock => ({ t, x, y, w: 0.15, h: 0.65 });

/** Osi A až F (zvislé) a 1 až 4 (vodorovné) v radoch, ako na pôdorysoch ASR. */
function grid(letters: number[], rowsY: [number, number], numbers: number[], colsX: [number, number]): PageBlock[] {
  const out: PageBlock[] = [];
  ["A", "B", "C", "D", "E", "F"].forEach((t, i) => out.push(b(t, letters[i], rowsY[0]), b(t, letters[i], rowsY[1])));
  ["1", "2", "3", "4"].forEach((t, i) => out.push(b(t, colsX[0], numbers[i]), b(t, colsX[1], numbers[i])));
  return out;
}

const PAGE: [number, number] = [3260.04, 1683.72];

/** Skutočné popisky a ručné kalibrácie pôdorysov OCB SO01 (DB 30. 10. 2026, výťah). */
const SHEETS: PlanSheet[] = [
  {
    ref: "OCB_SO01_ASR_D-1-1-01_PODORYS-1NP",
    page: 1,
    pageSize: PAGE,
    affine: [0.01762098710248037, -0.000001629526510098654, 25.527528424840163, 0.000001629526510098654, 0.01762098710248037, -12.111850344515211],
    blocks: [
      ...grid([64.93, 53.63, 42.32, 31.02, 19.72, 8.42], [89.68, 8.39], [15.55, 37.44, 62.69, 84.57], [5.51, 68.22]),
      b("A", 38.04, 6.08),
      b("A", 38.04, 95.1),
      b("B", 68.36, 43.05),
      b("B", 5, 43.05),
      b("D", 68.05, 51.57),
      b("D", 4.24, 51.57),
      b("01", 54.84, 69.5),
      b("01", 18.46, 69.53),
      b("N", 98.97, 86.71),
    ],
  },
  {
    ref: "OCB_SO01_ASR_D-1-1-02_PODORYS-2NP",
    page: 1,
    pageSize: PAGE,
    affine: [0.01761553033233172, 5.550447285204019e-7, 25.002495509180193, -5.550447285204019e-7, 0.01761553033233172, -11.538101172462369],
    blocks: [
      ...grid([65.86, 54.55, 43.24, 31.94, 20.64, 9.35], [91.59, 10.3], [17.46, 39.34, 64.6, 86.48], [6.43, 69.14]),
      b("A", 38.96, 13.93),
      b("A", 38.96, 90.76),
      b("B", 69.28, 44.96),
      b("B", 5.92, 44.96),
    ],
  },
  {
    ref: "OCB_SO01_ASR_D-1-1-03_PODORYS-3NP",
    page: 1,
    pageSize: PAGE,
    affine: [0.0176194590046599, 8.49193087183022e-8, 25.221729974521242, -8.49193087183022e-8, 0.0176194590046599, -11.870897851079294],
    blocks: [
      ...grid([65.47, 54.16, 42.85, 31.55, 20.25, 8.96], [90.48, 9.19], [16.35, 38.24, 63.49, 85.38], [6.04, 68.75]),
      b("A", 38.57, 12.83),
      b("A", 38.57, 89.66),
      b("B", 68.9, 43.86),
      b("B", 5.53, 43.86),
    ],
  },
  {
    ref: "OCB_SO01_PBR_D-1-3-05_PODORYS-4NP",
    page: 1,
    pageSize: [1684, 1191],
    affine: [0.035277777777777776, 0, 23.928171193567813, 0, 0.035277777777777776, -23.02098677123479],
    blocks: [
      ...grid([65.47, 54.53, 43.58, 32.64, 21.7, 10.77], [66.95, 9.49], [14.55, 30.02, 47.88, 63.34], [7.95, 68.66]).map((x) => ({ ...x, h: 0.32 })),
      b("B", 68.8, 34.05),
      b("B", 7.46, 34.05),
      b("C", 67.95, 51.06),
      b("C", 7.85, 51.06),
      b("A", 39.45, 12.12),
      b("A", 39.45, 66.43),
    ],
  },
];

describe("planLabelLines", () => {
  it("odlíši osi v radoch od značiek rezov", () => {
    const lines = planLabelLines(SHEETS[0]);
    const count = (t: string, k: string) => lines.filter((l) => l.text === t && l.kind === k).length;
    expect(count("A", "section")).toBe(1);
    expect(count("A", "axis")).toBe(1);
    expect(count("B", "section")).toBe(1);
    expect(count("D", "section")).toBe(1);
    expect(count("1", "axis")).toBe(1);
    expect(lines.some((l) => l.text === "01")).toBe(false);
  });

  it("dorovná dvojicu na čiaru strany (rezná čiara medzi popiskami)", () => {
    const lines: PlanSheet["lines"] = [];
    // Rezná čiara A je na x = 1242,9 pt (stred popiskov 1242,7 pt), čiarkovaná.
    for (let y = 200; y < 1500; y += 13) lines.push([1242.9, y, 1242.9, y + 6, 1.42]);
    const sheet: PlanSheet = { ...SHEETS[0], affine: [1, 0, 0, 0, 1, 0], lines };
    const a = planLabelLines(sheet).find((l) => l.text === "A" && l.kind === "section")!;
    expect(a.a[0]).toBeCloseTo(1242.9, 3);
  });
});

describe("sectionFromPlans", () => {
  it("rez A: rovina X = 47,43 m zo všetkých pôdorysov, osi 1 až 4 a rezy B, C, D po reze", () => {
    const s = sectionFromPlans("A", SHEETS)!;
    expect(s.axis?.axis).toBe("x");
    // Existujúca automatická kalibrácia (prototyp D-133) má X = 47,42.
    expect(s.axis!.coordinate_m).toBeCloseTo(47.43, 1);
    expect(s.plans.length).toBe(4);
    expect(s.plans.every((p) => p.used)).toBe(true);
    expect(s.spread_mm).toBeLessThan(60);
    expect(Object.keys(s.axes).sort()).toEqual(["1", "2", "3", "4", "B", "C", "D"]);
    // Os 1 je na pôdoryse hore = najväčšie Y; po reze (u = +Y) najďalej.
    expect(s.axes["1"]).toBeGreaterThan(s.axes["4"]);
    expect(s.axes.B).toBeCloseTo(4.69, 1);
  });

  it("rez B: rovina Y = 4,69 m, osi A až F po reze (os A má prednosť pred rezom A)", () => {
    const s = sectionFromPlans("B", SHEETS)!;
    expect(s.axis?.axis).toBe("y");
    expect(s.axis!.coordinate_m).toBeCloseTo(4.69, 1);
    expect(Object.keys(s.axes).sort()).toEqual(["A", "B", "C", "D", "E", "F"]);
    // Os A je na pôdoryse vpravo (x 64,93 %), rez A pri X = 47,43 m.
    expect(s.axes.A).toBeGreaterThan(60);
    expect(s.axes.F).toBeLessThan(s.axes.E);
  });

  it("pôdorys mimo zhody vypadne, chýbajúca značka je null", () => {
    const a = SHEETS[1].affine;
    const off: PlanSheet = { ...SHEETS[1], ref: "X", affine: [a[0], a[1], a[2] + 1, a[3], a[4], a[5]] };
    const s = sectionFromPlans("A", [...SHEETS, off])!;
    expect(s.plans.find((p) => p.ref === "X")!.used).toBe(false);
    expect(sectionFromPlans("Q", SHEETS)).toBeNull();
  });

  it("šikmý rez: rovina bez osi, smer jednotkový", () => {
    const r = (30 * Math.PI) / 180;
    const s = sectionFromPlans("A", [{ ...SHEETS[0], affine: [Math.cos(r), -Math.sin(r), 0, Math.sin(r), Math.cos(r), 0] }])!;
    expect(s.axis).toBeNull();
    expect(Math.hypot(s.dir[0], s.dir[1])).toBeCloseTo(1, 3);
  });
});

describe("sectionMarkFromName", () => {
  it("písmeno z object_ref alebo mena", () => {
    expect(sectionMarkFromName("OCB_SO01_ASR_D-1-1-05_REZ-A")).toBe("A");
    expect(sectionMarkFromName(null, "D.1.1.06 Rez B - Pozdĺžny rez schodiskom")).toBe("B");
    expect(sectionMarkFromName("REZ C-C")).toBe("C");
    expect(sectionMarkFromName("PODORYS-1NP")).toBeNull();
  });
});

describe("osi z kalibrovaných pôdorysov (D-184)", () => {
  it("refAxesFromSheets: pôdorysy ASR 1NP až 3NP dajú osi A až F (roviny X) a 1 až 4 (roviny Y), zhoda do 2 cm", () => {
    const refs = refAxesFromSheets(SHEETS.slice(0, 3));
    expect(refs.map((r) => `${r.dir}${r.text}`).sort()).toEqual(["xA", "xB", "xC", "xD", "xE", "xF", "y1", "y2", "y3", "y4"]);
    const A = refs.find((r) => r.text === "A")!;
    expect(A).toMatchObject({ dir: "x", sheets: 3 });
    expect(Math.abs(A.at - 62.87)).toBeLessThan(0.02);
  });

  it("pageAxisLines: rady osí v bodoch strany, značky rezov a kódy nie", () => {
    const lines = pageAxisLines(PAGE, SHEETS[0].blocks);
    expect(lines.map((l) => l.text).sort()).toEqual(["1", "2", "3", "4", "A", "B", "C", "D", "E", "F"]);
  });
});
