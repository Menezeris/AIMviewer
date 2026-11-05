import { afterEach, describe, expect, it, vi } from "vitest";

import { applyLive, deferCmdIds, emitApplied, isRestoredCommandUrl, parseIfcCommandUrl, setAppliedSink, setLiveApplyHandler, takePendingCmdIds, withoutCommandParams } from "./viewer-apply-bus";

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

describe("štart bez starého príkazu (#313)", () => {
  const url = "https://ai-mviewer.vercel.app/ifc?ops=section%3Ay&r=1";
  it("obnova stránky a krok v histórii na tej istej adrese príkaz nezopakujú", () => {
    expect(isRestoredCommandUrl({ type: "reload", name: url }, url)).toBe(true);
    expect(isRestoredCommandUrl({ type: "back_forward", name: url }, url)).toBe(true);
  });
  it("nový odkaz a navigácia v appke po obnove inej stránky príkaz vykonajú", () => {
    expect(isRestoredCommandUrl({ type: "navigate", name: url }, url)).toBe(false);
    expect(isRestoredCommandUrl({ type: "reload", name: "https://ai-mviewer.vercel.app/node/1" }, url)).toBe(false);
    expect(isRestoredCommandUrl(undefined, url)).toBe(false);
  });
  it("z adresy odstráni len časti príkazu", () => {
    expect(withoutCommandParams("https://ai-mviewer.vercel.app/ifc?live=aim-viewer&ops=a&focus=b&r=1")).toBe(
      "https://ai-mviewer.vercel.app/ifc?live=aim-viewer"
    );
  });
});
