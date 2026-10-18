import { describe, expect, it } from "vitest";

import { isLiveQuery, isLiveReply } from "./protocol";

describe("protokol spätného kanála (D-085)", () => {
  it("otázka: známy typ, krátke id, nanajvýš 100 GUIDov", () => {
    expect(isLiveQuery({ id: "a", query: "bounds", guids: ["G"] })).toBe(true);
    expect(isLiveQuery({ id: "a", query: "view_state" })).toBe(true);
    expect(isLiveQuery({ id: "a", query: "screenshot" })).toBe(false);
    expect(isLiveQuery({ id: "x".repeat(65), query: "bounds" })).toBe(false);
    expect(isLiveQuery({ id: "a", query: "bounds", guids: Array(101).fill("G") })).toBe(false);
    expect(isLiveQuery({ id: "a", query: "bounds", guids: [1] })).toBe(false);
    expect(isLiveQuery(null)).toBe(false);
  });

  it("odpoveď: ok s výsledkom alebo chyba s textom", () => {
    expect(isLiveReply({ id: "a", ok: true, result: {} })).toBe(true);
    expect(isLiveReply({ id: "a", ok: false, error: "x" })).toBe(true);
    expect(isLiveReply({ id: "a", ok: false })).toBe(false);
    expect(isLiveReply({ ok: true })).toBe(false);
  });
});
