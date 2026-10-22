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
