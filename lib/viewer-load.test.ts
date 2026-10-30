import { describe, expect, it } from "vitest";

import {
  INITIAL_LOAD_STATE,
  allSettled,
  applyFirstGeometry,
  applyLoadProgress,
  hasLoadProgress,
  loadSegments,
  loadSummary,
  parseFirstGeometry,
  parseLoadProgress,
  type LoadProgressMsg,
} from "./viewer-load";

const msg = (o: Partial<LoadProgressMsg>): LoadProgressMsg => ({
  model: "ASR",
  phase: "download",
  percent: 0,
  index: 0,
  total: 2,
  ...o,
});

describe("parseLoadProgress", () => {
  it("prijme platnú správu a zreže percento do 0..100", () => {
    expect(parseLoadProgress({ model: "ASR", phase: "process", percent: 140, index: 0, total: 2 })?.percent).toBe(100);
    expect(parseLoadProgress({ model: "ASR", phase: "process", percent: -3, index: 0, total: 2 })?.percent).toBe(0);
  });
  it("zahodí neznámu fázu, index mimo rozsahu a nečíselné percento", () => {
    expect(parseLoadProgress({ model: "ASR", phase: "x", percent: 1, index: 0, total: 2 })).toBeNull();
    expect(parseLoadProgress({ model: "ASR", phase: "done", percent: 100, index: 2, total: 2 })).toBeNull();
    expect(parseLoadProgress({ model: "ASR", phase: "done", percent: NaN, index: 0, total: 2 })).toBeNull();
    expect(parseLoadProgress({ phase: "done", percent: 1, index: 0, total: 2 })).toBeNull();
    expect(parseLoadProgress(null)).toBeNull();
  });
});

describe("parseFirstGeometry", () => {
  it("overí model a index", () => {
    expect(parseFirstGeometry({ model: "ASR", index: 0, total: 2 })).toEqual({ model: "ASR", index: 0, total: 2 });
    expect(parseFirstGeometry({ model: "ASR", index: 5, total: 2 })).toBeNull();
  });
});

describe("stav načítania", () => {
  it("bez správ nie je priebeh (starší viewer) a prekrytie ostáva na MODELS_LOADED", () => {
    expect(hasLoadProgress(INITIAL_LOAD_STATE)).toBe(false);
    expect(INITIAL_LOAD_STATE.firstGeometry).toBe(false);
    expect(allSettled(INITIAL_LOAD_STATE)).toBe(false);
  });

  it("skladá segmenty v poradí index a model, ktorý sa neozval, čaká", () => {
    let s = applyLoadProgress(INITIAL_LOAD_STATE, msg({ index: 0, phase: "process", percent: 40 }));
    s = applyLoadProgress(s, msg({ model: "VZT", index: 1, phase: "download", percent: 99 }));
    expect(loadSummary(loadSegments(s))).toBe("ASR 40 %, VZT stiahnuté");
    const only = applyLoadProgress(INITIAL_LOAD_STATE, msg({ index: 1, model: "VZT", phase: "download", percent: 0 }));
    const seg = loadSegments(only);
    expect(seg[0].kind).toBe("waiting");
    expect(seg[1].label).toBe("VZT sťahuje sa");
  });

  it("vyplnenie rastie: sťahovanie < spracovanie < hotovo, chyba je plná a červená", () => {
    const fill = (m: Partial<LoadProgressMsg>) =>
      loadSegments(applyLoadProgress(INITIAL_LOAD_STATE, msg({ total: 1, ...m })))[0];
    expect(fill({ phase: "download", percent: 50 }).fill).toBeCloseTo(0.15);
    expect(fill({ phase: "process", percent: 0 }).fill).toBeCloseTo(0.3);
    expect(fill({ phase: "process", percent: 100 }).fill).toBeCloseTo(1);
    expect(fill({ phase: "done", percent: 100 }).kind).toBe("done");
    expect(fill({ phase: "error", percent: 0 })).toMatchObject({ kind: "error", fill: 1 });
  });

  it("hotový model sa oneskorenou správou o sťahovaní nevráti", () => {
    let s = applyLoadProgress(INITIAL_LOAD_STATE, msg({ phase: "done", percent: 100 }));
    s = applyLoadProgress(s, msg({ phase: "download", percent: 80 }));
    expect(s.entries[0].phase).toBe("done");
  });

  it("allSettled: všetky done alebo error", () => {
    let s = applyLoadProgress(INITIAL_LOAD_STATE, msg({ phase: "done", percent: 100 }));
    expect(allSettled(s)).toBe(false);
    s = applyLoadProgress(s, msg({ model: "VZT", index: 1, phase: "error", percent: 0 }));
    expect(allSettled(s)).toBe(true);
  });

  it("FIRST_GEOMETRY zdvihne príznak a doplní total", () => {
    const s = applyFirstGeometry(INITIAL_LOAD_STATE, { model: "ASR", index: 0, total: 2 });
    expect(s.firstGeometry).toBe(true);
    expect(s.total).toBe(2);
  });
});
