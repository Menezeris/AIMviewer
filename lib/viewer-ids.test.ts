import { describe, expect, it } from "vitest";

import { idsLoadMessage, idsOpenOp, idsSavedMessage, parseIdsSave, parseIdsOp } from "./viewer-ids";
import { opToBridgeMessage, parseOps } from "./viewer-ops";

describe("IDS vo vieweri (D-162)", () => {
  it("op ids_open sa vráti z URL parametra ops so všetkými voľbami", () => {
    const op = idsOpenOp({ code: "DEMO_MIESTNOSTI", target: "validation", version: 2, spec: "IU-O-space", run: true });
    expect(parseOps(op)).toEqual([{ op: "ids_open", code: "DEMO_MIESTNOSTI", target: "validation", version: 2, spec: "IU-O-space", run: true }]);
    expect(parseOps(idsOpenOp({ code: "A", target: "studio" }))).toEqual([{ op: "ids_open", code: "A", target: "studio" }]);
  });

  it("neplatný op sa preskočí (zlý cieľ, bez kódu, rozbité telo), run len true", () => {
    const bad = (payload: unknown) => `ids_open::${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
    expect(parseOps(bad({ code: "A", target: "both" }))).toEqual([]);
    expect(parseOps(bad({ target: "studio" }))).toEqual([]);
    expect(parseOps("ids_open::***")).toEqual([]);
    expect(parseIdsOp("")).toBeNull();
    expect(parseOps(bad({ code: "A", target: "studio", run: "áno", version: 0 }))).toEqual([{ op: "ids_open", code: "A", target: "studio" }]);
  });

  it("IDS_LOAD nesie kód, verziu, XML a voľby; run a spec len keď sú", () => {
    const doc = { code: "A", version: 3, title: "Názov", xml: "<ids/>" };
    expect(idsLoadMessage({ code: "A", target: "studio" }, doc)).toEqual({ type: "IDS_LOAD", code: "A", version: 3, title: "Názov", xml: "<ids/>", target: "studio" });
    expect(idsLoadMessage({ code: "A", target: "validation", spec: "S", run: true }, doc)).toMatchObject({ target: "validation", spec: "S", run: true });
  });

  it("IDS_SAVE z viewera: overí cieľ, XML a verziu; IDS_SAVED nesie úspech aj konflikt", () => {
    expect(parseIdsSave({ target: "studio", xml: "<ids/>", code: "A", base_version: 2, title: "T" })).toEqual({ target: "studio", xml: "<ids/>", code: "A", base_version: 2, title: "T" });
    expect(parseIdsSave({ target: "studio", xml: "  " })).toBeNull();
    expect(parseIdsSave({ target: "x", xml: "<ids/>" })).toBeNull();
    expect(parseIdsSave({ target: "studio", xml: "<ids/>", base_version: 0 })).toBeNull();
    expect(parseIdsSave(null)).toBeNull();
    expect(idsSavedMessage("studio", { ok: true, code: "A", version: 3 })).toEqual({ type: "IDS_SAVED", target: "studio", ok: true, code: "A", version: 3 });
    expect(idsSavedMessage("validation", { ok: false, error: "konflikt", latest_version: 4 })).toMatchObject({ ok: false, latest_version: 4 });
  });

  it("opToBridgeMessage ostatné ops nemení", () => {
    const [o] = parseOps("show_all::");
    expect(o && o.op !== "ids_open" ? opToBridgeMessage(o) : null).toBeTruthy();
  });
});
