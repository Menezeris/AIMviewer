import { describe, expect, it } from "vitest";

import { isSafeViewerUrl, mergeIfcActions, type AskAction } from "./actions";

const nav = (url: string, label = "x"): AskAction => ({ type: "navigate", url, label });

describe("mergeIfcActions (D-056, D-079)", () => {
  it("jedna akcia ostáva bez zmeny", () => {
    const a = [nav("/ifc?focus=A&r=1")];
    expect(mergeIfcActions(a)).toBe(a);
  });

  it("zlúči focus a ops viacerých 3D akcií v poradí, ostatné nechá za nimi", () => {
    const merged = mergeIfcActions(
      [
        nav("/ifc?focus=A,B&r=1"),
        nav("/node/123", "Karta"),
        nav(`/ifc?ops=${encodeURIComponent("colorize:ef4444:A")}&r=2`),
        nav("/ifc?focus=B,C&r=3"),
      ],
      "n",
    );
    expect(merged).toHaveLength(2);
    const params = new URLSearchParams(merged[0].url.slice("/ifc?".length));
    expect(params.get("focus")).toBe("A,B,C");
    expect(params.get("ops")).toBe("colorize:ef4444:A");
    expect(params.get("r")).toBe("n");
    expect(merged[1]).toEqual(nav("/node/123", "Karta"));
  });

  it("výber (D-082) ostáva ako op v pôvodnom poradí, GUID s `$` prežije", () => {
    const merged = mergeIfcActions(
      [
        nav(`/ifc?ops=${encodeURIComponent("colorize:ef4444:A")}&r=1`),
        nav(`/ifc?ops=${encodeURIComponent("select::0MJFXziqDE$gGyPWwro9fq")}&r=2`),
      ],
      "n",
    );
    expect(merged).toHaveLength(1);
    const params = new URLSearchParams(merged[0].url.slice("/ifc?".length));
    expect(params.get("ops")).toBe("colorize:ef4444:A;select::0MJFXziqDE$gGyPWwro9fq");
    expect(params.get("focus")).toBeNull();
  });
});

describe("isSafeViewerUrl", () => {
  it("pustí len interné cesty viewera", () => {
    expect(isSafeViewerUrl("/ifc?focus=A")).toBe(true);
    expect(isSafeViewerUrl("/node/abc")).toBe(true);
    expect(isSafeViewerUrl("/drawing/abc?page=2")).toBe(true);
    expect(isSafeViewerUrl("https://evil.example/ifc")).toBe(false);
    expect(isSafeViewerUrl("//evil.example/ifc")).toBe(false);
    expect(isSafeViewerUrl("/api/ask")).toBe(false);
    expect(isSafeViewerUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeViewerUrl(42)).toBe(false);
  });
});
