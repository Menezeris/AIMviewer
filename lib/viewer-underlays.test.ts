import { describe, expect, it } from "vitest";

import { opToBridgeMessage, parseOps } from "./viewer-ops";
import { MAX_UNDERLAY_ITEMS, checkUnderlaysSet, isViewUnderlays, parseUnderlaysSetOp, underlaysSetOp } from "./viewer-underlays";

const DOC = "5b5a6f0e-2b7b-4a53-8d3e-7a1f6c2d9e01";

describe("underlays_set (D-168): žiadosť o zmenu podkladov", () => {
  it("prejde ops reťazcom až na rozšírenú bridge správu SET_UNDERLAYS_3D", () => {
    const op = underlaysSetOp({ show: true, underlays: [{ document_id: DOC, visible: true }], only: true, persist: false });
    expect(parseOps(op).map(opToBridgeMessage)).toEqual([
      { type: "SET_UNDERLAYS_3D", show: true, underlays: [{ document_id: DOC, visible: true }], only: true, persist: false },
    ]);
    expect(parseOps(underlaysSetOp({ underlays: [{ document_id: DOC, opacity: 0.25 }], persist: true })).map(opToBridgeMessage)).toEqual([
      { type: "SET_UNDERLAYS_3D", underlays: [{ document_id: DOC, opacity: 0.25 }], persist: true },
    ]);
  });

  it("starý op underlays3d ostáva a nesie len show", () => {
    expect(parseOps("underlays3d:1:").map(opToBridgeMessage)).toEqual([{ type: "SET_UNDERLAYS_3D", show: true }]);
  });

  it("aspoň show alebo underlays; položka aspoň visible alebo opacity; only len s underlays", () => {
    expect(checkUnderlaysSet({})).toMatchObject({ ok: false });
    expect(checkUnderlaysSet({ persist: true })).toMatchObject({ ok: false });
    expect(checkUnderlaysSet({ show: false })).toEqual({ ok: true, request: { show: false } });
    expect(checkUnderlaysSet({ underlays: [{ document_id: DOC }] })).toMatchObject({ ok: false });
    expect(checkUnderlaysSet({ show: true, only: true })).toMatchObject({ ok: false });
    expect(checkUnderlaysSet({ underlays: [] })).toMatchObject({ ok: false });
  });

  it("opacity mimo 0 až 1, nebooleovské príznaky a prázdne id sa odmietnu", () => {
    expect(checkUnderlaysSet({ underlays: [{ document_id: DOC, opacity: 1.2 }] })).toMatchObject({ ok: false });
    expect(checkUnderlaysSet({ underlays: [{ document_id: DOC, opacity: -0.1 }] })).toMatchObject({ ok: false });
    expect(checkUnderlaysSet({ underlays: [{ document_id: DOC, opacity: 0 }] })).toMatchObject({ ok: true });
    expect(checkUnderlaysSet({ underlays: [{ document_id: DOC, visible: "yes" }] })).toMatchObject({ ok: false });
    expect(checkUnderlaysSet({ underlays: [{ document_id: "", visible: true }] })).toMatchObject({ ok: false });
    expect(checkUnderlaysSet({ show: 1 })).toMatchObject({ ok: false });
    expect(() => underlaysSetOp({})).toThrow(/underlays_set/);
  });

  it("najviac 200 položiek", () => {
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ document_id: `d${i}`, visible: true }));
    expect(checkUnderlaysSet({ underlays: items(MAX_UNDERLAY_ITEMS) })).toMatchObject({ ok: true });
    expect(checkUnderlaysSet({ underlays: items(MAX_UNDERLAY_ITEMS + 1) })).toMatchObject({ ok: false });
  });

  it("neplatné ops z URL sa zahodia", () => {
    expect(parseUnderlaysSetOp("")).toBeNull();
    expect(parseUnderlaysSetOp("!!!")).toBeNull();
    expect(parseUnderlaysSetOp("bm90LWpzb24")).toBeNull();
    expect(parseOps("underlays_set::")).toEqual([]);
  });
});

describe("ViewWire.underlays (D-168, #325)", () => {
  const ok = { show: true, items: [{ document_id: DOC, visible: true, opacity: 0.6 }] };

  it("platný stav prejde, neplatný nie", () => {
    expect(isViewUnderlays(ok)).toBe(true);
    expect(isViewUnderlays({ show: false, items: [] })).toBe(true);
    expect(isViewUnderlays({ items: [] })).toBe(false);
    expect(isViewUnderlays({ show: "1", items: [] })).toBe(false);
    expect(isViewUnderlays({ show: true, items: [{ document_id: DOC, visible: true }] })).toBe(false);
    expect(isViewUnderlays({ show: true, items: [{ document_id: DOC, visible: true, opacity: 2 }] })).toBe(false);
    expect(isViewUnderlays({ show: true, items: [{ document_id: 5, visible: true, opacity: 1 }] })).toBe(false);
    expect(isViewUnderlays({ show: true, items: Array.from({ length: 201 }, () => ok.items[0]) })).toBe(false);
    expect(isViewUnderlays(null)).toBe(false);
  });
});
