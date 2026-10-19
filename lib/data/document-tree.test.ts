import { describe, expect, it } from "vitest";

import { documentFolder, referencePage } from "./document-tree";

describe("referencePage", () => {
  it("číta stranu z fragmentu Location (ASR)", () => {
    expect(referencePage("https://x/documents/VYPIS.pdf#page=3", "page=3")).toBe(3);
  });
  it("bez fragmentu použije Identification", () => {
    expect(referencePage("https://x/documents/VYPIS.pdf", "page=10")).toBe(10);
  });
  it("neplatná alebo chýbajúca strana = null", () => {
    expect(referencePage("https://x/a.pdf#page=0", null)).toBeNull();
    expect(referencePage(null, "S1")).toBeNull();
    expect(referencePage("https://x/a.pdf#zoom=2", "subpage=4")).toBeNull();
  });
});

describe("documentFolder", () => {
  const parentOf = new Map([
    ["plan", "asr"],
    ["asr", "pd"],
    ["cyc-a", "cyc-b"],
    ["cyc-b", "cyc-a"],
  ]);
  const nameOf = new Map([
    ["asr", "D.1.1 ASR"],
    ["pd", "Projektová dokumentácia"],
  ]);

  it("vynechá koreň, keď je pod ním časť", () => {
    expect(documentFolder("plan", parentOf, nameOf)).toEqual(["D.1.1 ASR"]);
  });
  it("priama časť koreňa má koreň ako priečinok", () => {
    expect(documentFolder("asr", parentOf, nameOf)).toEqual(["Projektová dokumentácia"]);
  });
  it("bez rodiča nemá priečinok a cyklus nezacyklí", () => {
    expect(documentFolder("pd", parentOf, nameOf)).toEqual([]);
    expect(documentFolder("cyc-a", parentOf, nameOf)).toEqual(["cyc-b"]);
  });
});
