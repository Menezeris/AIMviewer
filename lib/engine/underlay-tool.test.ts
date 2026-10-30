import { describe, expect, it } from "vitest";

import type { MergeResult } from "../data/georef";

import type { MeshElement } from "./measure";
import { applyAffine, invertAffine, type Affine, type P2, type PageBlock, type PageLine } from "./underlay-calibrate";
import { modelCut, sectionPlane } from "./underlay-model";
import { execCalibrateUnderlay, type UnderlayDeps, type UnderlayModel } from "./underlay-tool";

/** Kváder v IFC (x0..x1, y0..y1, z0..z1) ako mesh motora (Y-up: x, z, -y). */
function box(ifcType: string, b: [number, number, number, number, number, number], name: string | null, globalId: string): MeshElement {
  const [x0, x1, y0, y1, z0, z1] = b;
  const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  return {
    globalId,
    expressId: 1,
    model: "ASR",
    ifcType,
    name,
    positions: Float32Array.from(c.flatMap(([x, y, z]) => [x, z, -y])),
    indices: Uint32Array.from([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]),
    parts: [0],
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  };
}

const PAGE: P2 = [3000, 1700];
const S = 0.0176;
/** Pravá kalibrácia pôdorysu: strana -> IFC (X, Y). */
const T: Affine = [S * Math.cos(0.004), -S * Math.sin(0.004), 25.5, S * Math.sin(0.004), S * Math.cos(0.004), -12.1];
const INV = invertAffine(T);

/** Budova 4 x 3 miestnosti 6 x 5 m, steny 0,2 m, podlažie 1NP na z = 0 (a 2NP nad ním). */
function building() {
  const els: MeshElement[] = [];
  const lines: PageLine[] = [];
  const wall = (x0: number, x1: number, y0: number, y1: number, i: number) => {
    els.push(box("IfcWall", [x0, x1, y0, y1, 0, 3], null, `W${i}`));
    for (const [a, b] of [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]] as [P2, P2][]) {
      const p = applyAffine(INV, a);
      const q = applyAffine(INV, b);
      lines.push([p[0], p[1], q[0], q[1], 1.4]);
    }
  };
  let i = 0;
  for (let k = 0; k <= 4; k++) wall(30 + k * 6 - 0.1, 30 + k * 6 + 0.1, 0, 15, i++);
  for (let k = 0; k <= 3; k++) wall(30, 54, k * 5 - 0.1, k * 5 + 0.1, i++);
  wall(33, 33.2, 1, 4, i++);
  wall(41, 44, 7, 7.2, i++);
  const blocks: PageBlock[] = [];
  const spaceGuids: string[] = [];
  let n = 1;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const name = `1.${String(n++).padStart(2, "0")}`;
      const g = `SP${name}`;
      spaceGuids.push(g);
      els.push(box("IfcSpace", [30.1 + c * 6, 35.9 + c * 6, 0.1 + r * 5, 4.9 + r * 5, 0, 3], name, g));
      const p = applyAffine(INV, [33 + c * 6 + 0.4 * Math.sin(n), 2.5 + r * 5 + 0.3 * Math.cos(n)]);
      blocks.push({ t: name, x: (p[0] / PAGE[0]) * 100 - 0.4, y: (1 - p[1] / PAGE[1]) * 100 - 0.6, w: 0.8, h: 1.2 });
    }
  }
  return { els, lines, blocks, spaceGuids };
}

function deps(over: Partial<UnderlayDeps> = {}, stored: unknown = undefined) {
  const b = building();
  const writes: unknown[] = [];
  const model: UnderlayModel = { id: "ASR", elements: b.els, storey: { guid: "2VefEmfcj8sx0WLKr$GNnn", name: "1NP", spaceGuids: b.spaceGuids } };
  const d: UnderlayDeps = {
    document: async (ref) => (ref === "D1" ? { id: "d1", object_ref: "D1", name: "Pôdorys 1NP", georef: stored, floors: [{ guid: "2VefEmfcj8sx0WLKr$GNnn", name: "1NP" }] } : null),
    page: async () => ({ blocks: b.blocks, lines: { size: PAGE, segs: b.lines } }),
    model: async () => model,
    write: async (_id, apply) => {
      const r: MergeResult = apply(stored);
      if (r.ok) writes.push(r.georef);
      return r;
    },
    writeEnabled: true,
    now: () => new Date("2026-10-21T12:00:00Z"),
    ...over,
  };
  return { d, writes };
}

const run = async (args: Record<string, unknown>, d: UnderlayDeps) => {
  const res = await execCalibrateUnderlay(args, d);
  return { ...res, out: res.isError ? null : JSON.parse(res.text) };
};

describe("calibrate_underlay", () => {
  it("dry_run pôdorysu: podlažie z väzby dokumentu, presnosť, nič nezapíše", async () => {
    const { d, writes } = deps();
    const { out, isError, text } = await run({ document_id: "D1" }, d);
    expect(isError, text).toBe(false);
    expect(out.kind).toBe("plan");
    expect(out.floor).toBe("1NP");
    expect(out.storey_z_m).toBe(0);
    expect(out.written).toBe(false);
    expect(out.error_mm.median).toBeLessThan(5);
    expect(out.calibration).toMatchObject({ source: "auto", plane: null, storey_guid: "2VefEmfcj8sx0WLKr$GNnn" });
    const a = out.calibration.affine as Affine;
    for (const p of [[0, 0], PAGE] as P2[]) {
      const q = applyAffine(a, p);
      const t = applyAffine(T, p);
      expect(Math.hypot(q[0] - t[0], q[1] - t[1])).toBeLessThan(0.005);
    }
    expect(writes).toHaveLength(0);
  });

  it("auto zapíše v2; ručnú kalibráciu bez force neprepíše", async () => {
    const ok = deps();
    const r = await run({ document_id: "D1", mode: "auto" }, ok.d);
    expect(r.out.written).toBe(true);
    expect(ok.writes[0]).toMatchObject({ version: 2, calibrations: [{ source: "auto", page: 1 }] });

    const manual = { ...r.out.calibration, source: "manual" };
    const blocked = deps({}, { version: 2, calibrations: [manual] });
    const b = await run({ document_id: "D1", mode: "auto" }, blocked.d);
    expect(b.out.written).toBe(false);
    expect(b.out.note).toMatch(/ručnú kalibráciu/);
    expect(b.out.existing).toEqual([expect.objectContaining({ source: "manual", kind: "plan" })]);
    const forced = await run({ document_id: "D1", mode: "auto", force: true }, blocked.d);
    expect(forced.out.written).toBe(true);
  });

  it("prepis polohy force-om uloží predošlú ručnú kalibráciu do histórie (D-168)", async () => {
    const first = await run({ document_id: "D1", mode: "auto" }, deps().d);
    expect(first.out.history_saved).toBeUndefined();
    const manual = { ...first.out.calibration, source: "manual", affine: first.out.calibration.affine.map((v: number, i: number) => (i === 2 ? v + 1 : v)) };
    const blocked = deps({}, { version: 2, calibrations: [manual] });
    const forced = await run({ document_id: "D1", mode: "auto", force: true }, blocked.d);
    expect(forced.out.history_saved).toBe(true);
    expect(blocked.writes[0]).toMatchObject({
      history: [{ page: 1, replaced_by: "mcp", reason: "calibrate_underlay mode=auto", replaced_at: "2026-10-21T12:00:00.000Z", calibration: { source: "manual" } }],
    });
  });

  it("brána zápisu a strop chyby", async () => {
    const off = deps({ writeEnabled: false });
    expect((await run({ document_id: "D1", mode: "auto" }, off.d)).out.note).toMatch(/UNDERLAY_WRITE_ENABLED/);
    const strict = deps();
    const r = await run({ document_id: "D1", mode: "auto", max_error_mm: 0.0001 }, strict.d);
    expect(r.out.written).toBe(false);
    expect(strict.writes).toHaveLength(0);
  });

  it("manual s dvojicami v % strany, bez doladenia", async () => {
    const { d } = deps();
    const pct = (m: P2) => {
      const p = applyAffine(INV, m);
      return [(p[0] / PAGE[0]) * 100, (1 - p[1] / PAGE[1]) * 100];
    };
    const r = await run(
      { document_id: "D1", mode: "manual", refine: false, pairs: [{ page_pct: pct([30, 0]), model_m: [30, 0] }, { page_pct: pct([54, 15]), model_m: [54, 15] }] },
      d,
    );
    expect(r.isError, r.text).toBe(false);
    expect(r.out.calibration.source).toBe("manual");
    expect(r.out.calibration.affine[2]).toBeCloseTo(T[2], 6);
  });

  it("manual s object_ref miestnosti: bod modelu je ťažisko prvku (D-176)", async () => {
    const pct = (m: P2) => {
      const p = applyAffine(INV, m);
      return [(p[0] / PAGE[0]) * 100, (1 - p[1] / PAGE[1]) * 100];
    };
    // 1.01 má ťažisko (33, 2,5), 1.12 (51, 12,5)
    const { d } = deps({ refGuids: async (refs) => new Map(refs.flatMap((r) => (r === "1.01" ? [[r, "SP1.01"]] : r === "1.12" ? [[r, "SP1.12"]] : r === "BEZ.GEO" ? [[r, "NIE-V-MODELI"]] : []))) });
    const r = await run(
      { document_id: "D1", mode: "manual", refine: false, pairs: [{ page_pct: pct([33, 2.5]), object_ref: "1.01" }, { page_pct: pct([51, 12.5]), object_ref: "1.12" }] },
      d,
    );
    expect(r.isError, r.text).toBe(false);
    expect(r.out.calibration.source).toBe("manual");
    expect(r.out.calibration.affine[2]).toBeCloseTo(T[2], 3);
    expect(r.out.calibration.calibration[0].ifc_m).toEqual([33, 2.5]);
    // zmes model_m a object_ref v jednej dvojici, neznámy kód, prvok mimo modelu
    const both = await run({ document_id: "D1", mode: "manual", pairs: [{ page_pct: [1, 1], model_m: [1, 1], object_ref: "1.01" }, { page_pct: [2, 2], model_m: [2, 2] }] }, d);
    expect(both.text).toMatch(/práve jedno/);
    const unknown = await run({ document_id: "D1", mode: "manual", refine: false, pairs: [{ page_pct: [1, 1], object_ref: "9.99" }, { page_pct: [2, 2], model_m: [2, 2] }] }, d);
    expect(unknown.text).toMatch(/9\.99 nie je v AIM/);
    const missing = await run({ document_id: "D1", mode: "manual", refine: false, pairs: [{ page_pct: [1, 1], object_ref: "BEZ.GEO" }, { page_pct: [2, 2], model_m: [2, 2] }] }, d);
    expect(missing.text).toMatch(/nie je v modeli ASR/);
    // bez refGuids v deps sa object_ref odmietne, model_m ide ďalej
    const noResolver = await run({ document_id: "D1", mode: "manual", pairs: [{ page_pct: [1, 1], object_ref: "1.01" }, { page_pct: [2, 2], model_m: [2, 2] }] }, deps().d);
    expect(noResolver.text).toMatch(/object_ref v pairs/);
  });

  it("chyby vstupu", async () => {
    const { d } = deps();
    expect((await run({}, d)).text).toMatch(/document_id/);
    expect((await run({ document_id: "X" }, d)).text).toMatch(/neexistuje/);
    expect((await run({ document_id: "D1", floor: "1NP", section_plane: { axis: "x", coordinate_m: 1 } }, d)).text).toMatch(/buď floor/);
    expect((await run({ document_id: "D1", mode: "manual" }, d)).text).toMatch(/2 dvojice/);
    const noLines = deps({ page: async () => ({ blocks: [], lines: null }) });
    expect((await run({ document_id: "D1" }, noLines.d)).text).toMatch(/čiary výkresu/);
  });

  it("rez nepretínajúci model vráti chybu", async () => {
    const { d } = deps();
    const r = await run({ document_id: "D1", section_plane: { axis: "x", coordinate_m: 500 } }, d);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/nepretína/);
  });

  it("rez pohľadom zo zadnej strany: rovina u = -Y, affine priamy, zápis s plane", async () => {
    const b = building();
    // Dosky na úrovniach 0 a 3 m, aby rez mal vodorovné čiary a kóty.
    const els = [...b.els, box("IfcSlab", [29, 55, -1, 16, -0.25, 0], null, "S0"), box("IfcSlab", [29, 55, -1, 16, 3, 3.25], null, "S1")];
    const plane = sectionPlane([42.9, 0], [0, 1]);
    const cut = modelCut(els, plane, "section");
    // Výkres: u (po Y) zrkadlovo, mierka 1:50.
    const Ts: Affine = [-S, 0, 14, 0, S, -10];
    const inv = invertAffine(Ts);
    const lines: PageLine[] = cut.map((c) => {
      const p = applyAffine(inv, [c[0], c[1]]);
      const q = applyAffine(inv, [c[2], c[3]]);
      return [p[0], p[1], q[0], q[1], 1.4];
    });
    const blocks: PageBlock[] = [];
    for (const [z, t] of [[0, "±0,000"], [3, "+3,000"], [3.25, "+3,250"], [-0.25, "-0,250"]] as const) {
      const p = applyAffine(inv, [-2, z + 0.1]);
      blocks.push({ t, x: (p[0] / PAGE[0]) * 100, y: (1 - p[1] / PAGE[1]) * 100 - 0.7, w: 0.7, h: 0.7 });
    }
    const { d, writes } = deps({
      page: async () => ({ blocks, lines: { size: PAGE, segs: lines } }),
      model: async () => ({ id: "ASR", elements: els }),
    });
    const r = await run({ document_id: "D1", section_plane: { axis: "x", coordinate_m: 42.9 }, mode: "auto" }, d);
    expect(r.isError, r.text).toBe(false);
    expect(r.out.kind).toBe("section");
    const cal = r.out.calibration;
    expect(cal.plane).toEqual({ origin: [42.9, 0, 0], u: [0, -1, 0], v: [0, 0, 1] });
    const a = cal.affine as Affine;
    expect(a[0] * a[4] - a[1] * a[3]).toBeGreaterThan(0);
    // Bod strany -> (u, v) roviny; u = -Y.
    const p: P2 = [1000, 800];
    const q = applyAffine(a, p);
    const t = applyAffine(Ts, p);
    expect(Math.hypot(q[0] + t[0], q[1] - t[1])).toBeLessThan(0.005);
    expect(r.out.written).toBe(true);
    expect(writes).toHaveLength(1);
  });
});

describe("calibrate_underlay: rez zo značky na pôdoryse (D-179, #284)", () => {
  /** Rez X = 42,9 m (ako test vyššie), výkres zrkadlovo, kóty ±0,000 = IFC Z 100 m (posun kót). */
  function sectionCase(zOff = 0) {
    const b = building();
    const els = [...b.els, box("IfcSlab", [29, 55, -1, 16, -0.25, 0], null, "S0"), box("IfcSlab", [29, 55, -1, 16, 3, 3.25], null, "S1")].map((e) => {
      if (!zOff) return e;
      const pos = Float32Array.from(e.positions);
      for (let i = 1; i < pos.length; i += 3) pos[i] += zOff;
      return { ...e, positions: pos };
    });
    const cut = modelCut(els, sectionPlane([42.9, 0], [0, 1]), "section");
    const Ts: Affine = [-S, 0, 14, 0, S, -10 + zOff];
    const inv = invertAffine(Ts);
    const lines: PageLine[] = cut.map((c) => {
      const p = applyAffine(inv, [c[0], c[1]]);
      const q = applyAffine(inv, [c[2], c[3]]);
      return [p[0], p[1], q[0], q[1], 1.4];
    });
    const pct = (p: P2) => ({ x: (p[0] / PAGE[0]) * 100, y: (1 - p[1] / PAGE[1]) * 100 });
    const blocks: PageBlock[] = [];
    for (const [z, t] of [[0, "±0,000"], [3, "+3,000"], [3.25, "+3,250"], [-0.25, "-0,250"]] as const) {
      const { x, y } = pct(applyAffine(inv, [-2, z + zOff + 0.1]));
      blocks.push({ t, x, y: y - 0.7, w: 0.7, h: 0.7 });
    }
    // Pôdorys: značka A (X = 42,9) a osi 1 až 3 (Y = 0, 5, 10) v rade, osi A až C (X = 30, 36, 42) v rade.
    const planBlocks: PageBlock[] = [];
    const label = (t: string, ifc: P2) => {
      const { x, y } = pct(applyAffine(INV, ifc));
      planBlocks.push({ t, x: x - 0.08, y: y - 0.33, w: 0.16, h: 0.65 });
    };
    label("A", [42.9, -4]);
    label("A", [42.9, 19]);
    ["1", "2", "3"].forEach((t, i) => (label(t, [27, i * 5]), label(t, [57, i * 5])));
    ["A", "B", "C"].forEach((t, i) => (label(t, [30 + i * 6, -2]), label(t, [30 + i * 6, 17])));
    // Popisky osí 1 až 3 na reze (nad rezom), poloha po reze u = Y.
    ["1", "2", "3"].forEach((t, i) => {
      const { x, y } = pct(applyAffine(inv, [i * 5, 5 + zOff]));
      blocks.push({ t, x: x - 0.08, y: y - 0.33, w: 0.16, h: 0.65 });
    });
    const sheet = { ref: "X_Y_ASR_PODORYS-1NP", page: 1, affine: T, pageSize: PAGE, blocks: planBlocks };
    return { els, lines, blocks, sheet, Ts };
  }

  const sectionDeps = (c: ReturnType<typeof sectionCase>, storeys: number[], over: Partial<UnderlayDeps> = {}) =>
    deps({
      document: async (ref) => (ref === "R" ? { id: "r", object_ref: "X_Y_ASR_REZ-A", name: "Rez A", georef: undefined, floors: [] } : null),
      page: async () => ({ blocks: c.blocks, lines: { size: PAGE, segs: c.lines } }),
      model: async () => ({ id: "ASR", elements: c.els, storeys: storeys.map((z, i) => ({ name: `#${i}`, z })) }),
      planSheets: async () => [c.sheet],
      ...over,
    }).d;

  it("dokument rezu bez podlažia: rovina zo značky A, osi z pôdorysu, kóty na podlažia", async () => {
    const c = sectionCase();
    const r = await run({ document_id: "R" }, sectionDeps(c, [0, 3]));
    expect(r.isError, r.text).toBe(false);
    expect(r.out.kind).toBe("section");
    expect(r.out.section_plane.axis).toBe("x");
    expect(r.out.section_plane.coordinate_m).toBeCloseTo(42.9, 2);
    expect(r.out.from_plan).toMatchObject({ mark: "A", plans: [{ ref: "X_Y_ASR_PODORYS-1NP", used: true }] });
    expect(Object.keys(r.out.from_plan.axes).sort()).toEqual(["1", "2", "3"]);
    expect(r.out.start).toMatchObject({ method: "levels_axes", axes_matched: 3, levels: { storeys_matched: 2, offset_m: 0 } });
    // Zrkadlový výkres: u = -Y, kamera hľadí v smere +X.
    expect(r.out.calibration.plane.u).toEqual([0, -1, 0]);
    expect(r.out.view_direction).toEqual([1, 0]);
    expect(r.out.error_mm.median).toBeLessThan(5);
    expect(r.out.written).toBe(false);
  });

  it("±0,000 nie je IFC Z = 0: kóty sa posunú na výšky podlaží", async () => {
    const c = sectionCase(100);
    const r = await run({ document_id: "R", section_plane: { from_plan: true } }, sectionDeps(c, [100, 103]));
    expect(r.isError, r.text).toBe(false);
    expect(r.out.start.levels).toMatchObject({ storeys_matched: 2, offset_m: 100 });
    const q = applyAffine(r.out.calibration.affine as Affine, [1000, 800]);
    const t = applyAffine(c.Ts, [1000, 800]);
    expect(Math.hypot(q[0] + t[0], q[1] - t[1])).toBeLessThan(0.005);
  });

  it("značka, ktorú nemá žiadny pôdorys, a chýbajúce pôdorysy sú jasná chyba", async () => {
    const c = sectionCase();
    expect((await run({ document_id: "R", section_plane: { mark: "Q" } }, sectionDeps(c, [0, 3]))).text).toMatch(/Značku rezu Q/);
    expect((await run({ document_id: "R" }, sectionDeps(c, [0, 3], { planSheets: undefined }))).text).toMatch(/axis, coordinate_m/);
    expect((await run({ document_id: "R", section_plane: { axis: "z" } }, sectionDeps(c, [0, 3]))).text).toMatch(/from_plan/);
  });
});

describe("calibrate_underlay: mierka a strany bez čiar (#284, #283)", () => {
  /** Rovnaký výkres v mierke 1:28,5 (body strany väčšie, % popiskov rovnaké): nie bežná mierka. */
  const K = 1.75;
  const scaled = () => {
    const b = building();
    const page = async () => ({
      blocks: b.blocks,
      lines: { size: [PAGE[0] * K, PAGE[1] * K] as P2, segs: b.lines.map((l) => [l[0] * K, l[1] * K, l[2] * K, l[3] * K, l[4]] as PageLine) },
    });
    return page;
  };
  const scaleText = (t: string): PageBlock => ({ t, x: 80, y: 95, w: 10, h: 1 });

  it("nebežná mierka: dry_run varuje, auto neuloží aj pri nízkom mediáne", async () => {
    const { d, writes } = deps({ page: scaled() });
    const dry = await run({ document_id: "D1" }, d);
    expect(dry.isError, dry.text).toBe(false);
    expect(dry.out.error_mm.median).toBeLessThan(5);
    expect(dry.out.scale_check).toMatchObject({ ok: false, source: "standard", expected: 25 });
    expect(dry.out.warnings[0]).toMatch(/mierka 1:28/i);
    const auto = await run({ document_id: "D1", mode: "auto" }, d);
    expect(auto.out.written).toBe(false);
    expect(auto.out.note).toMatch(/mierka 1:28/i);
    expect(writes).toHaveLength(0);
  });

  it("scale zafixuje mierku, výsledok sa uloží", async () => {
    const { d, writes } = deps({ page: scaled() });
    const r = await run({ document_id: "D1", mode: "auto", scale: 28.5 }, d);
    expect(r.isError, r.text).toBe(false);
    expect(r.out.scale_check).toMatchObject({ ok: true, source: "param", locked: true });
    expect(r.out.scale).toBe("1:28.5");
    expect(r.out.written).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it("mierka z textu strany (MERÍTKO 1 : 50) sa použije ako pevná", async () => {
    const b = building();
    const { d } = deps({ page: async () => ({ blocks: [...b.blocks, scaleText("MERÍTKO 1 : 50")], lines: { size: PAGE, segs: b.lines } }) });
    const r = await run({ document_id: "D1" }, d);
    expect(r.isError, r.text).toBe(false);
    expect(r.out.scale_check).toMatchObject({ source: "text", expected: 50, locked: true, text_scale: "1:50" });
    expect(r.out.scale).toBe("1:50");
    expect(r.out.error_mm.median).toBeLessThan(25);
  });

  it("zlá zadaná mierka sa neuloží", async () => {
    const { d, writes } = deps();
    const r = await run({ document_id: "D1", mode: "auto", scale: 100 }, d);
    expect(r.out?.written ?? false).toBe(false);
    expect(writes).toHaveLength(0);
  });

  it("scale mimo rozsahu je chyba vstupu", async () => {
    const { d } = deps();
    expect((await run({ document_id: "D1", scale: 1 }, d)).text).toMatch(/scale je číslo/);
    expect((await run({ document_id: "D1", scale: "50" }, d)).text).toMatch(/scale je číslo/);
  });

  it("strana bez čiar: ETL nebežalo vs. raster, manual s dvojicami ide aj bez čiar", async () => {
    const b = building();
    const none = (pageSize?: P2) => deps({ page: async () => ({ blocks: b.blocks, lines: null, pageSize }) });
    expect((await run({ document_id: "D1" }, none().d)).text).toMatch(/ETL ich ešte nenačítalo/);
    const raster = await run({ document_id: "D1" }, none(PAGE).d);
    expect(raster.isError).toBe(true);
    expect(raster.text).toMatch(/raster/);
    expect(raster.text).toMatch(/mode=manual/);

    const pct = (m: P2) => {
      const p = applyAffine(INV, m);
      return [(p[0] / PAGE[0]) * 100, (1 - p[1] / PAGE[1]) * 100];
    };
    const pairs = [{ page_pct: pct([30, 0]), model_m: [30, 0] }, { page_pct: pct([54, 15]), model_m: [54, 15] }];
    const ok = await run({ document_id: "D1", mode: "manual", pairs }, none(PAGE).d);
    expect(ok.isError, ok.text).toBe(false);
    expect(ok.out.calibration.source).toBe("manual");
    expect(ok.out.calibration.affine[2]).toBeCloseTo(T[2], 6);
    expect(ok.out.warnings[0]).toMatch(/nedoladili/);
    // Manual bez rozmeru strany sa nedá prepočítať.
    expect((await run({ document_id: "D1", mode: "manual", pairs }, none().d)).text).toMatch(/ETL ich ešte nenačítalo/);
  });
});


describe("calibrate_underlay bez popiskov, bez IfcSpace, výrez (D-180)", () => {
  const RATIO = S / (0.0254 / 72);
  const noSpaces = (): UnderlayModel => {
    const b = building();
    // Podlažie bez IfcSpace (5NP): výška z parsera, priestory v modeli nie sú.
    return { id: "ASR", elements: b.els.filter((e) => e.ifcType !== "IfcSpace"), storey: { guid: "2VefEmfcj8sx0WLKr$GNnn", name: "5NP", z: 0, spaceGuids: [] } };
  };

  it("pôdorys bez popiskov a bez IfcSpace: štart skenovaním pri zadanej mierke", async () => {
    const b = building();
    const { d } = deps({ page: async () => ({ blocks: [], lines: { size: PAGE, segs: b.lines } }), model: async () => noSpaces() });
    const r = await run({ document_id: "D1", scale: RATIO }, d);
    expect(r.isError, r.text).toBe(false);
    expect(r.out.spaces).toBe(0);
    expect(r.out.start.method).toBe("plan_scan");
    expect(r.out.plausible).toBe(true);
    expect(r.out.rotation_check).toMatchObject({ ok: true, expected_deg: 0 });
    for (const p of [[0, 0], PAGE] as P2[]) {
      const q = applyAffine(r.out.calibration.affine as Affine, p);
      const t = applyAffine(T, p);
      expect(Math.hypot(q[0] - t[0], q[1] - t[1])).toBeLessThan(0.01);
    }
  });

  it("bez popiskov a bez mierky: chyba s radou, podlažie bez IfcSpace a bez výšky je chyba", async () => {
    const b = building();
    const { d } = deps({ page: async () => ({ blocks: [], lines: { size: PAGE, segs: b.lines } }), model: async () => noSpaces() });
    expect((await run({ document_id: "D1" }, d)).text).toMatch(/MERÍTKO 1 : N/);
    const noZ = deps({ model: async () => ({ ...noSpaces(), storey: { guid: "g", name: "5NP", z: null, spaceGuids: [] } }) });
    expect((await run({ document_id: "D1" }, noZ.d)).text).toMatch(/výšku z parsera ani priestory/);
  });

  it("region: kalibruje len výkres vo výreze, mierka z textu výrezu, uloží sa s kalibráciou", async () => {
    const b = building();
    // Hárok s dvoma pôdorysmi: vpravo ten istý pôdorys posunutý o 1450 pt (iné podlažie), výrez je ľavá polovica.
    const other = b.lines.map((l) => [l[0] + 1450, l[1], l[2] + 1450, l[3], l[4]] as PageLine);
    const shifted = b.lines.map((l) => [l[0] - 200, l[1], l[2] - 200, l[3], l[4]] as PageLine);
    const page = async () => ({
      blocks: [{ t: "1 : 50", x: 20, y: 95, w: 6, h: 1 }, { t: "1 : 100", x: 70, y: 95, w: 6, h: 1 }, { t: "MERÍTKO", x: 90, y: 97, w: 6, h: 1 }],
      lines: { size: PAGE, segs: [...shifted, ...other] },
    });
    const { d, writes } = deps({ page, model: async () => noSpaces() });
    const r = await run({ document_id: "D1", mode: "auto", region: [0, 0, 50, 100] }, d);
    expect(r.isError, r.text).toBe(false);
    expect(r.out.scale_check).toMatchObject({ source: "text", expected: 50 });
    expect(r.out.region).toEqual([0, 0, 50, 100]);
    // Ľavý pôdorys je pravý posunutý o -200 pt: affine strany je T s posunom o 200 pt.
    const q = applyAffine(r.out.calibration.affine as Affine, [800, 800]);
    const t = applyAffine(T, [1000, 800]);
    expect(Math.hypot(q[0] - t[0], q[1] - t[1])).toBeLessThan(0.02);
    expect(r.out.written).toBe(true);
    expect(writes[0]).toMatchObject({ calibrations: [{ region: [0, 0, 50, 100] }] });
    // Objekt {x, y, width, height} je ten istý výrez; prázdny výrez a zlý tvar sú chyba vstupu.
    const o = await run({ document_id: "D1", region: { x: 0, y: 0, width: 50, height: 100 } }, d);
    expect(o.out.region).toEqual([0, 0, 50, 100]);
    expect((await run({ document_id: "D1", region: [90, 0, 10, 10] }, d)).text).toMatch(/obsahuje len \d+ čiar/);
    expect((await run({ document_id: "D1", region: [0, 0, 120, 10] }, d)).text).toMatch(/region je výrez/);
  });
});
