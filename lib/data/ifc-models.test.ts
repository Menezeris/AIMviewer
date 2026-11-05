/**
 * Revision in the model URL (D-086): a revision archive (D-135) or `?rev=N` changes the `src`
 * of the viewer iframe, so a new revision is loaded again and the browser cache does not return
 * the old file.
 */
import { describe, expect, it } from "vitest";

import { archiveEnabled, archiveUrl, envIfcModels, modelKey, modelsFromRows } from "./ifc-models";

const BASE = "https://x.supabase.co/storage/v1/object/public/ifc";

describe("modelKey", () => {
  it("meno súboru bez .ifc, bez query", () => {
    expect(modelKey(`${BASE}/ASR.ifc`)).toBe("ASR");
    expect(modelKey(`${BASE}/VZT.ifc?rev=3`)).toBe("VZT");
    expect(modelKey("https://example.com/model.ifczip")).toBeNull();
  });

  it("archív revízie (D-135) = meno adresára modelu", () => {
    expect(modelKey(`${BASE}/archive/ASR/v078.ifc.gz`)).toBe("ASR");
    expect(modelKey(`${BASE}/archive/VZT/v004.ifc.gz?x=1`)).toBe("VZT");
    expect(modelKey(`${BASE}/archive/ASR/notes.gz`)).toBeNull();
  });
});

describe("archiveUrl", () => {
  it("kľúč archívu z D-086 v adresári pôvodného súboru, bez query", () => {
    expect(archiveUrl(`${BASE}/ASR.ifc?rev=77`, 78)).toBe(`${BASE}/archive/ASR/v078.ifc.gz`);
    expect(archiveUrl("https://cdn.example.com/m/VZT.ifc", 1234)).toBe("https://cdn.example.com/m/archive/VZT/v1234.ifc.gz");
  });

  it("nie IFC ani už archív = null", () => {
    expect(archiveUrl("https://example.com/model.ifczip", 1)).toBeNull();
    expect(archiveUrl(`${BASE}/archive/ASR/v078.ifc.gz`, 79)).toBeNull();
  });
});

describe("archiveEnabled", () => {
  it("predvolene vypnutý (fork bez gzip), zapne ho len NEXT_PUBLIC_IFC_ARCHIVE=1", () => {
    expect(archiveEnabled({})).toBe(false);
    expect(archiveEnabled({ NEXT_PUBLIC_IFC_ARCHIVE: "0" })).toBe(false);
    expect(archiveEnabled({ NEXT_PUBLIC_IFC_ARCHIVE: "true" })).toBe(false);
    expect(archiveEnabled({ NEXT_PUBLIC_IFC_ARCHIVE: "1" })).toBe(true);
  });
});

describe("modelsFromRows (D-189: models from the DB per project)", () => {
  const rows = [
    { container_id: "c-vzt", model: "VZT", revision: 11, location: "ifc/archive/VZT/v011.ifc.gz" },
    { container_id: "c-asr", model: "ASR", revision: 79, location: "ifc/archive/ASR/v079.ifc.gz" },
  ];
  const base = "https://s.example/storage/v1/object/public";

  it("one model per container, sorted by code, label = code, identity = container", () => {
    const out = modelsFromRows(rows, { archive: true, base });
    expect(out.map((m) => [m.id, m.label, m.containerId, m.revision])).toEqual([
      ["ASR", "ASR", "c-asr", 79],
      ["VZT", "VZT", "c-vzt", 11],
    ]);
  });

  it("with the archive the URL is the revision's location", () => {
    const [asr] = modelsFromRows(rows, { archive: true, base });
    expect(asr.url).toBe(`${base}/ifc/archive/ASR/v079.ifc.gz`);
    // a revision without a stored location gets the D-086 archive key next to the current file
    const [x] = modelsFromRows([{ container_id: "c", model: "X1", revision: 2, location: null }], { archive: true, base });
    expect(x.url).toBe(`${base}/ifc/archive/X1/v002.ifc.gz`);
  });

  it("without the archive `?rev=N` on the current key (new revision = new URL)", () => {
    const [asr] = modelsFromRows(rows, { archive: false, base });
    expect(asr.url).toBe(`${base}/ifc/ASR.ifc?rev=79`);
  });

  it("D-190: a new project's archive is named by the container uuid, the code stays the label", () => {
    const uuidRow = { container_id: "c-1", model: "ARCH", revision: 3, location: "ifc/archive/c-1/v003.ifc.gz" };
    const [a] = modelsFromRows([uuidRow], { archive: true, base });
    expect([a.id, a.url]).toEqual(["ARCH", `${base}/ifc/archive/c-1/v003.ifc.gz`]);
    const [b] = modelsFromRows([uuidRow], { archive: false, base });
    expect(b.url).toBe(`${base}/ifc/c-1.ifc?rev=3`);
  });

  it("a project without models has none (no code is assumed)", () => {
    expect(modelsFromRows([], { archive: true, base })).toEqual([]);
  });
});

describe("envIfcModels", () => {
  it("only the env override; without it null (models come from the DB)", () => {
    expect(envIfcModels({})).toBeNull();
    expect(envIfcModels({ NEXT_PUBLIC_IFC_URLS: "Test|http://localhost:9/a.ifc" })).toEqual([
      { id: "m0", label: "Test", url: "http://localhost:9/a.ifc" },
    ]);
  });
});
