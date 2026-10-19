import { describe, expect, it } from "vitest";

import { MAX_ZONE_GUIDS, decodeLensWire, lensBridgeMessage, lensOp, lensZoneIds, type LensWire } from "./viewer-lens";
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
    expect(lensZoneIds(WIRE)).toEqual([Z1, Z2]);
    expect(lensZoneIds({ r: [{ n: "x", a: "colorize", c: "#000000", g: [{ combinator: "AND", rules: [{ kind: "aim_zone", ids: ["drop"] }] }] }] })).toEqual([]);
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

  it("op bez zóny sa preloží priamo cez opToBridgeMessage", () => {
    const [o] = parseOps(lensOp("add", { ac: { source: "group" } }, "r2"));
    expect(opToBridgeMessage(o)).toEqual({ type: "APPLY_LENS", mode: "add", rev: "r2", autoColor: { source: "group" } });
  });
});
