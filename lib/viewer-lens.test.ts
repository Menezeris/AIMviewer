import { describe, expect, it } from "vitest";

import {
  MAX_ZONE_GUIDS,
  decodeLensWire,
  documentLensWire,
  lensBridgeMessage,
  lensOp,
  lensScopeKeys,
  scopeQuery,
  type LensWire,
} from "./viewer-lens";
import { opToBridgeMessage, parseOps } from "./viewer-ops";

const Z1 = "11111111-1111-4111-8111-111111111111";
const Z2 = "22222222-2222-4222-8222-222222222222";
const WIRE: LensWire = {
  r: [
    {
      n: "Prívod 1NP",
      a: "colorize",
      c: "#ef4444",
      g: [
        {
          combinator: "AND",
          rules: [
            { kind: "ifcType", op: "in", values: ["IfcDuctFitting"] },
            { kind: "group", groupClass: "IfcSystem", op: "matches", value: "^(?:Prívod-1NP)$", valueKind: "regex" },
          ],
        },
      ],
    },
    { n: "Nájomné", a: "transparent", c: "#3b82f6", g: [{ combinator: "AND", rules: [{ kind: "aim_zone", ids: [Z1, Z2] }] }] },
  ],
  i: 1,
};

describe("viewer-lens (D-096)", () => {
  it("op lens: base64url bez ; : . a späť aj s diakritikou", () => {
    const op = lensOp("add", WIRE, "r1");
    const [, , payload] = op.split(":");
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeLensWire(payload)).toEqual(WIRE);
  });

  it("parseOps rozbalí lens; chybný JSON, mód alebo pravidlo zahodí", () => {
    const [o] = parseOps(lensOp("replace", WIRE, "abc"));
    expect(o).toMatchObject({ op: "lens", mode: "replace", rev: "abc" });
    expect(parseOps(`lens:add:${btoa("{nope")}`)).toEqual([]);
    expect(parseOps(lensOp("bogus" as never, WIRE))).toEqual([]);
    const bad = lensOp("add", { r: [{ n: "x", a: "isolate" as never, c: "#000000", g: WIRE.r![0].g }] });
    expect(parseOps(bad)).toEqual([]);
    expect(parseOps("lens:clear:")).toEqual([{ op: "lens", mode: "clear", wire: {} }]);
  });

  it("id zón z pravidiel aim_zone, bez duplicít a ne-UUID", () => {
    expect(lensScopeKeys(WIRE)).toEqual([Z1, Z2]);
    expect(lensScopeKeys({ r: [{ n: "x", a: "colorize", c: "#000000", g: [{ combinator: "AND", rules: [{ kind: "aim_zone", ids: ["drop"] }] }] }] })).toEqual([]);
  });

  it("APPLY_LENS: zóna -> globalId s GUIDmi všetkých jej id, izolácia a rev", () => {
    const msg = lensBridgeMessage("add", WIRE, new Map([[Z1, ["A", "B"]], [Z2, ["B", "C"]]]), "r1") as {
      rules: { groups: { rules: unknown[] }[] }[];
    } & Record<string, unknown>;
    expect(msg).toMatchObject({ type: "APPLY_LENS", mode: "add", rev: "r1", isolate: true });
    expect(msg.rules[1].groups[0].rules[0]).toEqual({ kind: "globalId", op: "in", values: ["A", "B", "C"] });
    expect(msg.rules[0].groups[0].rules).toEqual(WIRE.r![0].g[0].rules);
  });

  it("neznáma zóna = prázdny výber; GUIDy spolu najviac strop mosta forku", () => {
    const empty = lensBridgeMessage("add", WIRE, new Map(), "r1") as { rules: { groups: { rules: { values?: unknown[] }[] }[] }[] };
    expect(empty.rules[1].groups[0].rules[0].values).toEqual([]);
    const many = Array.from({ length: MAX_ZONE_GUIDS + 10 }, (_, i) => `g${i}`);
    const capped = lensBridgeMessage("add", WIRE, new Map([[Z1, many]])) as { rules: { groups: { rules: { values?: unknown[] }[] }[] }[] };
    expect(capped.rules[1].groups[0].rules[0].values).toHaveLength(MAX_ZONE_GUIDS);
  });

  it("dokument (D-104 krok 4): aim_document má kľúč doc:<id>[:strana] a doplní sa GUIDmi ako zóna", () => {
    const D = "33333333-3333-4333-8333-333333333333";
    const wire: LensWire = {
      r: [
        { n: "Výkres", a: "isolate", g: [{ combinator: "AND", rules: [{ kind: "aim_document", id: D }] }] },
        { n: "Strana 3", a: "colorize", c: "#ef4444", g: [{ combinator: "AND", rules: [{ kind: "aim_document", id: D, page: 3 }, { kind: "aim_zone", ids: [Z1] }] }] },
        { n: "Zlé", a: "isolate", g: [{ combinator: "AND", rules: [{ kind: "aim_document", id: "drop", page: 0 }] }] },
      ],
      x: 1,
    };
    expect(lensScopeKeys(wire)).toEqual([`doc:${D}`, `doc:${D}:3`, Z1]);
    expect(scopeQuery(`doc:${D}:3`)).toBe(`document=${D}&page=3`);
    expect(scopeQuery(`doc:${D}`)).toBe(`document=${D}`);
    expect(scopeQuery(Z1)).toBe(`zone=${Z1}`);
    expect(scopeQuery("doc:nope")).toBeNull();
    const [o] = parseOps(lensOp("add", wire, "r5"));
    expect(o).toMatchObject({ op: "lens", wire });
    const msg = lensBridgeMessage("add", wire, new Map([[`doc:${D}`, ["A", "B"]], [`doc:${D}:3`, ["B"]], [Z1, ["Z"]]])) as {
      rules: { groups: { rules: unknown[] }[] }[];
    };
    expect(msg.rules[0].groups[0].rules).toEqual([{ kind: "globalId", op: "in", values: ["A", "B"] }]);
    expect(msg.rules[1].groups[0].rules).toEqual([
      { kind: "globalId", op: "in", values: ["B"] },
      { kind: "globalId", op: "in", values: ["Z"] },
    ]);
    expect(msg.rules[2].groups[0].rules).toEqual([{ kind: "globalId", op: "in", values: [] }]);
  });

  it("tlačidlo Ukázať v 3D (DOCUMENT_SHOW_3D): X-ray dokumentu alebo strany s menom ako štítkom", () => {
    const D = "33333333-3333-4333-8333-333333333333";
    const page = documentLensWire(D, "D.1.1.09 Výpis skladieb", 3);
    expect(page).toEqual({
      r: [{ n: "D.1.1.09 Výpis skladieb, s. 3", a: "isolate", g: [{ combinator: "AND", rules: [{ kind: "aim_document", id: D, page: 3 }] }] }],
      x: 1,
    });
    expect(lensScopeKeys(documentLensWire(D, "D.1.3.04"))).toEqual([`doc:${D}`]);
    const msg = lensBridgeMessage("replace", page, new Map([[`doc:${D}:3`, ["A"]]]));
    expect(msg).toMatchObject({ type: "APPLY_LENS", mode: "replace", xray: true, rules: [{ name: "D.1.1.09 Výpis skladieb, s. 3", action: "isolate" }] });
  });

  it("izolácia bez farby: pravidlo isolate bez c prejde, farebné bez c nie", () => {
    const g = WIRE.r![0].g;
    const [o] = parseOps(lensOp("add", { r: [{ n: "Zóna", a: "isolate", g }], i: 1 }, "r3"));
    expect(opToBridgeMessage(o)).toMatchObject({ isolate: true, rules: [{ name: "Zóna", action: "isolate" }] });
    expect((opToBridgeMessage(o) as { rules: object[] }).rules[0]).not.toHaveProperty("color");
    expect(parseOps(lensOp("add", { r: [{ n: "x", a: "colorize", g }] }))).toEqual([]);
    expect(parseOps(lensOp("add", { r: [{ n: "x", a: "isolate", c: "#000000", g }] }))).toEqual([]);
  });

  it("X-ray (D-105): príznak x ide do mosta ako xray, s izoláciou naraz nie", () => {
    const g = WIRE.r![0].g;
    const [o] = parseOps(lensOp("add", { r: [{ n: "SDK", a: "isolate", g }], x: 1 }, "r4"));
    const msg = opToBridgeMessage(o) as Record<string, unknown>;
    expect(msg).toMatchObject({ type: "APPLY_LENS", xray: true, rules: [{ name: "SDK", action: "isolate" }] });
    expect(msg).not.toHaveProperty("isolate");
    expect(parseOps(lensOp("add", { r: [{ n: "x", a: "isolate", g }], i: 1, x: 1 }))).toEqual([]);
  });

  it("op bez zóny sa preloží priamo cez opToBridgeMessage", () => {
    const [o] = parseOps(lensOp("add", { ac: { source: "group" } }, "r2"));
    expect(opToBridgeMessage(o)).toEqual({ type: "APPLY_LENS", mode: "add", rev: "r2", autoColor: { source: "group" } });
  });
});
