import { describe, expect, it } from "vitest";

import { autoRotateOp, opToBridgeMessage, parseOps } from "../viewer-ops";
import { planCamera } from "./camera-plan";
import { ViewInputError } from "./view-plan";

const STAIR = "1KphWFyMb8dRV6rhVkyU6y";

describe("set_camera auto_rotate: plynulé otáčanie dokola (D-154)", () => {
  it("start s predvolenou rýchlosťou a smerom doľava", () => {
    const p = planCamera({ auto_rotate: "start" }, []);
    expect(p.ops).toEqual(["auto_rotate:start~s=10~d=l:"]);
    expect(p.result).toMatchObject({ ok: true, auto_rotate: "start", speed_deg_s: 10, direction: "left" });
    expect(p.label).toContain("doľava");
  });

  it("pomaličky doprava: rýchlosť a smer idú do mosta ako AUTO_ROTATE", () => {
    const p = planCamera({ auto_rotate: "start", speed_deg_s: 5, direction: "right" }, []);
    expect(opToBridgeMessage(parseOps(p.ops[0])[0])).toEqual({ type: "AUTO_ROTATE", action: "start", speedDegS: 5, direction: "right" });
  });

  it("stop nenesie rýchlosť ani smer", () => {
    const p = planCamera({ auto_rotate: "stop" }, []);
    expect(p.ops).toEqual(["auto_rotate:stop:"]);
    expect(opToBridgeMessage(parseOps(p.ops[0])[0])).toEqual({ type: "AUTO_ROTATE", action: "stop" });
    expect(() => planCamera({ auto_rotate: "stop", speed_deg_s: 5 }, [])).toThrow(ViewInputError);
  });

  it("chybné hodnoty: akcia, rýchlosť mimo rozsahu, smer", () => {
    expect(() => planCamera({ auto_rotate: "spin" }, [])).toThrow(/start, stop/);
    expect(() => planCamera({ auto_rotate: "start", speed_deg_s: 0 }, [])).toThrow(/0.5 až 90/);
    expect(() => planCamera({ auto_rotate: "start", speed_deg_s: 500 }, [])).toThrow(ViewInputError);
    expect(() => planCamera({ auto_rotate: "start", speed_deg_s: "5" }, [])).toThrow(ViewInputError);
    expect(() => planCamera({ auto_rotate: "start", direction: "up" }, [])).toThrow(/left, right/);
  });

  it("s presetom, cieľom alebo krokom ide len samostatne; rýchlosť bez auto_rotate je chyba", () => {
    expect(() => planCamera({ auto_rotate: "start", preset: "iso" }, [])).toThrow(/samostatnom volaní/);
    expect(() => planCamera({ auto_rotate: "start", orbit_h_deg: 20 }, [])).toThrow(/orbit_h_deg/);
    expect(() => planCamera({ auto_rotate: "stop", zoom_percent: 10 }, [])).toThrow(/zoom_percent/);
    expect(() => planCamera({ auto_rotate: "start" }, [STAIR])).not.toThrow();
    expect(() => planCamera({ auto_rotate: "start", target_ids_or_refs: [STAIR] }, [STAIR])).toThrow(/target_ids_or_refs/);
    expect(() => planCamera({ speed_deg_s: 5 }, [])).toThrow(/auto_rotate=start/);
    expect(() => planCamera({ preset: "top", direction: "left" }, [])).toThrow(/auto_rotate=start/);
  });

  it("wire formát: round trip a zahodenie neplatných hodnôt", () => {
    expect(autoRotateOp("start")).toBe("auto_rotate:start:");
    expect(autoRotateOp("start", 2.5, "left")).toBe("auto_rotate:start~s=2.5~d=l:");
    expect(parseOps("auto_rotate:start~s=2.5~d=r:")).toEqual([{ op: "auto_rotate", action: "start", speedDegS: 2.5, direction: "right" }]);
    // Rýchlosť mimo rozsahu sa zahodí (fork použije default), neznáma akcia celý op.
    expect(parseOps("auto_rotate:start~s=900:")).toEqual([{ op: "auto_rotate", action: "start" }]);
    expect(parseOps("auto_rotate:spin:")).toEqual([]);
    expect(parseOps("auto_rotate:stop~s=5~d=l:")).toEqual([{ op: "auto_rotate", action: "stop" }]);
  });
});
