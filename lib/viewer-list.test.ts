import { describe, expect, it } from "vitest";

import { opToBridgeMessage, parseOps } from "./viewer-ops";
import { decodeListWire, listBridgeMessage, listOp, listScopeKeys, type ListWire } from "./viewer-list";

const Z1 = "11111111-1111-4111-8111-111111111111";
const WIRE: ListWire = {
  n: "Dvere 1NP",
  g: [{ combinator: "AND", rules: [{ kind: "ifcType", op: "in", values: ["IfcDoor"] }, { kind: "aim_zone", ids: [Z1] }] }],
  c: [
    { s: "attribute", k: "Name" },
    { s: "property", p: "Pset_DoorCommon", k: "FireRating" },
    { s: "spatial", k: "Storey", l: "Podlažie" },
  ],
};

describe("zoznam z chatu (D-111)", () => {
  it("op list prejde URL a preloží sa na OPEN_LIST so stĺpcami", () => {
    const [o] = parseOps(listOp(WIRE));
    expect(o).toMatchObject({ op: "list", wire: { n: "Dvere 1NP" } });
    const msg = opToBridgeMessage(o) as { type: string; columns: unknown[]; groups: Array<{ rules: unknown[] }> };
    expect(msg.type).toBe("OPEN_LIST");
    expect(msg.columns).toEqual([
      { source: "attribute", propertyName: "Name" },
      { source: "property", propertyName: "FireRating", psetName: "Pset_DoorCommon" },
      { source: "spatial", propertyName: "Storey", label: "Podlažie" },
    ]);
  });

  it("zóna sa doplní GUIDmi ako pri Lens; id zón vie klient vopred", () => {
    expect(listScopeKeys(WIRE)).toEqual([Z1]);
    const msg = listBridgeMessage(WIRE, new Map([[Z1, ["A", "B"]]])) as { groups: Array<{ rules: unknown[] }> };
    expect(msg.groups[0].rules[1]).toEqual({ kind: "globalId", op: "in", values: ["A", "B"] });
  });

  it("chybný wire zahodí: neznámy zdroj, pset bez sady, bez stĺpcov", () => {
    const enc = (w: unknown) => listOp(w as ListWire).slice("list::".length);
    expect(decodeListWire(enc({ ...WIRE, c: [{ s: "sql", k: "x" }] }))).toBeNull();
    expect(decodeListWire(enc({ ...WIRE, c: [{ s: "property", k: "FireRating" }] }))).toBeNull();
    expect(decodeListWire(enc({ ...WIRE, c: [] }))).toBeNull();
    expect(decodeListWire("!!")).toBeNull();
  });

  it("run (D-148): príznak ide cez op do bridge správy, bez neho správa run nenesie", () => {
    const [o] = parseOps(listOp({ ...WIRE, r: 1 }));
    expect(opToBridgeMessage(o)).toMatchObject({ type: "OPEN_LIST", run: true });
    const [plain] = parseOps(listOp(WIRE));
    expect(opToBridgeMessage(plain)).not.toHaveProperty("run");
    const enc = (w: unknown) => listOp(w as ListWire).slice("list::".length);
    expect(decodeListWire(enc({ ...WIRE, r: 2 }))).toBeNull();
  });
});
