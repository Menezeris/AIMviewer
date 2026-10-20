import { describe, expect, it } from "vitest";

import {
  SCOPED_GUID_CAP,
  StyleInputError,
  allocateCap,
  documentPage,
  intersectSets,
  matchesAttributes,
  matchesProperty,
  needsScopedStyle,
  parseStyleGroups,
  pickNamed,
  styleOp,
} from "./style-plan";

describe("needsScopedStyle", () => {
  it("zapne rozšírený režim pri systéme, zóne, podlaží alebo skupinách", () => {
    expect(needsScopedStyle({ action: "colorize", system: "Prívod-1NP" })).toBe(true);
    expect(needsScopedStyle({ action: "isolate", zone: "Nájomné priestory" })).toBe(true);
    expect(needsScopedStyle({ action: "hide", storey: "2NP" })).toBe(true);
    expect(needsScopedStyle({ action: "hide", not_in_system: true })).toBe(true);
    expect(needsScopedStyle({ action: "colorize", groups: [] })).toBe(true);
    expect(needsScopedStyle({ action: "hide", document: "D.1.1.03" })).toBe(true);
  });
  it("pôvodné volania ostávajú na starej ceste", () => {
    expect(needsScopedStyle({ action: "colorize", ifc_type: "IfcDoor", color: "ef4444" })).toBe(false);
    expect(needsScopedStyle({ action: "hide", system: "", not_in_system: false })).toBe(false);
  });
});

describe("documentPage (D-104 krok 4)", () => {
  it("strana len s dokumentom, kladné celé číslo aj ako text", () => {
    expect(documentPage({ document: "D.1.1.09" })).toBeUndefined();
    expect(documentPage({ document: "D.1.1.09", page: 3 })).toBe(3);
    expect(documentPage({ document: "D.1.1.09", page: "4" })).toBe(4);
    expect(() => documentPage({ document: "D.1.1.09", page: 0 })).toThrow(StyleInputError);
    expect(() => documentPage({ document: "D.1.1.09", page: 2.5 })).toThrow(StyleInputError);
    expect(() => documentPage({ page: 3 })).toThrow(/spolu s document/);
  });
  it("dokument a strana idú do štítku skupiny aj do filtra", () => {
    const [g] = parseStyleGroups({ action: "isolate", document: "D.1.1.09", page: 3 }, "isolate");
    expect(g.label).toBe("dokument D.1.1.09, s. 3");
    expect(g.filter).toEqual({ document: "D.1.1.09", page: 3 });
  });
});

describe("parseStyleGroups", () => {
  it("bez groups je jedna skupina z top-level filtra", () => {
    const g = parseStyleGroups({ action: "colorize", color: "#EF4444", system: "Prívod", storey: "1NP" }, "colorize");
    expect(g).toHaveLength(1);
    expect(g[0].color).toBe("ef4444");
    expect(g[0].filter).toEqual({ system: "Prívod", storey: "1NP" });
  });
  it("top-level filter platí pre každú skupinu, skupina ho spresní", () => {
    const g = parseStyleGroups(
      {
        action: "colorize",
        ifc_type: "IfcDuctFitting",
        storey: "1NP",
        groups: [
          { label: "prívod", color: "ef4444", system: "Prívod-1NP" },
          { color: "3b82f6", system: "Odvod-1NP", storey: "2NP" },
        ],
      },
      "colorize",
    );
    expect(g.map((x) => x.color)).toEqual(["ef4444", "3b82f6"]);
    expect(g[0].filter).toEqual({ ifc_type: "IfcDuctFitting", storey: "1NP", system: "Prívod-1NP" });
    expect(g[1].filter.storey).toBe("2NP");
    expect(g[0].label).toBe("prívod");
    expect(g[1].label).toContain("Odvod-1NP");
  });
  it("odmietne groups pri inej akcii, chýbajúcu farbu a skupinu bez filtra", () => {
    expect(() => parseStyleGroups({ groups: [{ color: "ef4444", system: "X" }] }, "hide")).toThrow(StyleInputError);
    expect(() => parseStyleGroups({ groups: [{ system: "X" }] }, "colorize")).toThrow(/color/);
    expect(() => parseStyleGroups({ groups: [{ color: "ef4444" }] }, "colorize")).toThrow(/filter/);
    expect(() => parseStyleGroups({ color: "red", system: "X" }, "colorize")).toThrow(/hex/);
  });
  it("hide ani izolácia farbu nepotrebujú (izolované prvky ostanú v pôvodnom vzhľade)", () => {
    expect(parseStyleGroups({ zone: "Nájomné priestory", ifc_type: "IfcSpace" }, "hide")[0].color).toBe("");
    expect(parseStyleGroups({ zone: "Nájomné priestory" }, "isolate")[0].color).toBe("");
    expect(parseStyleGroups({ zone: "Nájomné priestory", color: "#22C55E" }, "isolate")[0].color).toBe("22c55e");
  });
  it("X-ray (D-105) ako izolácia: farba voliteľná, groups povolené", () => {
    expect(parseStyleGroups({ ifc_type: "IfcWall" }, "xray")[0].color).toBe("");
    const g = parseStyleGroups({ groups: [{ color: "f97316", system: "X" }, { system: "Y" }] }, "xray");
    expect(g.map((x) => x.color)).toEqual(["f97316", ""]);
  });
  it("groups platia aj pre transparent a isolate; transparent farbu vyžaduje", () => {
    const g = parseStyleGroups({ groups: [{ color: "ef4444", system: "X" }, { system: "Y" }] }, "isolate");
    expect(g.map((x) => x.color)).toEqual(["ef4444", ""]);
    expect(() => parseStyleGroups({ groups: [{ system: "X" }] }, "transparent")).toThrow(/color/);
  });
});

describe("intersectSets", () => {
  it("AND naprieč zadanými kritériami, null = nezadané", () => {
    expect(intersectSets([null, null])).toBeNull();
    const r = intersectSets([new Set(["a", "b", "c"]), null, new Set(["b", "c", "d"])]);
    expect([...(r ?? [])].sort()).toEqual(["b", "c"]);
  });
});

describe("pickNamed", () => {
  const rows = [
    { id: "1", object_ref: "Prívod-1NP", name: "Prívod-1NP" },
    { id: "2", object_ref: "Prívod-2NP", name: "Prívod-2NP" },
    { id: "3", object_ref: "Odvod-1NP", name: "Odvod-1NP" },
  ];
  it("presná zhoda má prednosť pred obsahovaním", () => {
    expect(pickNamed(rows, "prívod-1np").map((r) => r.id)).toEqual(["1"]);
  });
  it("ObjectType systému vyberie všetky systémy daného druhu", () => {
    const typed = [
      { id: "1", object_ref: "Prívod-1NP", name: "Prívod-1NP", user_defined_type: "Přiváděný vzduch" },
      { id: "2", object_ref: "Nasávanie", name: "Nasávanie", user_defined_type: "Přiváděný vzduch" },
      { id: "3", object_ref: "Odvod-1NP", name: "Odvod-1NP", user_defined_type: "Odváděný vzduch" },
    ];
    expect(pickNamed(typed, "přiváděný vzduch").map((r) => r.id)).toEqual(["1", "2"]);
  });
  it("časť názvu vyberie všetky zhodné systémy", () => {
    expect(pickNamed(rows, "Prívod").map((r) => r.id)).toEqual(["1", "2"]);
    expect(pickNamed(rows, "1NP").map((r) => r.id)).toEqual(["1", "3"]);
  });
});

describe("matchesAttributes / matchesProperty", () => {
  const row = { id: "x", object_ref: "R1", name: "Tvarovka", ifc_type: "IfcDuctFitting", predefined_type: "BEND" };
  it("trieda, podtyp a text bez ohľadu na veľkosť písmen", () => {
    expect(matchesAttributes(row, { types: ["ifcductfitting"], predefinedType: "bend", query: "" })).toBe(true);
    expect(matchesAttributes(row, { types: ["IfcDuctSegment"], predefinedType: "", query: "" })).toBe(false);
    expect(matchesAttributes(row, { types: [], predefinedType: "", query: "tvar" })).toBe(true);
  });
  it("vlastnosť psetu, voliteľne len v jednom psete, bez rezervovaných _kľúčov", () => {
    const props = { Pset_WallCommon: { LoadBearing: true }, _contact: { LoadBearing: "true" } };
    expect(matchesProperty(props, "loadbearing", "TRUE")).toBe(true);
    expect(matchesProperty(props, "LoadBearing", "true", "Pset_Other")).toBe(false);
    expect(matchesProperty({ _contact: { LoadBearing: "true" } }, "LoadBearing", "true")).toBe(false);
  });
});

describe("allocateCap", () => {
  it("malé skupiny dostanú všetko, zvyšok väčším", () => {
    expect(allocateCap([10, 1000, 20], 500)).toEqual([10, 470, 20]);
    expect(allocateCap([300, 300], 500)).toEqual([250, 250]);
    expect(allocateCap([0, 5], 500)).toEqual([0, 5]);
  });
  it("nikdy neprekročí strop", () => {
    const out = allocateCap([400, 400, 400]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(SCOPED_GUID_CAP);
  });
});

describe("styleOp", () => {
  it("D-066 wire formát; farba len pri colorize", () => {
    expect(styleOp("colorize", "ef4444", ["a", "b"])).toBe("colorize:ef4444:a.b");
    expect(styleOp("isolate", "ef4444", ["a"])).toBe("isolate::a");
  });
});
