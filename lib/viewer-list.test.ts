import { describe, expect, it } from "vitest";

import { opToBridgeMessage, parseOps } from "./viewer-ops";
import { decodeListWire, listBridgeMessage, listHostKeys, listOp, listScopeKeys, type ListWire } from "./viewer-list";

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

describe("úprava zoznamu cez op list (D-149)", () => {
  const enc = (w: unknown) => listOp(w as ListWire).slice("list::".length);
  const UPDATE: ListWire = { n: "", g: [], c: [], u: 1, v: { m: true, o: { c: { s: "attribute", k: "Name" }, d: "desc" }, q: "" } };

  it("u=1 smie byť bez názvu a stĺpcov a preloží sa na LIST_UPDATE", () => {
    const [o] = parseOps(listOp(UPDATE));
    expect(opToBridgeMessage(o)).toEqual({
      type: "LIST_UPDATE",
      groups: [],
      view: { maximize: true, sort: { column: { source: "attribute", propertyName: "Name" }, dir: "desc" }, search: "" },
    });
  });

  it("chybný view alebo úprava so stĺpcami sa zahodí; otvorenie bez názvu tiež", () => {
    expect(decodeListWire(enc({ ...UPDATE, c: [{ s: "attribute", k: "Name" }] }))).toBeNull();
    expect(decodeListWire(enc({ ...UPDATE, v: { m: "yes" } }))).toBeNull();
    expect(decodeListWire(enc({ ...UPDATE, v: { o: { c: { s: "sql", k: "x" }, d: "asc" } } }))).toBeNull();
    expect(decodeListWire(enc({ ...UPDATE, v: { sum: [{ s: "quantity", k: "NetVolume" }] } }))).toBeNull();
    expect(decodeListWire(enc({ ...UPDATE, u: 2 }))).toBeNull();
    expect(decodeListWire(enc({ ...WIRE, n: "" }))).toBeNull();
    expect(decodeListWire(enc({ ...WIRE, v: { o: null, sum: [] } }))).not.toBeNull();
  });

  it("krok 2: edit len s u=1 a len platný; farby a export vo view", () => {
    const edit = { ac: [{ s: "property", p: "Pset_ColumnCommon", k: "FireRating" }], at: ["IfcBeam"], rf: ["storey", "all"] };
    const ok = decodeListWire(enc({ ...UPDATE, e: edit, v: { cb: null, x: "csv" } }));
    expect(ok?.e).toEqual(edit);
    expect(decodeListWire(enc({ ...WIRE, e: edit }))).toBeNull();
    expect(decodeListWire(enc({ ...UPDATE, e: {} }))).toBeNull();
    expect(decodeListWire(enc({ ...UPDATE, e: { at: ["Beam"] } }))).toBeNull();
    expect(decodeListWire(enc({ ...UPDATE, e: { rf: ["ifcType"] } }))).toBeNull();
    expect(decodeListWire(enc({ ...UPDATE, e: { rc: [{ s: "property", k: "X" }] } }))).toBeNull();
    expect(decodeListWire(enc({ ...UPDATE, v: { x: "docx" } }))).toBeNull();
    expect(decodeListWire(enc({ ...UPDATE, v: { cb: { s: "sql", k: "x" } } }))).toBeNull();
  });
});

describe("zoznam: viditeľnosť, šírky a zvýraznenie (D-171)", () => {
  const enc = (w: unknown) => listOp(w as ListWire).slice("list::".length);
  const NAME = { s: "attribute", k: "Name" } as const;
  const VOL = { s: "quantity", p: "Qto_X", k: "NetVolume" } as const;
  const UPDATE = (v: unknown) => ({ n: "", g: [], c: [], u: 1, v }) as ListWire;

  it("view nesie visibleOnly, columnWidths a highlight v tvare správy pre fork", () => {
    const wire = UPDATE({
      vo: false,
      cw: [{ c: NAME, w: 120 }, { c: VOL, w: "fit" }],
      hl: { r: { c: NAME, v: ["D1", 5] }, c: [VOL], x: [{ c: VOL, r: { c: NAME, v: "D1" } }], s: [VOL] },
    });
    const [o] = parseOps(listOp(wire));
    expect(opToBridgeMessage(o)).toEqual({
      type: "LIST_UPDATE",
      groups: [],
      view: {
        visibleOnly: false,
        columnWidths: [
          { column: { source: "attribute", propertyName: "Name" }, width: 120 },
          { column: { source: "quantity", propertyName: "NetVolume", psetName: "Qto_X" }, width: "fit" },
        ],
        highlight: {
          rows: { column: { source: "attribute", propertyName: "Name" }, values: ["D1", 5] },
          columns: [{ source: "quantity", propertyName: "NetVolume", psetName: "Qto_X" }],
          cells: [{ column: { source: "quantity", propertyName: "NetVolume", psetName: "Qto_X" }, row: { column: { source: "attribute", propertyName: "Name" }, value: "D1" } }],
          sum: [{ source: "quantity", propertyName: "NetVolume", psetName: "Qto_X" }],
        },
      },
    });
    const [clear] = parseOps(listOp(UPDATE({ hl: null, cw: "auto", vo: true })));
    expect(opToBridgeMessage(clear)).toMatchObject({ view: { highlight: null, columnWidths: "auto", visibleOnly: true } });
  });

  it("chybné hodnoty sa zahodia: šírka mimo rozsahu, zlé typy, prázdne alebo prehnané zoznamy", () => {
    const bad = [
      { vo: "áno" },
      { cw: "wide" },
      { cw: [] },
      { cw: [{ c: NAME, w: 10 }] },
      { cw: [{ c: NAME, w: 5000 }] },
      { cw: [{ c: NAME, w: 100 }, ...Array.from({ length: 40 }, () => ({ c: NAME, w: 100 }))] },
      { hl: "x" },
      { hl: { r: { c: NAME, v: [] } } },
      { hl: { r: { c: NAME, v: Array.from({ length: 201 }, (_, i) => i) } } },
      { hl: { r: { c: NAME, v: [{}] } } },
      { hl: { c: Array.from({ length: 9 }, () => NAME) } },
      { hl: { x: [{ c: NAME, r: { c: NAME, v: null } }] } },
      { hl: { s: false } },
    ];
    for (const v of bad) expect(decodeListWire(enc(UPDATE(v)))).toBeNull();
    expect(decodeListWire(enc(UPDATE({ cw: [{ c: NAME, w: 56 }, { c: NAME, w: 800 }], hl: { s: true } })))).not.toBeNull();
  });
});

describe("host stĺpce zoznamu (D-174, #277)", () => {
  const enc = (w: unknown) => Buffer.from(JSON.stringify(w)).toString("base64url");
  const HOST_COL = { s: "host" as const, k: "derived_referenced", l: "Priestor (odvodený z DB)" };
  const wire: ListWire = { ...WIRE, g: [{ combinator: "AND", rules: [{ kind: "ifcType", op: "in", values: ["IfcAirTerminal"] }] }], c: [{ s: "attribute", k: "Name" }, HOST_COL] };

  it("host stĺpec sa dekóduje, neznámy kľúč nie; kľúče vie klient vopred", () => {
    expect(decodeListWire(enc(wire))).not.toBeNull();
    expect(decodeListWire(enc({ ...wire, c: [{ s: "host", k: "iné" }] }))).toBeNull();
    expect(listHostKeys(wire)).toEqual(["derived_referenced"]);
    expect(listHostKeys({ ...wire, c: [], u: 1, e: { ac: [HOST_COL, { s: "host", k: "derived_boundary" }] } })).toEqual(["derived_referenced", "derived_boundary"]);
    expect(listHostKeys(WIRE)).toEqual([]);
  });

  it("OPEN_LIST nesie hodnoty podľa GlobalId; bez stiahnutých hodnôt prázdnu mapu", () => {
    const values = { "2O2Fr$t4X7Zf8NOew3FLOH": "3.02" };
    const msg = listBridgeMessage(wire, new Map(), new Map([["derived_referenced", values]])) as { columns: unknown[] };
    expect(msg.columns[1]).toEqual({ source: "host", propertyName: "derived_referenced", label: "Priestor (odvodený z DB)", values });
    expect((listBridgeMessage(wire, new Map()) as { columns: Array<{ values?: unknown }> }).columns[1].values).toEqual({});
    expect(msg.columns[0]).toEqual({ source: "attribute", propertyName: "Name" });
  });

  it("LIST_UPDATE pridá host stĺpec s hodnotami v edit.addColumns", () => {
    const upd: ListWire = { n: "", g: [], c: [], u: 1, e: { ac: [HOST_COL] } };
    const msg = listBridgeMessage(upd, new Map(), new Map([["derived_referenced", { G: "1.01" }]])) as { edit: { addColumns: unknown[] } };
    expect(msg.edit.addColumns).toEqual([{ source: "host", propertyName: "derived_referenced", label: "Priestor (odvodený z DB)", values: { G: "1.01" } }]);
  });
});
