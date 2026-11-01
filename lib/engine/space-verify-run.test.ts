import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import { MINI_SPACE_VERIFY_BYTES } from "./__fixtures__/mini-space-verify";
import { clearEngineCache, setArchiveResolver } from "./cache";
import type { AimRef } from "./join";
import { execEngineTool, type EngineDeps } from "./tools";
import type { VerificationResultWrite, VerificationRunWrite, VerificationStore } from "../verify/types";

const SPACE = "0minispace201000000001";
const SLAB = "0minislab0below0000010";

const AIM: Record<string, AimRef> = {
  [SPACE]: { object_id: "55555555-5555-5555-5555-555555555555", object_ref: "2.01", name: "2.01", object_type: "space" },
};

function deps(extra: Partial<EngineDeps> = {}): EngineDeps {
  return {
    sources: () => [{ id: "MINI", label: "Mini", url: "https://example.test/space.ifc" }],
    lookup: async (guids) => new Map(guids.filter((g) => AIM[g]).map((g) => [g, AIM[g]])),
    resolveTargets: async (targets) => new Map(targets.filter((t) => t === "2.01").map((t) => [t, SPACE])),
    fetchImpl: (async () => new Response(MINI_SPACE_VERIFY_BYTES, { status: 200, headers: { etag: '"space"' } })) as unknown as typeof fetch,
    ...extra,
  };
}

const run = async (input: Record<string, unknown>, d = deps()) => {
  const res = await execEngineTool("ifc_measure", input, d);
  return { ...res, json: res.isError ? null : JSON.parse(res.content) };
};

describe("ifc_measure verify=true (D-185)", () => {
  afterEach(() => clearEngineCache());

  it("overí Qto miestnosti zo súboru voči extrúziám: všetko zelené, s metódou, toleranciou a vzorcom", async () => {
    const r = await run({ verify: true, a: "2.01" });
    expect(r.isError).toBe(false);
    const sp = r.json.spaces[0];
    expect(sp.object_ref).toBe("2.01");
    expect(r.json.counts).toEqual({ green: 8, yellow: 0, red: 0, grey: 0 });
    const h = sp.results.find((x: { recipe: string }) => x.recipe === "space.height.slabs@2");
    expect(h.formula).toBe("spodok(SD-nad) - vrch(SD-pod) = 8.8 - 4.85 = 3.95 m");
    expect(h.file).toBe(3.95); // 3950 mm zo súboru prevedené na m
    expect(h.tolerance).toBe("dĺžka +- 5 mm");
    expect(h.definition).toMatch(/constant height/);
    expect(h.dimension).toBeUndefined();
    expect(r.json.registry_version).toBe(3);
    expect(r.json.saved).toBeUndefined();
  });

  it("show=true pošle zvislé kóty (výška zo súborových dosiek, podlaha, podhľad) do viewera", async () => {
    const r = await run({ verify: true, a: SPACE, show: true });
    expect(r.actions).toHaveLength(1);
    expect(r.json.view).toMatch(/kóty vo vieweri: 3/);
  });

  it("save=true uloží beh s podpisom revízie; bez úložiska alebo pri chybe tabuľky výpočet platí a saved.ok=false", async () => {
    const saved: Array<{ run: VerificationRunWrite; rows: VerificationResultWrite[] }> = [];
    const store: VerificationStore = { saveRun: async (r, rows) => (saved.push({ run: r, rows }), { id: "run-1" }) };
    // Ako server: motor číta archív revízie (D-135), revízia je z URL archívu -> podpis vstupu {MINI: 7}.
    const gz = gzipSync(MINI_SPACE_VERIFY_BYTES);
    setArchiveResolver(async () => "https://example.test/archive/MINI/v007.ifc.gz");
    const archived = deps({
      verification: store,
      fetchImpl: (async (url: string, init?: { method?: string }) =>
        init?.method === "HEAD"
          ? new Response(null, { status: 200, headers: { etag: '"space"' } })
          : new Response(String(url).endsWith(".gz") ? gz : MINI_SPACE_VERIFY_BYTES, { status: 200 })) as unknown as typeof fetch,
    });
    try {
      const ok = await run({ verify: true, a: "2.01", save: true, author: "test" }, archived);
      expect(ok.json.saved).toEqual({ ok: true, run_id: "run-1", model_revisions: { MINI: 7 } });
      expect(saved[0].run).toMatchObject({ scope: "IfcSpace", registry_version: 3, model_revisions: { MINI: 7 }, counts: { green: 8 }, author: "test" });
      expect(saved[0].rows).toHaveLength(8);
      expect(saved[0].rows.every((x) => x.revision === 7 && x.global_id === SPACE && x.method.length > 0)).toBe(true);
    } finally {
      setArchiveResolver(null);
      clearEngineCache();
    }
    // Bez archívu revízia nie je známa: beh sa neukladá (D-183), výpočet ostáva.
    const unknown = await run({ verify: true, a: "2.01", save: true }, deps({ verification: store }));
    expect(unknown.json.saved.error).toMatch(/revízia modelu nie je známa/);
    expect(unknown.json.counts.green).toBe(8);
    const failing: VerificationStore = { saveRun: async () => { throw new Error('relation "verification_runs" does not exist'); } };
    const noStore = await run({ verify: true, a: "2.01", save: true });
    expect(noStore.json.saved).toEqual({ ok: false, error: "úložisko overenia nie je nastavené" });
    clearEngineCache(); // store z behu bez archívu nemá revíziu
    setArchiveResolver(async () => "https://example.test/archive/MINI/v007.ifc.gz");
    try {
      const broken = await run({ verify: true, a: "2.01", save: true }, { ...archived, verification: failing });
      expect(broken.json.saved.ok).toBe(false);
      expect(broken.json.saved.error).toMatch(/verification_runs/);
      expect(broken.json.counts.green).toBe(8);
    } finally {
      setArchiveResolver(null);
    }
  });

  it("miestnosť bez extrúzie (IfcFacetedBrep) overí cez uzavretý mesh motora (D-185 oprava)", async () => {
    const r = await run({ verify: true, a: "0minispace202brep00001" });
    expect(r.isError).toBe(false);
    const res = r.json.spaces[0].results as Array<{ recipe: string; status: string; computed?: number; method: string; formula?: string; note?: string }>;
    const by = (id: string) => res.find((x) => x.recipe.startsWith(id))!;
    expect(by("space.height.own").status).toBe("green");
    expect(by("space.height.own").method).toMatch(/uzavretý mesh/);
    expect(by("space.area.profile").computed).toBeCloseTo(16, 3);
    expect(by("space.perimeter.profile").computed).toBeCloseTo(16, 3);
    expect(by("space.volume.prism").status).toBe("green");
    expect(by("space.volume.prism").formula).toMatch(/objem uzavretého meshu/);
    expect(by("space.netvolume.coverings").status).toBe("green");
    expect(by("space.ffh.covering").status).toBe("grey");
  });

  it("odmietne prvok, ktorý nie je IfcSpace, a kombináciu s b", async () => {
    const notSpace = await run({ verify: true, a: SLAB });
    expect(notSpace.isError).toBe(true);
    expect(notSpace.content).toMatch(/len miestnosti \(IfcSpace\)/);
    const withB = await run({ verify: true, a: SPACE, b: SLAB });
    expect(withB.isError).toBe(true);
  });
});
