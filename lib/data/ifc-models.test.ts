/**
 * Revízia v URL modelu (D-086): `?rev=N` mení `src` iframe viewera, takže nová
 * revízia sa načíta znova a cache prehliadača nevráti starý súbor.
 */
import { describe, expect, it } from "vitest";

import { modelKey, withRevisions, type IfcModel } from "./ifc-models";

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
});

describe("withRevisions", () => {
  it("pridá rev len modelom, ktoré majú aktuálnu revíziu", () => {
    const out = withRevisions(MODELS, [{ model: "ASR", revision: 72 }]);
    expect(out[0]).toEqual({ ...MODELS[0], url: `${BASE}/ASR.ifc?rev=72`, revision: 72 });
    expect(out[1]).toBe(MODELS[1]);
  });

  it("prepíše starý rev v URL", () => {
    const [m] = withRevisions([{ ...MODELS[0], url: `${BASE}/ASR.ifc?rev=71` }], [{ model: "ASR", revision: 73 }]);
    expect(m.url).toBe(`${BASE}/ASR.ifc?rev=73`);
  });

  it("bez revízií vráti modely bez zmeny", () => {
    expect(withRevisions(MODELS, [])).toEqual(MODELS);
  });
});
