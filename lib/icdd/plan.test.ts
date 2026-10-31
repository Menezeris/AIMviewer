import { describe, expect, it } from "vitest";

import { basedOnKey, buildPlan, type PlanRows } from "./plan";

const rows = (over: Partial<PlanRows> = {}): PlanRows => ({
  storageBase: "https://x.supabase.co",
  modelRevisions: [
    { model: "VZT", revision: 11, sha256: "b".repeat(64), size_bytes: 10, archive_path: "ifc/archive/VZT/v011.ifc.gz" },
    { model: "ASR", revision: 79, sha256: "a".repeat(64), size_bytes: 20, archive_path: "ifc/archive/ASR/v079.ifc.gz" },
  ],
  copyRevisions: [
    { model: "ASR", revision: 79 },
    { model: "VZT", revision: 11 },
  ],
  containerRevisions: [{ model: "ASR", document_id: null, name: "ASR", revision: "79", revision_no: 79, status: "DRAFT", approval: null }],
  documents: [
    { id: "d1", object_type: "document", object_ref: "D-1-1-09", name: "D.1.1.09 Skladby", identification: "D.1.1.09", description: null, location: "https://x.supabase.co/storage/v1/object/public/documents/D-1-1-09.pdf", revision: null, electronic_format: "application/pdf", file_sha256: "c".repeat(64), referenced_document_id: null },
    { id: "d2", object_type: "document", object_ref: "X", name: "Bez súboru", identification: "X", description: null, location: null, revision: null, electronic_format: null, file_sha256: null, referenced_document_id: null },
    { id: "r3", object_type: "document_reference", object_ref: null, name: "S1 (strana 3)", identification: "page=3", description: null, location: "https://x/documents/D-1-1-09.pdf#page=3", revision: null, electronic_format: null, file_sha256: null, referenced_document_id: "d1" },
  ],
  objects: [
    { id: "o-wall", ifc_guid: "WALL", object_ref: "ST.01" },
    { id: "o-duct", ifc_guid: "DUCT", object_ref: "VZT.01" },
    { id: "o-space", ifc_guid: "SPACE", object_ref: "1.01" },
    { id: "o-orphan", ifc_guid: "NOPE", object_ref: null },
  ],
  guidModel: new Map([
    ["WALL", "ASR"],
    ["SPACE", "ASR"],
    ["DUCT", "VZT"],
    ["S-A1", "ASR"],
    ["S-V1", "VZT"],
  ]),
  docLinks: [
    { from_id: "o-wall", to_id: "r3", source: "ifc:ASR v79", global_id: "WALL" },
    { from_id: "o-duct", to_id: "d1", source: "pdf_link (E4)", global_id: null },
    { from_id: "o-wall", to_id: "d2", source: "ifc:ASR v79", global_id: "WALL" },
    { from_id: "o-orphan", to_id: "d1", source: "pdf_link (E4)", global_id: null },
  ],
  spatialLinks: [{ from_id: "o-duct", to_id: "o-space", role: "inside", source: "derive:spatial_reference" }],
  storeyMap: [
    { model: "ASR", global_id: "S-A1", name: "1NP", to_id: "f1", match_rule: "guid" },
    { model: "VZT", global_id: "S-V1", name: "1NP_VZT", to_id: "f1", match_rule: "name_number" },
    { model: "VZT", global_id: "S-V9", name: "Strojovňa", to_id: null, match_rule: null },
  ],
  rules: [{ id: "element_in_space", source: "derive:spatial_reference", models: { VZT: 11, ASR: 79 } }],
  ...over,
});

describe("buildPlan (D-181)", () => {
  it("payloady: archív revízie rozbalený, PDF s sha256, dokument bez súboru preskočený", () => {
    const p = buildPlan(rows(), { createdAt: "2026-10-31T10:00:00Z" });
    expect(p.payloads.map((x) => x.filename)).toEqual(["ASR_v079.ifc", "VZT_v011.ifc", "D-1-1-09.pdf"]);
    expect(p.payloads[0]).toMatchObject({ url: "https://x.supabase.co/storage/v1/object/public/ifc/archive/ASR/v079.ifc.gz", gzip: true, status: "DRAFT", versionID: "79" });
    expect(p.versionID).toBe("2026-10-31_ASR-v079_VZT-v011_D1");
    expect(p.skipped).toMatchObject({ document_without_file: 1, document_link_document_without_file: 1, document_link_element_not_in_ifc: 1 });
  });

  it("väzby: strana z časti dokumentu, model prvku z kópie revízie, odvodenie s pravidlom a revíziami, podlažia", () => {
    const p = buildPlan(rows(), { createdAt: "2026-10-31T10:00:00Z" });
    expect(p.links).toEqual([
      { kind: "IsElaboratedBy", from: { payload: "model:ASR", guid: "WALL", objectRef: "ST.01" }, to: { payload: "document:d1", page: 3 }, source: "ifc:ASR v79" },
      { kind: "IsElaboratedBy", from: { payload: "model:VZT", guid: "DUCT", objectRef: "VZT.01" }, to: { payload: "document:d1", page: null }, source: "pdf_link (E4)" },
      {
        kind: "IsReferencedInSpatialStructure",
        from: { payload: "model:VZT", guid: "DUCT", objectRef: "VZT.01" },
        to: { payload: "model:ASR", guid: "SPACE", objectRef: "1.01" },
        source: "derive:spatial_reference",
        role: "inside",
        rule: "element_in_space",
        basedOn: "ASR=79;VZT=11",
      },
      {
        kind: "IsIdenticalTo",
        from: { payload: "model:VZT", guid: "S-V1", label: "1NP_VZT" },
        to: { payload: "model:ASR", guid: "S-A1", label: "1NP" },
        source: "ifc_storey_map:name_number",
      },
    ]);
    expect(p.warnings).toEqual([]);
  });

  it("varuje pri zastaraných odvodeniach a starej kópii revízie", () => {
    const p = buildPlan(
      rows({ rules: [{ id: "element_in_space", source: "derive:spatial_reference", models: { ASR: 78, VZT: 11 } }], copyRevisions: [{ model: "ASR", revision: 78 }] }),
      { createdAt: "2026-10-31T10:00:00Z" },
    );
    expect(p.warnings.join("\n")).toMatch(/zastarané/);
    expect(p.warnings.join("\n")).toMatch(/kópia revízie v DB je v78/);
    expect(p.links.find((l) => l.kind === "IsReferencedInSpatialStructure")?.basedOn).toBe("ASR=78;VZT=11");
  });

  it("vrstvy sa dajú zúžiť", () => {
    const p = buildPlan(rows(), { createdAt: "2026-10-31T10:00:00Z", layers: ["federation"] });
    expect(p.layers).toEqual(["federation"]);
    expect(p.links.map((l) => l.kind)).toEqual(["IsIdenticalTo"]);
  });

  it("basedOnKey je kanonický", () => {
    expect(basedOnKey({ VZT: 11, ASR: 79 })).toBe("ASR=79;VZT=11");
    expect(basedOnKey({})).toBeNull();
  });
});
