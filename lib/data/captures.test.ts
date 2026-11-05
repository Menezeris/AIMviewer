/**
 * Tests of `_capture` v1 validation (D-073) - the server is the write boundary, the payload is
 * untrusted input of the route handler. Mirrors the strictness of `isValidGeorefV1` (D-072).
 */
import { describe, expect, it } from "vitest";

import { isValidCaptureV1, parseCapturePlacement } from "./capture-placement";

describe("isValidCaptureV1", () => {
  it("prijme prázdne sémantické ukotvenie {version:1}", () => {
    expect(isValidCaptureV1({ version: 1 })).toBe(true);
  });

  it("prijme validný plan pin (normalizované u,v)", () => {
    expect(
      isValidCaptureV1({
        version: 1,
        plan: { documentId: "d1", page: 1, u: 0.42, v: 0.63 },
      })
    ).toBe(true);
  });

  it("prijme validný world pin + yaw", () => {
    expect(
      isValidCaptureV1({ version: 1, world: { x: 1, y: 2, z: 3 }, yaw: 1.57 })
    ).toBe(true);
  });

  it("odmietne zlú verziu", () => {
    expect(isValidCaptureV1({ version: 2 })).toBe(false);
    expect(isValidCaptureV1({})).toBe(false);
    expect(isValidCaptureV1(null)).toBe(false);
    expect(isValidCaptureV1([{ version: 1 }])).toBe(false);
  });

  it("odmietne u/v mimo [0,1]", () => {
    expect(
      isValidCaptureV1({ version: 1, plan: { documentId: "d", page: 1, u: 1.5, v: 0.5 } })
    ).toBe(false);
    expect(
      isValidCaptureV1({ version: 1, plan: { documentId: "d", page: 1, u: 0.5, v: -0.1 } })
    ).toBe(false);
  });

  it("odmietne neceločíselnú / nulovú stranu a prázdny documentId", () => {
    expect(
      isValidCaptureV1({ version: 1, plan: { documentId: "d", page: 0, u: 0.5, v: 0.5 } })
    ).toBe(false);
    expect(
      isValidCaptureV1({ version: 1, plan: { documentId: "d", page: 1.5, u: 0.5, v: 0.5 } })
    ).toBe(false);
    expect(
      isValidCaptureV1({ version: 1, plan: { documentId: "", page: 1, u: 0.5, v: 0.5 } })
    ).toBe(false);
  });

  it("odmietne nekonečné / nečíselné world súradnice", () => {
    expect(isValidCaptureV1({ version: 1, world: { x: 1, y: 2 } })).toBe(false);
    expect(
      isValidCaptureV1({ version: 1, world: { x: Number.POSITIVE_INFINITY, y: 0, z: 0 } })
    ).toBe(false);
  });

  it("odmietne nečíselný yaw", () => {
    expect(isValidCaptureV1({ version: 1, yaw: "0" })).toBe(false);
  });
});

describe("parseCapturePlacement", () => {
  it("vráti typovaný placement pre validný vstup", () => {
    const p = parseCapturePlacement({ version: 1, world: { x: 1, y: 2, z: 3 } });
    expect(p?.world).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("vráti null pre nevalidný / stale JSON", () => {
    expect(parseCapturePlacement({ version: 99 })).toBeNull();
    expect(parseCapturePlacement("nonsense")).toBeNull();
  });
});
