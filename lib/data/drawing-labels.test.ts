import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/drawing-1np.json";
import {
  labelCodes,
  linkSummary,
  MAX_CANDIDATES,
  pairLabels,
  resolveLabels,
  toLinksWire,
  type LabelObject,
} from "./drawing-labels";
import type { TextBlock } from "@/lib/llm/document-text";

const blocks = fixture.blocks as TextBlock[];
const objects = fixture.objects as LabelObject[];
const b = (t: string, x: number, y: number, w = 0.3, h = 0.4): TextBlock => ({ t, x, y, w, h });
const obj = (ref: string, objectType = "asset", onFloor = true): LabelObject => ({
  id: ref,
  ref,
  guid: `g-${ref}`,
  name: ref,
  ifcType: objectType === "space" ? "IfcSpace" : "IfcDoor",
  objectType,
  onFloor,
});

describe("pairLabels", () => {
  it("spojí hlavu bubliny s riadkom tesne pod ňou", () => {
    const labels = pairLabels([b("DD01", 54.33, 20.78, 0.27), b("07.04", 54.2, 21.07, 0.51, 0.66)]);
    expect(labels).toEqual([
      {
        text: "DD01 07.04",
        code: "DD01.07.04",
        kind: "element",
        bbox: { x: 54.2, y: 20.78, width: 0.51, height: 0.95 },
      },
    ]);
  });

  it("číslo typu bez výskytu je typový kód", () => {
    const [label] = pairLabels([b("DD01", 10, 10), b("08", 10.04, 10.29, 0.19, 0.66)]);
    expect(label).toMatchObject({ code: "DD01.08", kind: "type", text: "DD01 08" });
  });

  it("riadok nad hlavou, ďaleko pod ňou alebo bokom nespáruje", () => {
    expect(pairLabels([b("DD01", 10, 10), b("05.04", 10, 9.5)])).toEqual([]);
    expect(pairLabels([b("DD01", 10, 10), b("05.04", 10, 11.5)])).toEqual([]);
    expect(pairLabels([b("DD01", 10, 10), b("05.04", 12, 10.3)])).toEqual([]);
  });

  it("každý riadok pod hlavou patrí len jednej hlave, vyhrá bližšia dvojica", () => {
    const labels = pairLabels([b("ZV01", 30.77, 43.29), b("01", 30.81, 43.58), b("ZV01", 30.77, 42.6)]);
    expect(labels.map((l) => l.code)).toEqual(["ZV01.01"]);
    expect(labels[0].bbox.y).toBe(43.29);
  });

  it("kód v jednom riadku aj kód miestnosti; legenda s textom nie", () => {
    const labels = pairLabels([b("DD01.05.04", 5, 5), b("1.01", 6, 6), b("DD01.05 - Vnútorné dvere", 7, 7)]);
    expect(labels.map((l) => [l.code, l.kind])).toEqual([
      ["DD01.05.04", "element"],
      ["1.01", "space"],
    ]);
  });
});

describe("resolveLabels", () => {
  it("plný kód = presný object_ref, aj mimo podlažia výkresu", () => {
    const [link] = resolveLabels(pairLabels([b("DD01", 1, 1), b("05.04", 1, 1.3)]), [obj("DD01.05.04", "asset", false)]);
    expect(link).toMatchObject({ status: "unique", via: "ref", targets: [{ ref: "DD01.05.04", guid: "g-DD01.05.04" }] });
  });

  it("typový kód: jediný výskyt na podlaží je jednoznačný, výskyty inde sa nerátajú", () => {
    const labels = pairLabels([b("DD01", 1, 1), b("08", 1, 1.3)]);
    const [link] = resolveLabels(labels, [obj("DD01.08", "asset_type"), obj("DD01.08.0001"), obj("DD01.08.0002", "asset", false)]);
    expect(link).toMatchObject({ status: "unique", via: "type_on_floor", targets: [{ ref: "DD01.08.0001" }] });
  });

  it("typový kód s viac výskytmi na podlaží = kandidáti, zoznam má strop", () => {
    const many = Array.from({ length: MAX_CANDIDATES + 3 }, (_, i) => obj(`SN05.01.${String(i + 1).padStart(4, "0")}`));
    const [link] = resolveLabels(pairLabels([b("SN05", 1, 1), b("01", 1, 1.3)]), many);
    expect(link.status).toBe("candidates");
    expect(link.targets).toHaveLength(MAX_CANDIDATES);
    expect(link.targets_total).toBe(MAX_CANDIDATES + 3);
    expect(link.targets[0].ref).toBe("SN05.01.0001");
  });

  it("nenájdený kód je none; číslo bez miestnosti na podlaží vypadne (kóta)", () => {
    const labels = pairLabels([b("OV01", 1, 1), b("00.00", 1, 1.3), b("1.01", 5, 5), b("2.01", 6, 6)]);
    const links = resolveLabels(labels, [obj("2.01", "space", false)]);
    expect(links.map((l) => [l.code, l.status])).toEqual([["OV01.00.00", "none"]]);
  });

  it("predpona typu nezachytí iný typ s rovnakým začiatkom", () => {
    const [link] = resolveLabels(pairLabels([b("DD01", 1, 1), b("08", 1, 1.3)]), [obj("DD01.080.0001")]);
    expect(link.status).toBe("none");
  });
});

describe("pôdorys 1NP (produkcia, D-130)", () => {
  const links = resolveLabels(pairLabels(blocks), objects);

  it("bublina 08 DD01 otvorí DD01.08.0001", () => {
    const door = links.find((l) => l.code === "DD01.08");
    expect(door).toMatchObject({ status: "unique", targets: [{ ref: "DD01.08.0001", guid: "1_YiIDK5n2fvfP1VGIobML" }] });
  });

  it("súhrn: 42 jednoznačných prvkov, 9 kandidátov, 1 nespárovaný, 46 miestností", () => {
    expect(linkSummary(links)).toEqual({ elements: { unique: 42, candidates: 9, none: 1 }, spaces: 46 });
    expect(links.find((l) => l.status === "none")?.code).toBe("OV01.00.00");
  });

  it("kódy na načítanie z DB", () => {
    const { refs, typePrefixes } = labelCodes(pairLabels(blocks));
    expect(typePrefixes).toEqual(["DD01.08", "FS01.12", "OV01.01", "SN05.01", "SN11.01", "VT01.01", "VT01.02", "ZV01.01", "ZV01.02"]);
    expect(refs).toContain("DD01.05.04");
    expect(refs).toContain("1.01");
  });
});

describe("toLinksWire", () => {
  it("zlomky strany, bez nespárovaných a bez cieľov bez GUID", () => {
    const labels = pairLabels([
      b("DD01", 10, 20, 0.3, 0.4),
      b("08", 10.05, 20.3, 0.2, 0.6),
      b("OV01", 30, 30),
      b("00.00", 30, 30.3),
      b("1.01", 40, 40),
    ]);
    const links = resolveLabels(labels, [obj("DD01.08.0001"), { ...obj("1.01", "space"), guid: null }]);
    expect(toLinksWire("doc", [{ page: 1, links }, { page: 2, links: [] }])).toEqual([
      {
        documentId: "doc",
        page: 1,
        links: [
          {
            x: 0.1,
            y: 0.2,
            w: 0.003,
            h: 0.009,
            label: "DD01 08",
            status: "unique",
            targets: [{ guid: "g-DD01.08.0001", ref: "DD01.08.0001" }],
          },
        ],
      },
    ]);
  });

  it("kandidáti ostanú kandidátmi, meno len keď sa líši od kódu", () => {
    const labels = pairLabels([b("SN05", 1, 1), b("01", 1, 1.3)]);
    const links = resolveLabels(labels, [obj("SN05.01.0001"), { ...obj("SN05.01.0002"), name: "Murivo" }]);
    const [page] = toLinksWire("doc", [{ page: 1, links }]);
    expect(page.links[0].status).toBe("candidates");
    expect(page.links[0].targets).toEqual([
      { guid: "g-SN05.01.0001", ref: "SN05.01.0001" },
      { guid: "g-SN05.01.0002", ref: "SN05.01.0002", name: "Murivo" },
    ]);
  });
});
