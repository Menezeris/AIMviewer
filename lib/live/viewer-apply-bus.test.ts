import { afterEach, describe, expect, it, vi } from "vitest";

import { applyLive, deferCmdIds, emitApplied, parseIfcCommandUrl, setAppliedSink, setLiveApplyHandler, takePendingCmdIds } from "./viewer-apply-bus";

afterEach(() => {
  takePendingCmdIds();
});

describe("príkazy živého kanála na mieste (D-101)", () => {
  it("s viewerom vykoná na mieste, bez neho cmdId počkajú na navigáciu", () => {
    expect(applyLive({ ops: "show_all::", cmdIds: ["c1"] })).toBe(false);
    deferCmdIds(["c1"]);
    const h = vi.fn();
    const off = setLiveApplyHandler(h);
    expect(applyLive({ ops: "show_all::", cmdIds: ["c2"] })).toBe(true);
    expect(h).toHaveBeenCalledWith({ ops: "show_all::", cmdIds: ["c2"] });
    off();
    expect(takePendingCmdIds()).toEqual(["c1"]);
    expect(takePendingCmdIds()).toEqual([]);
  });

  it("odregistrovanie zruší len vlastný handler a sink", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = setLiveApplyHandler(a);
    setLiveApplyHandler(b);
    offA();
    applyLive({ cmdIds: [] });
    expect(b).toHaveBeenCalled();
    const s = vi.fn();
    const offS = setAppliedSink(s);
    emitApplied({ cmdId: "c", ok: true, issues: [] });
    offS();
    emitApplied({ cmdId: "d", ok: true, issues: [] });
    expect(s).toHaveBeenCalledTimes(1);
  });

  it("parseIfcCommandUrl: /ifc s focus/ops/r na mieste, iné parametre a cesty navigácii", () => {
    expect(parseIfcCommandUrl("/ifc?ops=section%3Ax&r=ab")).toEqual({ ops: "section:x", nonce: "ab", focus: undefined });
    expect(parseIfcCommandUrl("/ifc?focus=G1,G2&r=1")).toEqual({ focus: "G1,G2", nonce: "1", ops: undefined });
    expect(parseIfcCommandUrl("/ifc?doc=x&r=1")).toBeNull();
    expect(parseIfcCommandUrl("/node/abc")).toBeNull();
  });
});
