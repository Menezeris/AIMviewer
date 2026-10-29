import { describe, expect, it } from "vitest";

import { toGeorefV2, type GeorefCalibration } from "../data/georef";
import { underlaysSetOp } from "../viewer-underlays";

import { execUnderlayControl, type CalibratedDocument, type ControlDeps, type ViewerSnapshot, type ViewerUnderlay } from "./underlay-control";

const ASR1 = "11111111-1111-4111-8111-111111111111";
const VZT1 = "22222222-2222-4222-8222-222222222222";
const ASR2 = "33333333-3333-4333-8333-333333333333";
const G1 = "2VefEmfcj8sx0WLKr$GNnn";
const G1_VZT = "3VefEmfcj8sx0WLKr$GNnn";
const G2 = "1QefEmfcj8sx0WLKr$GNn1";

const cal = (over: Partial<GeorefCalibration> = {}): GeorefCalibration => ({
  page: 1,
  page_size: [3000, 1700],
  storey_guid: G1,
  storey_z: 0,
  plane: null,
  affine: [0.0176, 0, 25.5, 0, 0.0176, -12.1],
  calibration: [{ pdf_pt: [10, 10], ifc_m: [25.7, -11.9] }],
  source: "auto",
  opacity: 0.6,
  visible: true,
  discipline: "ASR",
  calibrated_at: "2026-10-22T10:00:00.000Z",
  ...over,
});

const doc = (id: string, ref: string, cals: GeorefCalibration[]): CalibratedDocument => ({
  id,
  object_ref: ref,
  name: ref,
  georef: { version: 2, calibrations: cals },
});

const DOCS = [
  doc(ASR1, "OCB_ASR_1NP", [cal()]),
  doc(ASR2, "OCB_ASR_2NP", [cal({ storey_guid: G2, source: "manual", visible: false, opacity: 0.3 })]),
];

const FLOORS = new Map([[G1, "1NP"], [G1_VZT, "1NP"], [G2, "2NP"]]);

function deps(over: Partial<ControlDeps> = {}, viewer?: Partial<ViewerSnapshot>, docs = DOCS): ControlDeps {
  return {
    documents: async () => docs,
    floorNames: async (guids) => new Map(guids.filter((g) => FLOORS.has(g)).map((g) => [g, FLOORS.get(g)!])),
    floor: async (ref) => {
      const guids = [...FLOORS].filter(([, n]) => n.toLowerCase() === ref.toLowerCase()).map(([g]) => g);
      return guids.length ? { name: ref.toUpperCase(), guids } : null;
    },
    viewer: async () => ({ connected: true, underlays: [], underlays_3d: true, ...viewer }),
    writeEnabled: true,
    ...over,
  };
}

const run = async (args: Record<string, unknown>, d = deps()) => {
  const r = await execUnderlayControl(args, d);
  return { ...r, json: r.isError ? null : JSON.parse(r.text) };
};

const live = (over: Partial<ViewerUnderlay> = {}): ViewerUnderlay => ({
  document_id: ASR1,
  name: "OCB_ASR_1NP",
  page: 1,
  storey_guid: G1,
  storey_z: 0,
  discipline: "ASR",
  calibrated_at: "2026-10-22T10:00:00.000Z",
  visible: false,
  opacity: 0.9,
  saved: { visible: true, opacity: 0.6 },
  overridden: true,
  ...over,
});

describe("calibrate_underlay mode=list (D-168)", () => {
  it("zlúči stav viewera s DB", async () => {
    const r = await run({ mode: "list" }, deps({}, { underlays: [live()] }));
    expect(r.json.viewer).toBe("živý");
    expect(r.json.underlays).toEqual([
      {
        document_id: ASR1, object_ref: "OCB_ASR_1NP", name: "OCB_ASR_1NP", page: 1, floor: "1NP",
        visible: false, opacity: 0.9, saved_visible: true, saved_opacity: 0.6, overridden: true,
        source: "auto", calibrated_at: "2026-10-22T10:00:00.000Z", underlays_3d: true,
      },
      // 2NP viewer nepozná: hodnoty z DB
      {
        document_id: ASR2, object_ref: "OCB_ASR_2NP", name: "OCB_ASR_2NP", page: 1, floor: "2NP",
        visible: false, opacity: 0.3, saved_visible: false, saved_opacity: 0.3,
        source: "manual", calibrated_at: "2026-10-22T10:00:00.000Z", underlays_3d: true,
      },
    ]);
  });

  it("bez viewera len z DB", async () => {
    const r = await run({ mode: "list" }, deps({}, { connected: false, reason: "viewer neodpovedal", underlays: null, underlays_3d: null }));
    expect(r.json).toMatchObject({ viewer: "nie je", reason: "viewer neodpovedal", count: 2 });
    expect(r.json.underlays[0]).toMatchObject({ visible: true, opacity: 0.6, saved_visible: true, underlays_3d: null });
  });

  it("starý viewer (stav bez poľa underlays) sa pozná a list ide z DB", async () => {
    const r = await run({ mode: "list" }, deps({}, { underlays: null, underlays_3d: true }));
    expect(r.json.viewer).toBe("starý");
    expect(r.json.underlays[1]).toMatchObject({ visible: false, opacity: 0.3 });
  });

  it("podklad, ktorý je len vo vieweri (neuložená kalibrácia), sa vypíše", async () => {
    const r = await run({ mode: "list" }, deps({}, { underlays: [live({ document_id: "44444444-4444-4444-8444-444444444444", page: 2 })] }));
    expect(r.json.count).toBe(3);
    expect(r.json.underlays[2]).toMatchObject({ object_ref: null, source: null, page: 2 });
  });
});

describe("calibrate_underlay mode=show_in_3d | hide | set_opacity (D-168)", () => {
  it("show_in_3d podľa document_id (object_ref aj UUID), only a persist idú do príkazu", async () => {
    const byRef = await run({ mode: "show_in_3d", document_id: "OCB_ASR_1NP", only: true, persist: true });
    expect(byRef.command).toEqual({ show: true, underlays: [{ document_id: ASR1, visible: true }], only: true, persist: true });
    expect(byRef.json.target).toEqual({ document_id: ASR1, object_ref: "OCB_ASR_1NP", name: "OCB_ASR_1NP", page: 1, floor: "1NP" });
    const byId = await run({ mode: "show_in_3d", document_id: ASR1.toUpperCase() });
    expect(byId.command).toEqual({ show: true, underlays: [{ document_id: ASR1, visible: true }], only: false, persist: false });
  });

  it("floor sa cez storey_guid kalibrácie preloží na dokument", async () => {
    const r = await run({ mode: "show_in_3d", floor: "2np" });
    expect(r.command?.underlays).toEqual([{ document_id: ASR2, visible: true }]);
  });

  it("hide a set_opacity; persist je predvolene vypnutý a príkaz je platný pre op", async () => {
    const hide = await run({ mode: "hide", floor: "1NP" });
    expect(hide.command).toEqual({ underlays: [{ document_id: ASR1, visible: false }], persist: false });
    const op = await run({ mode: "set_opacity", document_id: ASR1, opacity: 0.25, persist: true });
    expect(op.command).toEqual({ underlays: [{ document_id: ASR1, opacity: 0.25 }], persist: true });
    expect(() => underlaysSetOp(op.command!)).not.toThrow();
    expect(() => underlaysSetOp(hide.command!)).not.toThrow();
  });

  it("nikdy nenesie polohu ani kalibráciu", async () => {
    const r = await run({ mode: "show_in_3d", document_id: ASR1, persist: true });
    expect(r.text).not.toMatch(/pdf_pt|0\.0176|median_mm/);
    expect(JSON.stringify(r.command)).not.toMatch(/affine|calibration/);
  });

  it("set_opacity potrebuje opacity 0 až 1", async () => {
    expect((await run({ mode: "set_opacity", document_id: ASR1 })).text).toMatch(/opacity/);
    expect((await run({ mode: "set_opacity", document_id: ASR1, opacity: 1.5 })).isError).toBe(true);
    expect((await run({ mode: "set_opacity", document_id: ASR1, opacity: "0.5" })).isError).toBe(true);
    expect((await run({ mode: "set_opacity", document_id: ASR1, opacity: 0 })).isError).toBe(false);
  });

  it("chyby: chýba cieľ, oboje, neznámy dokument, podlažie bez podkladu", async () => {
    expect((await run({ mode: "hide" })).text).toMatch(/document_id.*floor/);
    expect((await run({ mode: "hide", document_id: ASR1, floor: "1NP" })).text).toMatch(/nie oboje/);
    expect((await run({ mode: "hide", document_id: "NEEXISTUJE" })).text).toMatch(/nemá kalibráciu/);
    expect((await run({ mode: "hide", floor: "9NP" })).text).toMatch(/nie je v AIM/);
    const noCal = deps({}, undefined, [doc(ASR1, "OCB_ASR_1NP", [cal({ storey_guid: G1 })])]);
    expect((await run({ mode: "hide", floor: "2NP" }, noCal)).text).toMatch(/nemá kalibrovaný podklad/);
    expect((await run({ mode: "hide", document_id: ASR1, persist: "ano" })).text).toMatch(/persist/);
  });

  it("page: nesedí s kalibrovanou stranou = chyba; viewer pozná jednu stranu", async () => {
    expect((await run({ mode: "hide", document_id: ASR1, page: 2 })).text).toMatch(/Kalibrovaná je strana 1, nie 2/);
    expect((await run({ mode: "hide", document_id: ASR1, page: 1 })).isError).toBe(false);
    expect((await run({ mode: "hide", document_id: ASR1, page: 0 })).isError).toBe(true);
    const twoPages = deps({}, { underlays: [live({ page: 2 })] }, [doc(ASR1, "OCB_ASR_1NP", [cal(), cal({ page: 2, storey_guid: G2 })])]);
    expect((await run({ mode: "hide", document_id: ASR1, page: 1 }, twoPages)).text).toMatch(/Viewer pozná.*stranu 2, nie 1/);
    expect((await run({ mode: "hide", document_id: ASR1, page: 2 }, twoPages)).isError).toBe(false);
  });

  it("dokument s viac stranami bez page, a viac podkladov na podlaží, sú nejednoznačné", async () => {
    const multi = deps({}, undefined, [doc(ASR1, "OCB_ASR_1NP", [cal(), cal({ page: 2 })])]);
    expect((await run({ mode: "show_in_3d", document_id: ASR1 }, multi)).text).toMatch(/Nejednoznačné.*Zadaj document_id a page/);
    const two = deps({}, undefined, [DOCS[0], doc(VZT1, "OCB_VZT_1NP", [cal({ storey_guid: G1_VZT, discipline: "VZT" })])]);
    const r = await run({ mode: "show_in_3d", floor: "1NP" }, two);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/OCB_ASR_1NP.*OCB_VZT_1NP|OCB_VZT_1NP.*OCB_ASR_1NP/);
    expect(r.text).toMatch(/VZT/);
  });

  it("rez (kalibrácia s rovinou) sa podľa podlažia nenájde, ale podľa document_id áno", async () => {
    const section = cal({ storey_guid: null, storey_z: null, plane: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] } });
    const d = deps({}, undefined, [doc(ASR1, "OCB_ASR_REZ", [section])]);
    expect((await run({ mode: "hide", floor: "1NP" }, d)).isError).toBe(true);
    const ok = await run({ mode: "hide", document_id: ASR1 }, d);
    expect(ok.command?.underlays?.[0].document_id).toBe(ASR1);
    expect(ok.json.target.floor).toBeNull();
  });

  it("upozornenia: starý viewer, viewer nedostupný, vypnutý zápis pri persist", async () => {
    const old = await run({ mode: "hide", document_id: ASR1 }, deps({}, { underlays: null }));
    expect(old.json.notes.join(" ")).toMatch(/starší/);
    const off = await run({ mode: "hide", document_id: ASR1 }, deps({}, { connected: false, reason: "viewer neodpovedal", underlays: null }));
    expect(off.json.notes.join(" ")).toMatch(/nepodarilo prečítať/);
    const ro = await run({ mode: "hide", document_id: ASR1, persist: true }, deps({ writeEnabled: false }));
    expect(ro.json.notes.join(" ")).toMatch(/UNDERLAY_WRITE_ENABLED/);
    expect(toGeorefV2(DOCS[0].georef).calibrations).toHaveLength(1);
  });

  it("neznámy mode je chyba", async () => {
    expect((await run({ mode: "remove", document_id: ASR1 })).isError).toBe(true);
  });
});
