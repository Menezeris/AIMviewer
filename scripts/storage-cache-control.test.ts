import { describe, expect, it } from "vitest";

import { cacheSecondsFor, maxAgeOf, parseArgs, sha256 } from "./storage-cache-control";

describe("storage-cache-control", () => {
  it("politika: nemenný archív rok, aktuálny kľúč minúta, PDF hodina", () => {
    expect(cacheSecondsFor("ifc", "archive/ASR/v078.ifc.gz")).toBe(31536000);
    expect(cacheSecondsFor("ifc", "archive/VZT/v009.ifc.gz")).toBe(31536000);
    expect(cacheSecondsFor("ifc", "ASR.ifc")).toBe(60);
    expect(cacheSecondsFor("documents", "OCB_SO01_ASR_D-1-1-09.pdf")).toBe(3600);
  });

  it("neznáme kľúče a buckety sa nedotýka", () => {
    expect(cacheSecondsFor("ifc", "archive/ASR/v078.ifc")).toBeNull();
    expect(cacheSecondsFor("ifc", "tmp/x.bin")).toBeNull();
    expect(cacheSecondsFor("captures", "a/b.jpg")).toBeNull();
  });

  it("maxAgeOf rozozná max-age aj no-cache", () => {
    expect(maxAgeOf("private, no-cache")).toBeNull();
    expect(maxAgeOf("max-age=31536000, immutable")).toBe(31536000);
    expect(maxAgeOf(null)).toBeNull();
  });

  it("predvolene dry-run, --apply je explicitný", () => {
    expect(parseArgs([]).apply).toBe(false);
    expect(parseArgs(["--apply"]).apply).toBe(true);
    expect(parseArgs(["--key", "ifc/archive/ASR/v078.ifc.gz"]).keys).toEqual([{ bucket: "ifc", key: "archive/ASR/v078.ifc.gz" }]);
    expect(() => parseArgs(["--nieco"])).toThrow();
  });

  it("sha256", () => {
    expect(sha256(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
