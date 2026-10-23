import { describe, expect, it } from "vitest";

import { NO_OWNER, OWNER_IDLE_MS, decideOwner, ownerFor, takeOver } from "./owner";
import { channelFor, splitChannel } from "./protocol";

describe("okno viewera patrí jednému chatu (D-159)", () => {
  it("prvý príkaz okno priradí, iný chat sa odmietne, vlastník prejde", () => {
    const a = decideOwner(NO_OWNER, "A", 1000);
    expect(a).toEqual({ accept: true, state: { sid: "A", at: 1000 } });
    expect(decideOwner(a.state, "B", 2000).accept).toBe(false);
    expect(decideOwner(a.state, "A", 3000)).toEqual({ accept: true, state: { sid: "A", at: 3000 } });
  });

  it("príkaz bez sid (starší server, LIVE_OWNER_LOCK=0) sa prijme a vlastníka nemení", () => {
    const s = { sid: "A", at: 1000 };
    expect(decideOwner(s, undefined, 2000)).toEqual({ accept: true, state: s });
  });

  it("po 15 min bez príkazu vlastníka okno prevezme ďalší chat", () => {
    const s = { sid: "A", at: 0 };
    expect(decideOwner(s, "B", OWNER_IDLE_MS).accept).toBe(false);
    expect(decideOwner(s, "B", OWNER_IDLE_MS + 1)).toEqual({ accept: true, state: { sid: "B", at: OWNER_IDLE_MS + 1 } });
  });

  it("odpoveď na otázku povie, kto okno ovláda; Prevziať ho dá cudziemu chatu", () => {
    const s = { sid: "A", at: 1000 };
    expect(ownerFor(s, "A", 2000)).toBe("you");
    expect(ownerFor(s, "B", 2000)).toBe("other");
    expect(ownerFor(s, undefined, 2000)).toBe("other");
    expect(ownerFor(NO_OWNER, "B", 2000)).toBe("none");
    expect(decideOwner(takeOver("B", 3000), "B", 4000).accept).toBe(true);
  });
});

describe("výber kanála vo vieweri (D-159)", () => {
  it("testy sessions = kanál s príponou -test; ?live= s príponou ich vyberie", () => {
    expect(channelFor("demo", "prod")).toBe("demo");
    expect(channelFor("demo", "test")).toBe("demo-test");
    expect(splitChannel("demo-test", null)).toEqual({ base: "demo", kind: "test" });
    expect(splitChannel("demo", "test")).toEqual({ base: "demo", kind: "test" });
    expect(splitChannel("demo", null)).toEqual({ base: "demo", kind: "prod" });
  });
});
