import { describe, expect, it } from "vitest";

import { compactIdsLocal } from "./viewer-local";

describe("compactIdsLocal (get_viewer_state, D-162)", () => {
  it("vyhodí XML, ostane kód, verzia, dirty a výsledky; povie, že XML sa dá načítať", () => {
    const state = {
      ids_local: {
        studio: { title: "A", code: "X", version: 2, dirty: true, bytes: 900, xml: "<ids/>" },
        validation: { title: "B", from_aim: true, results: { specs_failed: 1 } },
      },
    };
    expect(compactIdsLocal(state)).toEqual({
      studio: { title: "A", code: "X", version: 2, dirty: true, bytes: 900, xml_available: true },
      validation: { title: "B", from_aim: true, results: { specs_failed: 1 } },
    });
  });

  it("bez ids_local, so zlým tvarom alebo prázdne dá undefined", () => {
    expect(compactIdsLocal({})).toBeUndefined();
    expect(compactIdsLocal(null)).toBeUndefined();
    expect(compactIdsLocal({ ids_local: [] })).toBeUndefined();
    expect(compactIdsLocal({ ids_local: { studio: "x" } })).toBeUndefined();
  });
});
