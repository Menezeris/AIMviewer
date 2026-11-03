import { describe, expect, it } from "vitest";

import { SPACE_METHODS } from "./quantity-methods";
import { elementWire, pickLatestRecipes, referencedGuids, specLink, visibleCounts, type VerifyRow } from "./wire";

const G = "2V$Space0000000000001a";
const row = (o: Partial<VerifyRow> & Pick<VerifyRow, "target" | "recipe">): VerifyRow => ({
  model: "ASR",
  revision: 79,
  global_id: G,
  status: "green",
  file_value: 3.95,
  computed_value: 3.95,
  method: "m",
  definition: null,
  spec_ref: null,
  tolerance: "dĺžka +- 5 mm",
  formula: null,
  note: null,
  anchors: [],
  registry_version: 3,
  checked_at: "2026-11-02T10:00:00Z",
  engine: "@ifc-lite/mcp@0.27.0",
  stale: false,
  ...o,
});
const H = "Qto_SpaceBaseQuantities.Height";

describe("tvar overenia pre viewer (D-185 UI)", () => {
  it("na veličinu a rodinu receptu najvyšší register; Height: hlavný space.height.slabs, kontrolný space.height.own", () => {
    const rows = [
      row({ target: H, recipe: "space.height.own@1", status: "red", registry_version: 3 }),
      row({ target: H, recipe: "space.height.slabs@1", status: "red", registry_version: 1, checked_at: "2026-11-02T12:00:00Z" }),
      row({ target: H, recipe: "space.height.slabs@2", status: "green", registry_version: 3 }),
    ];
    expect(pickLatestRecipes(rows).map((r) => r.recipe).sort()).toEqual(["space.height.own@1", "space.height.slabs@2"]);
    const w = elementWire(rows, { currentRevision: 79 })!;
    expect(w.targets).toHaveLength(1);
    expect(w.targets[0].recipes.map((r) => r.recipe)).toEqual(["space.height.slabs@2", "space.height.own@1"]);
    expect(w.targets[0].status).toBe("green");
    expect(w.registry_version).toBe(3);
  });

  it("veličina bez hodnoty v súbore sa vynechá; poradie veličín podľa registra", () => {
    const w = elementWire(
      [
        row({ target: "Qto_SpaceBaseQuantities.NetVolume", recipe: SPACE_METHODS.net_volume.id, file_value: 300, computed_value: 300 }),
        row({ target: "Qto_SpaceBaseQuantities.FinishFloorHeight", recipe: SPACE_METHODS.ffh.id, file_value: null, status: "yellow" }),
        row({ target: H, recipe: SPACE_METHODS.height_slabs.id }),
      ],
      { currentRevision: 79 },
    )!;
    expect(w.targets.map((t) => t.target)).toEqual([H, "Qto_SpaceBaseQuantities.NetVolume"]);
    expect(w.targets.map((t) => t.unit)).toEqual(["m", "m3"]);
  });

  it("stale: revízia behu staršia ako aktuálna alebo stale z pohľadu", () => {
    const rows = [row({ target: H, recipe: SPACE_METHODS.height_slabs.id })];
    expect(elementWire(rows, { currentRevision: 79 })!).toMatchObject({ revision: 79, current_revision: 79, stale: false });
    expect(elementWire(rows, { currentRevision: 80 })!).toMatchObject({ revision: 79, current_revision: 80, stale: true });
    expect(elementWire([{ ...rows[0], stale: true }], { currentRevision: null })!.stale).toBe(true);
    expect(elementWire([], { currentRevision: 79 })).toBeNull();
  });

  it("spec odkaz na bSI, tolerancia číslom, bunky s object_ref výskytu, file_meta a help_href", () => {
    const w = elementWire(
      [
        row({
          target: H,
          recipe: SPACE_METHODS.height_slabs.id,
          spec_ref: SPACE_METHODS.height_slabs.spec_ref,
          explanation: "Výška miestnosti ...",
          inputs: {
            expression: "A - B",
            cells: [
              { key: "A", label: "spodok dosky nad", value: 8.8, unit: "m", global_id: "slabAbove000000000000a" },
              { key: "B", label: "vrch dosky pod", value: 4.85, unit: "m", global_id: "slabBelow000000000000b" },
            ],
            file_meta: { method_of_measurement: "BaseQuantities" },
          },
        }),
      ],
      { currentRevision: 79, refs: new Map([["slabAbove000000000000a", "SD02.03.0003"]]), helpHref: "/overenie" },
    )!;
    const t = w.targets[0];
    expect(t.spec).toEqual({
      label: "Qto_SpaceBaseQuantities.Height, IFC 4.3",
      url: "https://github.com/buildingSMART/IFC4.3.x-development/blob/d71e140/reference_schemas/psd/Qto_SpaceBaseQuantities.xml",
    });
    expect(t.tolerance).toEqual({ text: "dĺžka +- 5 mm", abs: 0.005 });
    expect(t.file_meta).toEqual({ method_of_measurement: "BaseQuantities" });
    expect(t.definition).toBe(SPACE_METHODS.height_slabs.definition);
    expect(t.recipes[0].cells[0]).toEqual({ key: "A", label: "spodok dosky nad", value: 8.8, unit: "m", global_id: "slabAbove000000000000a", ref: "SD02.03.0003" });
    expect(t.recipes[0].cells[1].ref).toBeUndefined();
    expect(t.recipes[0]).toMatchObject({ expression: "A - B", explanation: "Výška miestnosti ..." });
    expect(w.help_href).toBe("/overenie");
  });

  it("kotvy dostanú ref výskytu a odvodená bunka nesie quantity", () => {
    const w = elementWire(
      [
        row({
          target: H,
          recipe: "space.height.slabs@2",
          anchors: [{ global_id: "slabAbove000000000000a", role: "doska nad", z_m: 8.8 }, { global_id: "unknown", role: "x" }],
          inputs: { cells: [{ key: "B", label: "výška", value: 3.95, unit: "m", global_id: "slabAbove000000000000a", quantity: "Qto_SpaceBaseQuantities.Height" }] },
        }),
      ],
      { currentRevision: 79, refs: new Map([["slabAbove000000000000a", "SD02.03.0003"]]) },
    )!;
    const r = w.targets[0].recipes[0];
    expect(r.anchors).toEqual([{ global_id: "slabAbove000000000000a", role: "doska nad", z_m: 8.8, ref: "SD02.03.0003" }, { global_id: "unknown", role: "x" }]);
    expect(r.cells[0].quantity).toBe("Qto_SpaceBaseQuantities.Height");
  });

  it("riadok pred migráciou (bez inputs): vysvetlenie z registra, bunky prázdne, vzorec textom", () => {
    const w = elementWire([row({ target: H, recipe: "space.height.slabs@2", formula: "8.8 - 4.85 = 3.95 m" })], { currentRevision: 79 })!;
    expect(w.targets[0].recipes[0]).toMatchObject({ cells: [], formula_text: "8.8 - 4.85 = 3.95 m", explanation: SPACE_METHODS.height_slabs.explanation });
  });

  it("tolerancia NetVolume = 1 % z GrossVolume - NetVolume zo súboru (+ zaokrúhlenie), plocha relatívne", () => {
    const w = elementWire(
      [
        row({ target: "Qto_SpaceBaseQuantities.GrossVolume", recipe: SPACE_METHODS.gross_volume.id, file_value: 347.6 }),
        row({ target: "Qto_SpaceBaseQuantities.NetVolume", recipe: SPACE_METHODS.net_volume.id, file_value: 333.5 }),
        row({ target: "Qto_SpaceBaseQuantities.GrossFloorArea", recipe: SPACE_METHODS.gross_floor_area.id, file_value: 88 }),
      ],
      { currentRevision: 79 },
    )!;
    const tol = Object.fromEntries(w.targets.map((t) => [t.target.split(".")[1], t.tolerance.abs]));
    expect(tol.NetVolume).toBeCloseTo(0.141 + 0.0005, 6);
    expect(tol.GrossVolume).toBeCloseTo(1.738, 6);
    expect(tol.GrossFloorArea).toBeCloseTo(0.44, 6);
  });

  it("pomocné: specLink odmietne cudzí tvar, referencedGuids a visibleCounts", () => {
    expect(specLink("javascript:alert(1)")).toBeUndefined();
    const rows = [row({ target: H, recipe: "space.height.slabs@2", anchors: [{ global_id: "a", role: "r" }], inputs: { cells: [{ key: "A", label: "x", value: 1, unit: "m", global_id: "b" }] } })];
    expect(referencedGuids(rows).sort()).toEqual(["a", "b"]);
    expect(visibleCounts([elementWire(rows, { currentRevision: 79 })!])).toEqual({ green: 1, yellow: 0, red: 0, grey: 0 });
  });
});
