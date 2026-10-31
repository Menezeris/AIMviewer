/**
 * Skórovanie zlatých otázok a platnosť eval/questions.json (beh evalov 2026-10-31, OCB evals.yml).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { score, suspiciousNumber, validateQuestions } from "./eval-score";

vi.mock("server-only", () => ({}));

describe("no_facts: viacciferné číslo", () => {
  it("citovaný kód prvku nie je konfabulované číslo (rel-actor, neg-nonexistent-ref)", () => {
    expect(suspiciousNumber("Prvok DD01.06.03 nemá priradenú zodpovednú osobu.")).toBeNull();
    expect(suspiciousNumber("Prvok ZZZ99.99.99 som v modeli nenašiel.", "Čo je prvok ZZZ99.99.99?")).toBeNull();
    expect(suspiciousNumber("Na 1NP ani 2NP nie je žiadny ventil (IfcValve), typ PO.02.02 nie.")).toBeNull();
  });

  it("samostatný počet alebo hodnota ostáva podozrivá", () => {
    expect(suspiciousNumber("V budove je 12 uzatváracích ventilov.")).toBe("12");
    expect(suspiciousNumber("Siemens dodal 11.43 m3/s.")).toBe("11");
  });

  it("číslo z otázky sa neráta", () => {
    expect(suspiciousNumber("Miestnosť 205 som nenašiel.", "Čo je v miestnosti 205?")).toBeNull();
  });

  it("score: negatívna odpoveď s kódom prvku prejde", () => {
    const res = { answer: "Pre prvok DD01.06.03 nie je evidovaná žiadna zodpovednosť.", trace: [{ name: "get_object", ok: true }] };
    expect(score({ no_facts: true }, res, "Kto je zodpovedný za prvok DD01.06.03?")).toEqual([]);
  });
});

describe("eval/questions.json", () => {
  const { questions } = JSON.parse(readFileSync(join(process.cwd(), "eval/questions.json"), "utf8")) as {
    questions: unknown[];
  };

  it("každý záznam má id, otázku a tooly, ktoré /api/ask pozná (inak mcp_only)", async () => {
    vi.doMock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({}) }));
    const { TOOL_DEFINITIONS } = await import("@/lib/llm/tools");
    const askTools = new Set(TOOL_DEFINITIONS.map((t) => t.name));
    expect(validateQuestions(questions, askTools)).toEqual([]);
  });

  it("validácia nájde záznam bez otázky (runner: posledná správa musí byť od používateľa)", () => {
    expect(validateQuestions([{ notes: "x" }])).toEqual([
      "#0: chýba id",
      "#0: chýba question",
      "#0: chýba category",
      "#0: chýba expect",
      "#0: chýba verified",
    ]);
  });
});
