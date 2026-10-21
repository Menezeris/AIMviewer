import { describe, expect, it } from "vitest";

import type { CapturePointWire } from "./capture-placement";
import {
  CAPTURE_MEDIA_MAX,
  captureMediaEntries,
  captureMediaKind,
  MEDIA_KIND_SYSTEM,
  splitDocumentClassifications,
} from "./media-kind";

function media(id: string, capturedAt: string | null, isCurrent = false) {
  return {
    id,
    location: `https://x/${id}_orig`,
    previewLocation: null,
    thumbLocation: `https://x/${id}_thumb`,
    mediaType: "image/jpeg",
    width: 100,
    height: 100,
    capturedAt,
    isCurrent,
  };
}

function point(id: string, kind: CapturePointWire["kind"], name: string | null, items: CapturePointWire["media"]): CapturePointWire {
  return { id, name, kind, spaceId: "s1", placement: null, media: items };
}

describe("druh média (D-131)", () => {
  it("odvodí druh z bodu: photo -> FOTO, pano360 -> PANO360", () => {
    expect(captureMediaKind("photo")).toEqual({ code: "FOTO", name: "Fotografia" });
    expect(captureMediaKind("pano360")).toEqual({ code: "PANO360", name: "360° panoráma" });
  });

  it("druh média neprepíše typ informácie, nech príde v akomkoľvek poradí", () => {
    const out = splitDocumentClassifications([
      { documentId: "d1", code: "FOTO", name: "Fotografia", system: MEDIA_KIND_SYSTEM },
      { documentId: "d1", code: "DR", name: "Výkres", system: "ISO 19650 typ informácie" },
      { documentId: "d1", code: "CA", name: "Výpočet", system: "ISO 19650 typ informácie" },
      { documentId: "d2", code: "PANO360", name: null, system: MEDIA_KIND_SYSTEM },
    ]);
    expect(out.get("d1")).toEqual({ type: { code: "DR", name: "Výkres" }, mediaKind: { code: "FOTO", name: "Fotografia" } });
    expect(out.get("d2")).toEqual({ mediaKind: { code: "PANO360", name: null } });
  });

  it("systém bez mena ostáva typ (doterajšie správanie)", () => {
    const out = splitDocumentClassifications([{ documentId: "d1", code: "DR", name: null, system: null }]);
    expect(out.get("d1")).toEqual({ type: { code: "DR", name: null } });
  });
});

describe("captureMediaEntries (D-131)", () => {
  const space = { id: "s1", name: "3.12 Kancelária" };

  it("médiá priestoru najnovšie prvé, s druhom, galériou a cestou", () => {
    const out = captureMediaEntries(
      [
        point("p1", "photo", "Vstup", [media("m1", "2026-10-01T09:00:00Z", true), media("m0", "2026-09-01T09:00:00Z")]),
        point("p2", "pano360", null, [media("m2", "2026-10-10T09:00:00Z", true)]),
      ],
      space,
      false,
    );
    expect(out.map((m) => [m.id, m.name, m.kind, m.kindLabel, m.capturedAt])).toEqual([
      ["m2", "360° panoráma", "PANO360", "360° panoráma", "2026-10-10"],
      ["m1", "Vstup", "FOTO", "Fotografia", "2026-10-01"],
      ["m0", "Vstup (2026-09-01)", "FOTO", "Fotografia", "2026-09-01"],
    ]);
    expect(out[0]).toMatchObject({ href: "/ifc?captures=s1", thumbUrl: "https://x/m2_thumb", via: "v miestnosti 3.12 Kancelária" });
  });

  it("prvok v priestore dedí médiá cez miestnosť", () => {
    const [entry] = captureMediaEntries([point("p1", "photo", "Vstup", [media("m1", null, true)])], space, true);
    expect(entry.via).toBe("cez miestnosť 3.12 Kancelária");
    expect(entry).not.toHaveProperty("capturedAt");
  });

  it("strop počtu médií", () => {
    const many = Array.from({ length: CAPTURE_MEDIA_MAX + 5 }, (_, i) => media(`m${i}`, null));
    expect(captureMediaEntries([point("p1", "photo", "Vstup", many)], space, false)).toHaveLength(CAPTURE_MEDIA_MAX);
  });
});
