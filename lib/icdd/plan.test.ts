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
    { from_id: "o-wall", to_id: "r3", source: "ifc:ASR v79", global_id: "WALL", model: "ASR", document_key: "IfcDocumentReference:page=3" },
    { from_id: "o-space", to_id: "r3", source: "ifc:ASR v79", global_id: "SPACE", model: "ASR", document_key: "IfcDocumentReference:page=3" },
    { from_id: "o-wall", to_id: "d1", source: "ifc:ASR v79", global_id: "WALL", model: "ASR", document_key: "IfcDocumentInformation:D.1.1.09" },
    { id: "rel-1", from_id: "o-wall", to_id: "r3", source: "doc_upload (D-036)", global_id: null },
    { id: "rel-2", from_id: "o-duct", to_id: "d1", source: "pdf_link (E4)", global_id: null },
    { from_id: "o-wall", to_id: "d2", source: "ifc:ASR v79", global_id: "WALL", model: "ASR", document_key: "IfcDocumentInformation:X" },
    { from_id: "o-orphan", to_id: "d1", source: "pdf_link (E4)", global_id: null },
  ],
  spatialLinks: [{ id: "rel-3", from_id: "o-duct", to_id: "o-space", role: "inside", source: "derive:spatial_reference" }],
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
    expect(p.skipped).toMatchObject({ document_without_file: 1, ifc_document_without_file: 1, document_link_in_ifc_file: 4, document_link_element_not_in_ifc: 1 });
  });

  it("väzby: zo súboru IFC len identita dokumentu, AIM vrstva so stranou, IFC vzťahom, pravidlom a revíziami, podlažia", () => {
    const p = buildPlan(rows(), { createdAt: "2026-10-31T10:00:00Z" });
    expect(p.links).toEqual([
      {
        kind: "DocumentIsIdenticalTo",
        from: { payload: "model:ASR", ident: { field: "IfcDocumentReference.Identification", value: "page=3" } },
        to: { payload: "document:d1", page: 3 },
        source: "ifc:ASR v79",
      },
      {
        kind: "DocumentIsIdenticalTo",
        from: { payload: "model:ASR", ident: { field: "IfcDocumentInformation.Identification", value: "D.1.1.09" } },
        to: { payload: "document:d1", page: null },
        source: "ifc:ASR v79",
      },
      {
        kind: "IsElaboratedBy",
        relationshipId: "rel-1",
        from: { payload: "model:ASR", guid: "WALL", objectRef: "ST.01" },
        to: { payload: "document:d1", page: 3 },
        source: "doc_upload (D-036)",
        basedOn: "ASR=79",
        ifcRelationship: "IfcRelAssociatesDocument",
      },
      {
        kind: "IsElaboratedBy",
        relationshipId: "rel-2",
        from: { payload: "model:VZT", guid: "DUCT", objectRef: "VZT.01" },
        to: { payload: "document:d1", page: null },
        source: "pdf_link (E4)",
        basedOn: "VZT=11",
        ifcRelationship: "IfcRelAssociatesDocument",
      },
      {
        kind: "IsReferencedInSpatialStructure",
        relationshipId: "rel-3",
        from: { payload: "model:VZT", guid: "DUCT", objectRef: "VZT.01" },
        to: { payload: "model:ASR", guid: "SPACE", objectRef: "1.01" },
        source: "derive:spatial_reference",
        role: "inside",
        rule: "element_in_space",
        basedOn: "ASR=79;VZT=11",
        ifcRelationship: "IfcRelReferencedInSpatialStructure",
      },
      {
        kind: "IsIdenticalTo",
        from: { payload: "model:VZT", guid: "S-V1", label: "1NP_VZT" },
        to: { payload: "model:ASR", guid: "S-A1", label: "1NP" },
        source: "ifc_storey_map:name_number",
        basedOn: "ASR=79;VZT=11",
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

  it("vrstva bez väzieb sa nevydá (ani v indexe, ani vo versionDescription) a plán to povie", () => {
    // produkcia 1. 11.: všetky väzby AIM prvok-dokument sú ukončené, documents-elements by bol prázdny
    const p = buildPlan(rows({ docLinks: rows().docLinks.filter((l) => l.source?.startsWith("ifc:")) }), { createdAt: "2026-10-31T10:00:00Z" });
    expect(p.layers).toEqual(["documents-identity", "derived-spatial", "federation"]);
    expect(p.versionDescription).not.toMatch(/documents-elements/);
    expect(p.skipped.empty_layer).toBe(1);
    expect(p.warnings.join("\n")).toMatch(/vrstva documents-elements nemá žiadnu väzbu/);
    const all = buildPlan(rows(), { createdAt: "2026-10-31T10:00:00Z" });
    expect(all.layers).toContain("documents-elements");
    expect(all.skipped.empty_layer).toBeUndefined();
  });

  it("basedOnKey je kanonický", () => {
    expect(basedOnKey({ VZT: 11, ASR: 79 })).toBe("ASR=79;VZT=11");
    expect(basedOnKey({})).toBeNull();
  });
});
