import { describe, expect, it } from "vitest";

import { pairLabels, resolveZoneLabels, toLinksWire, type ZoneObject } from "./drawing-labels";
import type { TextBlock } from "@/lib/llm/document-text";

const b = (t: string, x: number, y: number, w = 4, h = 0.5): TextBlock => ({ t, x, y, w, h });
const zone = (ref: string, name: string, members: string[] = []): ZoneObject => ({
  id: ref,
  ref,
  guid: `g-${ref}`,
  name,
  ifcType: "IfcZone",
  members,
});

describe("resolveZoneLabels (D-160)", () => {
  it("text rovný menu zóny je odkaz na zónu, bez ohľadu na diakritiku, veľkosť písmen a medzery", () => {
    const links = resolveZoneLabels([b("  Požiarny  úsek N1.01 ", 10, 10)], [zone("PU1", "POŽIARNY ÚSEK N1.01", ["g-s1"])]);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ kind: "zone", status: "unique", via: "zone_name" });
    expect(links[0].targets[0]).toMatchObject({ ref: "PU1", guid: "g-PU1", members: ["g-s1"] });
  });

  it("zóny s rovnakým menom sú kandidáti, nepodobný text nič", () => {
    const zones = [zone("PU1", "PU N1.01"), zone("PU2", "PU N1.01")];
    const [l] = resolveZoneLabels([b("PU N1.01", 1, 1)], zones);
    expect(l.status).toBe("candidates");
    expect(l.targets.map((t) => t.ref)).toEqual(["PU1", "PU2"]);
    expect(resolveZoneLabels([b("PU N1.02", 1, 1)], zones)).toEqual([]);
  });

  it("riadok, ktorý je už popiskom (bublina), zónou nie je", () => {
    const blocks = [b("DD01", 10, 10, 0.3), b("07.04", 10, 10.3, 0.5)];
    const taken = pairLabels(blocks);
    expect(resolveZoneLabels(blocks, [zone("Z", "07.04")], taken)).toEqual([]);
  });

  it("do viewera ide zóna s GUID a členmi", () => {
    const links = resolveZoneLabels([b("PU N1.01", 10, 20)], [zone("PU1", "PU N1.01", ["g-s1", "g-s2"])]);
    const [wire] = toLinksWire("doc", [{ page: 1, links }]);
    expect(wire.links[0].targets[0]).toMatchObject({ guid: "g-PU1", members: ["g-s1", "g-s2"] });
  });

  it("ručný odkaz má vo wire príznak manual, odvodený nie", () => {
    const [auto] = resolveZoneLabels([b("PU N1.01", 10, 20)], [zone("PU1", "PU N1.01")]);
    const wire = toLinksWire("doc", [{ page: 1, links: [auto, { ...auto, via: "manual" }] }])[0].links;
    expect(wire[0].manual).toBeUndefined();
    expect(wire[1].manual).toBe(true);
  });
});
