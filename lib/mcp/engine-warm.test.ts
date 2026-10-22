/**
 * Zahriatie IFC motora na studenej inštancii (D-135): predčíta len rozhovor, ktorý motor používa.
 */
import { describe, expect, it } from "vitest";

import {
  ENGINE_WANT_WINDOW_MS,
  WANT_CHECK_EVERY_MS,
  engineUsedSince,
  engineWarmDecision,
  isEngineTool,
  payloadToolNames,
  type EngineWarmState,
} from "./engine-warm";

const COLD: EngineWarmState = { preloaded: false, checkedAt: null };
const DB = { engineCall: false, connect: false };

describe("engineWarmDecision", () => {
  it("DB tool na studenej inštancii nepredčíta, len overí použitie motora", () => {
    const r = engineWarmDecision(COLD, 1_000, DB);
    expect(r.decision).toBe("check");
    expect(r.state).toEqual({ preloaded: false, checkedAt: 1_000 });
  });

  it("pripojenie (initialize / tools/list) samo modely nesťahuje", () => {
    expect(engineWarmDecision(COLD, 1_000, { engineCall: false, connect: true }).decision).toBe("check");
  });

  it("tool motora predčíta hneď a stav zapíše (súbežná požiadavka už nič nespustí)", () => {
    const r = engineWarmDecision(COLD, 1_000, { engineCall: true, connect: false });
    expect(r.decision).toBe("preload");
    expect(engineWarmDecision(r.state, 1_001, { engineCall: true, connect: false }).decision).toBe("skip");
  });

  it("kontrola najviac raz za minútu na inštanciu", () => {
    const { state } = engineWarmDecision(COLD, 1_000, DB);
    expect(engineWarmDecision(state, 1_000 + WANT_CHECK_EVERY_MS - 1, DB).decision).toBe("skip");
    expect(engineWarmDecision(state, 1_000 + WANT_CHECK_EVERY_MS, DB).decision).toBe("check");
  });

  it("teplý motor pri pripojení len revaliduje, inak nič", () => {
    const warm = { preloaded: true, checkedAt: null };
    expect(engineWarmDecision(warm, 0, DB).decision).toBe("skip");
    expect(engineWarmDecision(warm, 0, { engineCall: true, connect: false }).decision).toBe("skip");
    expect(engineWarmDecision(warm, 0, { engineCall: false, connect: true }).decision).toBe("preload");
  });

  it("okno použitia je 30 minút", () => {
    expect(ENGINE_WANT_WINDOW_MS).toBe(30 * 60_000);
  });
});

describe("payloadToolNames / isEngineTool", () => {
  it("mená z tools/call, aj z dávky; iné metódy nie", () => {
    expect(payloadToolNames({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ifc_get" } })).toEqual(["ifc_get"]);
    expect(payloadToolNames([{ method: "tools/call", params: { name: "query_view" } }, { method: "tools/list" }, null])).toEqual(["query_view"]);
    expect(payloadToolNames("x")).toEqual([]);
  });

  it("motor = registrované ifc_* + search_all + calibrate_underlay", () => {
    const set = new Set(["ifc_get", "ifc_query"]);
    expect(isEngineTool("ifc_get", set)).toBe(true);
    expect(isEngineTool("search_all", set)).toBe(true);
    expect(isEngineTool("calibrate_underlay", set)).toBe(true);
    expect(isEngineTool("query_view", set)).toBe(false);
  });
});

describe("engineUsedSince", () => {
  it("pýta sa od času okna na tooly motora", async () => {
    const seen: unknown[] = [];
    const used = await engineUsedSince(new Date("2026-10-22T10:00:00Z"), ["ifc_get"], async (since, tools) => {
      seen.push(since, tools);
      return true;
    });
    expect(used).toBe(true);
    expect(seen).toEqual(["2026-10-22T10:00:00.000Z", ["ifc_get"]]);
  });

  it("chyba DB = false (radšej pomalší prompt než stiahnutie navyše)", async () => {
    expect(await engineUsedSince(new Date(0), ["ifc_get"], async () => { throw new Error("db"); })).toBe(false);
  });
});
