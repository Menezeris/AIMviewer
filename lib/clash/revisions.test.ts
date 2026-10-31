import { describe, expect, it } from "vitest";

import { currentRevisions, describeDrift, revisionFields, staleOf, stampOf } from "./revisions";

describe("podpis vstupu behu clash (D-183 bod 11)", () => {
  it("stampOf: uložený podpis má prednosť, inak revízia z models motora; prázdny = null", () => {
    expect(stampOf({ ASR: { etag: "a", size: 1, revision: 78 } }, { ASR: 79 })).toEqual({ ASR: 79 });
    expect(stampOf({ ASR: { etag: "a", size: 1, revision: 78 }, VZT: { etag: "b", size: 2 } }, {})).toEqual({ ASR: 78 });
    expect(stampOf({ ASR: 78 }, null)).toEqual({ ASR: 78 });
    expect(stampOf({ ASR: { etag: "a", size: 1 } }, undefined)).toBeNull();
    expect(stampOf(null, { ASR: "v78" })).toBeNull();
  });

  it("staleOf: neznámy podpis alebo stav = null, inak porovnanie po modeloch", () => {
    expect(staleOf(null, { ASR: 79 })).toBeNull();
    expect(staleOf({ ASR: 79 }, null)).toBeNull();
    expect(staleOf({ ASR: 79, VZT: 11 }, { ASR: 79, VZT: 11 })).toBe(false);
    expect(staleOf({ ASR: 78, VZT: 11 }, { ASR: 79, VZT: 11 })).toBe(true);
    expect(staleOf({ ASR: 79 }, {})).toBe(true);
  });

  it("describeDrift a revisionFields", () => {
    expect(describeDrift({ ASR: 78, VZT: 9 }, { ASR: 79, VZT: 9 })).toBe("ASR v078 -> v079");
    expect(describeDrift({ X: 1 }, {})).toBe("X v001 -> bez aktuálnej revízie");
    expect(revisionFields(null, { ASR: 1 })).toEqual({});
    expect(revisionFields({ ASR: 79 }, null)).toEqual({ based_on: { ASR: 79 } });
    expect(revisionFields({ ASR: 79 }, { ASR: 79 })).toEqual({ based_on: { ASR: 79 }, stale: false });
    expect(revisionFields({ ASR: 78 }, { ASR: 79 })).toMatchObject({ stale: true, stale_note: expect.stringMatching(/ASR v078 -> v079/) });
  });

  it("currentRevisions: berie len is_current, chyba zdroja = null", async () => {
    const row = (model: string, revision: number, is_current: boolean) =>
      ({ model, revision, is_current, parent_revision: null, sha256: "", size_bytes: 0, recipe_ref: null, summary: null, author: null, guard: null, created_at: "" });
    expect(await currentRevisions(["ASR"], async () => [row("ASR", 80, false), row("ASR", 79, true)])).toEqual({ ASR: 79 });
    expect(await currentRevisions(["ASR"], async () => { throw new Error("db"); })).toBeNull();
    expect(await currentRevisions(["ASR"], undefined)).toBeNull();
    expect(await currentRevisions([], async () => [])).toBeNull();
  });
});
