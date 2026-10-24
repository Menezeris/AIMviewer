import { describe, expect, it } from "vitest";

import { compactClashLocal } from "./viewer-local";

describe("compactClashLocal (D-164)", () => {
  it("nechá súhrn a nahradí zoznamy počtom", () => {
    const out = compactClashLocal({ clash_local: { test: { code: "MOJ" }, from_aim: true, dirty: true, run: { total: 4 }, reviews: [{}, {}], results: [{}] }, camera: {} });
    expect(out).toEqual({ test: { code: "MOJ" }, from_aim: true, dirty: true, run: { total: 4 }, reviews_count: 2, results_count: 1 });
  });

  it("bez clash_local je undefined", () => {
    expect(compactClashLocal({})).toBeUndefined();
    expect(compactClashLocal(null)).toBeUndefined();
    expect(compactClashLocal({ clash_local: [] })).toBeUndefined();
    expect(compactClashLocal({ clash_local: {} })).toBeUndefined();
  });
});
