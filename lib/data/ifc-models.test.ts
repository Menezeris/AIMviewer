/**
 * Revízia v URL modelu (D-086): archív revízie (D-135) alebo `?rev=N` mení `src`
 * iframe viewera, takže nová revízia sa načíta znova a cache prehliadača nevráti
 * starý súbor.
 */
import { describe, expect, it } from "vitest";

import { archiveEnabled, archiveUrl, modelKey, withRevisions, type IfcModel } from "./ifc-models";

const BASE = "https://x.supabase.co/storage/v1/object/public/ifc";
const MODELS: IfcModel[] = [
  { id: "ASR", label: "Architektúra", url: `${BASE}/ASR.ifc` },
  { id: "VZT", label: "Vzduchotechnika", url: `${BASE}/VZT.ifc` },
];

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
  it("predvolene áno, vypne ho len NEXT_PUBLIC_IFC_ARCHIVE=0", () => {
    expect(archiveEnabled({})).toBe(true);
    expect(archiveEnabled({ NEXT_PUBLIC_IFC_ARCHIVE: "1" })).toBe(true);
    expect(archiveEnabled({ NEXT_PUBLIC_IFC_ARCHIVE: "0" })).toBe(false);
  });
});

describe("withRevisions", () => {
  it("s archívom URL revízie (D-135), model bez revízie bez zmeny", () => {
    const out = withRevisions(MODELS, [{ model: "ASR", revision: 78 }], { archive: true });
    expect(out[0]).toEqual({ ...MODELS[0], url: `${BASE}/archive/ASR/v078.ifc.gz`, revision: 78 });
    expect(out[1]).toBe(MODELS[1]);
  });

  it("nová revízia = nová URL (iframe sa obnoví)", () => {
    const [a] = withRevisions(MODELS, [{ model: "ASR", revision: 78 }], { archive: true });
    const [b] = withRevisions(MODELS, [{ model: "ASR", revision: 79 }], { archive: true });
    expect(a.url).not.toBe(b.url);
  });

  it("bez archívu pridá rev len modelom, ktoré majú aktuálnu revíziu", () => {
    const out = withRevisions(MODELS, [{ model: "ASR", revision: 72 }], { archive: false });
    expect(out[0]).toEqual({ ...MODELS[0], url: `${BASE}/ASR.ifc?rev=72`, revision: 72 });
    expect(out[1]).toBe(MODELS[1]);
  });

  it("prepíše starý rev v URL", () => {
    const [m] = withRevisions([{ ...MODELS[0], url: `${BASE}/ASR.ifc?rev=71` }], [{ model: "ASR", revision: 73 }], { archive: false });
    expect(m.url).toBe(`${BASE}/ASR.ifc?rev=73`);
  });

  it("bez revízií vráti modely bez zmeny", () => {
    expect(withRevisions(MODELS, [])).toEqual(MODELS);
  });
});
