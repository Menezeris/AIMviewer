import { describe, expect, it } from "vitest";

import { nodeSummaryToAimPanel, type ElementDetail } from "./aim-panel";

const baseSummary: ElementDetail = {
  id: "o1",
  objectType: "asset",
  route: "node",
  name: "VZT jednotka",
  objectRef: "VZT-001",
  ifcType: "IfcUnitaryEquipment",
  predefinedType: null,
  userDefinedType: null,
  type: null,
  documents: [
    { id: "d1", name: "Manuál", objectRef: null, role: "manual", isDrawing: false },
  ],
  counts: { classifications: 2, occurrences: 0 },
};

describe("nodeSummaryToAimPanel (v2, D-077)", () => {
  it("mapuje v2 sekcie: zodpovednosti, capture súhrn, históriu GUID", () => {
    const detail: ElementDetail = {
      ...baseSummary,
      responsibilities: [
        {
          actorId: "p1",
          actorType: "person",
          actorName: "Ján Kováč",
          actorRef: null,
          role: "maintainer",
          validFrom: null,
          validUntil: null,
          org: { id: "org1", name: "Servis s.r.o." },
        },
      ],
      guidHistory: [
        {
          id: "h1",
          ifcGuid: "GUID-A",
          validFrom: "2026-07-12T09:31:00Z",
          validUntil: null,
          source: "etl",
          active: true,
        },
      ],
      captures: { spaceId: "s1", spaceName: "Miestnosť 201", count: 3 },
    };

    const panel = nodeSummaryToAimPanel(detail, "GUID-A");

    expect(panel.version).toBe(2);
    expect(panel.responsibilities).toEqual([
      { name: "Ján Kováč", role: "maintainer", org: "Servis s.r.o.", href: "/node/p1" },
    ]);
    expect(panel.captures).toEqual({ count: 3, href: "/ifc?captures=s1" });
    expect(panel.history).toEqual([
      { guid: "GUID-A", validFrom: "2026-07-12", validUntil: undefined, active: true },
    ]);
    // Akcia Reality Capture ostáva (parita s D-073).
    expect(panel.actions?.some((a) => a.label === "Reality Capture (3)")).toBe(true);
  });

  it("bez obohatenia vracia panel bez v2 sekcií (spätná kompatibilita)", () => {
    const panel = nodeSummaryToAimPanel(baseSummary, "GUID-A");
    expect(panel.version).toBe(2);
    expect(panel.responsibilities).toBeUndefined();
    expect(panel.captures).toBeUndefined();
    expect(panel.history).toBeUndefined();
    expect(panel.title).toBe("VZT jednotka");
    expect(panel.documents).toHaveLength(1);
    expect(panel.actions?.[0]).toEqual({
      label: "Otvoriť celý detail",
      href: "/node/o1",
      primary: true,
    });
  });

  it("explicitný captures parameter má prednosť pred detail.captures", () => {
    const panel = nodeSummaryToAimPanel(
      { ...baseSummary, captures: { spaceId: "sX", spaceName: null, count: 1 } },
      "GUID-A",
      { spaceId: "s1", spaceName: null, count: 5 }
    );
    expect(panel.captures).toEqual({ count: 5, href: "/ifc?captures=s1" });
  });
});

describe("nodeSummaryToAimPanel - vrstva AIM (D-089)", () => {
  it("odznak typu podľa object_type: priestorová zóna nie je Prvok", () => {
    const zone = nodeSummaryToAimPanel({ ...baseSummary, objectType: "spatial_zone" }, "G");
    expect(zone.badges?.[0].label).toBe("Priestorová zóna");
    expect(nodeSummaryToAimPanel(baseSummary, "G").badges?.[0].label).toBe("Asset");
    expect(nodeSummaryToAimPanel({ ...baseSummary, objectType: "neznamy" as ElementDetail["objectType"] }, "G").badges?.[0].label).toBe("Prvok");
  });

  it("odovzdá odvodené vzťahy a celkový počet, bez nich polia vynechá", () => {
    const relation = {
      ruleId: "element_in_spatial_zone",
      ruleName: "Prvok v priestorovej zóne (geometria)",
      ifcRelation: "IfcRelReferencedInSpatialStructure" as const,
      direction: "outgoing" as const,
      role: "partial",
      other: { objectId: "z1", guid: "ZG", ref: "N2.04", name: "N2.04", ifcType: "IfcSpatialZone" },
    };
    const panel = nodeSummaryToAimPanel(
      { ...baseSummary, derived: { relations: [relation], total: 3 } },
      "G"
    );
    expect(panel.derivedRelations).toEqual([relation]);
    expect(panel.derivedTotal).toBe(3);

    const empty = nodeSummaryToAimPanel({ ...baseSummary, derived: { relations: [], total: 0 } }, "G");
    expect(empty.derivedRelations).toBeUndefined();
    expect(empty.derivedTotal).toBeUndefined();
  });
});

describe("nodeSummaryToAimPanel - dokumenty cez vzťahy (D-104)", () => {
  it("efektívne dokumenty majú documentId, stranu, cestu a druh; bez nich priame väzby", () => {
    const panel = nodeSummaryToAimPanel(
      {
        ...baseSummary,
        effectiveDocuments: [
          { documentId: "d3", name: "D.1.1.03 Pôdorys 3NP", identification: "OCB_ASR_3NP", via: "space", viaName: "3.01", typeCode: "DR" },
          {
            documentId: "d9", name: "D.1.1.09 Výpis skladieb", identification: "OCB_ASR_09", page: 3,
            via: "group", viaName: "S1", through: "S1.01", typeCode: "SH",
          },
          { documentId: "d5", name: null, identification: "OCB_PBR_04", via: "direct" },
        ],
      },
      "GUID",
    );
    expect(panel.documents).toEqual([
      { name: "D.1.1.03 Pôdorys 3NP", href: "/drawing/d3", badge: "DR", documentId: "d3", via: "cez miestnosť 3.01", aim: true },
      {
        name: "D.1.1.09 Výpis skladieb", href: "/drawing/d9?page=3", badge: "SH", documentId: "d9", page: 3,
        via: "cez skupinu S1 (S1.01)", aim: true,
      },
      { name: "OCB_PBR_04", href: "/drawing/d5", badge: undefined, documentId: "d5", via: "priamo" },
    ]);
    expect(nodeSummaryToAimPanel(baseSummary, "GUID").documents).toEqual([
      { name: "Manuál", href: "/drawing/d1", badge: undefined },
    ]);
  });
});

describe("nodeSummaryToAimPanel - AIM vrstva v IFC paneli (D-129)", () => {
  it("dokument cez typ nie je AIM, cez zónu áno; posledná zmena receptom prejde do panela", () => {
    const panel = nodeSummaryToAimPanel(
      {
        ...baseSummary,
        effectiveDocuments: [
          { documentId: "t1", name: "Typový list", identification: null, via: "type", viaName: "D1" },
          { documentId: "z1", name: "Požiarna správa", identification: null, via: "zone", viaName: "N1.01" },
        ],
        lastChange: { model: "ASR", revision: "v076", title: "Doplniť FireRating", date: "2026-10-20" },
      },
      "GUID",
    );
    expect(panel.documents?.map((d) => d.aim ?? false)).toEqual([false, true]);
    expect(panel.lastChange).toEqual({ model: "ASR", revision: "v076", title: "Doplniť FireRating", date: "2026-10-20" });
    expect(nodeSummaryToAimPanel(baseSummary, "GUID").lastChange).toBeUndefined();
  });

  it("médiá Reality Capture prejdú do panela len keď sú (D-131)", () => {
    const captureMedia = [
      { id: "m1", name: "Vstup", kind: "FOTO", kindLabel: "Fotografia", href: "/ifc?captures=s1", via: "v miestnosti 3.12" },
    ];
    expect(nodeSummaryToAimPanel({ ...baseSummary, captureMedia }, "GUID").captureMedia).toEqual(captureMedia);
    expect(nodeSummaryToAimPanel({ ...baseSummary, captureMedia: [] }, "GUID")).not.toHaveProperty("captureMedia");
  });
});
