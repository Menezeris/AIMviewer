import { describe, expect, it } from "vitest";

import { MINI_BUILDING, guid } from "./__fixtures__/mini-building";
import { loadBearingFromSets, loadBearingOf, matchesLoadBearing, parseBoolean, parseLoadBearingFilter } from "./load-bearing";
import { parseIfcBytes } from "./loader";

const set = (name: string, value: unknown) => ({ name, properties: [{ name: "LoadBearing", value }] });

describe("LoadBearing (D-164 dodatok, #292)", () => {
  it("boolean v tvaroch parsera IFC", () => {
    expect([true, "TRUE", "True", ".T.", 1].map(parseBoolean)).toEqual([true, true, true, true, true]);
    expect([false, "FALSE", ".F.", 0].map(parseBoolean)).toEqual([false, false, false, false]);
    expect([null, undefined, "", "?", ".U.", 2].map(parseBoolean)).toEqual([null, null, null, null, null, null]);
  });

  it("Pset_*Common má prednosť pred vlastným psetom, prázdne hodnoty sa preskočia", () => {
    expect(loadBearingFromSets([set("AIM_StairFlight", true), set("Pset_StairCommon", false)])).toBe(false);
    expect(loadBearingFromSets([set("Pset_WallCommon", null), set("AIM_X", true)])).toBe(true);
    expect(loadBearingFromSets([{ name: "Pset_WallCommon", properties: [{ name: "IsExternal", value: true }] }])).toBeNull();
    expect(loadBearingFromSets([])).toBeNull();
  });

  it("filter true/false/unknown nikdy nemieša neznámu hodnotu s false", () => {
    expect([true, false, null].map((v) => matchesLoadBearing(v, "true"))).toEqual([true, false, false]);
    expect([true, false, null].map((v) => matchesLoadBearing(v, "false"))).toEqual([false, true, false]);
    expect([true, false, null].map((v) => matchesLoadBearing(v, "unknown"))).toEqual([false, false, true]);
    expect([true, "FALSE", "x", undefined].map(parseLoadBearingFilter)).toEqual(["true", "false", undefined, undefined]);
  });
});

// --- skutočný parser: výskyt, typ, prednosť výskytu (IfcRelDefinesByType) --------------------

const lbSet = (n: number, value: string) =>
  `#${n}= IFCPROPERTYSINGLEVALUE('LoadBearing',$,IFCBOOLEAN(${value}),$);\n#${n + 1}= IFCPROPERTYSET('${guid(`PS${n}`)}',$,'Pset_WallCommon',$,(#${n}));\n`;
const EXTRA =
  lbSet(300, ".T.") + // typ: nosný
  lbSet(310, ".F.") + // výskyt W2 prebíja typ
  lbSet(320, ".T.") + // výskyt W3 sám
  `#330= IFCWALLTYPE('${guid("WTY")}',$,'WT1',$,$,(#301),$,$,$,.STANDARD.);\n` +
  `#331= IFCWALL('${guid("W1")}',$,'W1 zdedí',$,$,#40,$,$,.STANDARD.);\n` +
  `#332= IFCWALL('${guid("W2")}',$,'W2 prebije',$,$,#40,$,$,.STANDARD.);\n` +
  `#333= IFCWALL('${guid("W3")}',$,'W3 vlastný',$,$,#40,$,$,.STANDARD.);\n` +
  `#334= IFCWALL('${guid("W4")}',$,'W4 bez hodnoty',$,$,#40,$,$,.STANDARD.);\n` +
  `#335= IFCRELDEFINESBYTYPE('${guid("RT1")}',$,$,$,(#331,#332),#330);\n` +
  `#336= IFCRELDEFINESBYPROPERTIES('${guid("RP1")}',$,$,$,(#332),#311);\n` +
  `#337= IFCRELDEFINESBYPROPERTIES('${guid("RP2")}',$,$,$,(#333),#321);\n`;
const IFC = MINI_BUILDING.replace(/ENDSEC;\nEND-ISO-10303-21;/, `${EXTRA}ENDSEC;\nEND-ISO-10303-21;`);

describe("LoadBearing - IFC súbor", () => {
  it("výskyt, inak typ; výskyt prebíja typ; bez hodnoty = neznáme", async () => {
    const store = await parseIfcBytes(new TextEncoder().encode(IFC), "lb");
    const express = (g: string) => {
      const id = store.entities.getExpressIdByGlobalId(g);
      if (!id || id < 0) throw new Error(`GUID ${g} nie je v store`);
      return id;
    };
    expect(loadBearingOf(store, express(guid("W1")))).toEqual({ value: true, source: "type" });
    expect(loadBearingOf(store, express(guid("W2")))).toEqual({ value: false, source: "occurrence" });
    expect(loadBearingOf(store, express(guid("W3")))).toEqual({ value: true, source: "occurrence" });
    expect(loadBearingOf(store, express(guid("W4")))).toEqual({ value: null, source: null });
  });
});
