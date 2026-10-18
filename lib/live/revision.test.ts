import { describe, expect, it } from "vitest";

import { parseRevisionNotice, revisionToast } from "./revision";

describe("parseRevisionNotice", () => {
  it("prijme správu z model_publish announce", () => {
    expect(parseRevisionNotice({ model: "ASR", revision: 73, summary: " nová stena ", sentAt: "x" })).toEqual({
      model: "ASR",
      revision: 73,
      summary: "nová stena",
    });
  });

  it("odmietne neplatný model alebo revíziu", () => {
    expect(parseRevisionNotice(null)).toBeNull();
    expect(parseRevisionNotice({ model: "../x", revision: 1 })).toBeNull();
    expect(parseRevisionNotice({ model: "ASR", revision: "73" })).toBeNull();
    expect(parseRevisionNotice({ model: "ASR", revision: -1 })).toBeNull();
    expect(parseRevisionNotice({ model: "ASR", revision: 1.5 })).toBeNull();
  });

  it("prázdne zhrnutie je null", () => {
    expect(parseRevisionNotice({ model: "VZT", revision: 1, summary: "  " })?.summary).toBeNull();
  });
});

describe("revisionToast", () => {
  it("číslo revízie na tri miesta a skrátené zhrnutie", () => {
    expect(revisionToast({ model: "VZT", revision: 1, summary: null })).toBe("Nová revízia VZT v001");
    const long = revisionToast({ model: "ASR", revision: 73, summary: "a".repeat(150) });
    expect(long.startsWith("Nová revízia ASR v073: ")).toBe(true);
    expect(long.endsWith("…")).toBe(true);
  });
});
