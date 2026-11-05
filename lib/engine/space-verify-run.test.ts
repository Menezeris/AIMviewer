import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import { MINI_SPACE_VERIFY_BYTES } from "./__fixtures__/mini-space-verify";
import { clearEngineCache, setArchiveResolver } from "./cache";
import type { AimRef } from "./join";
import { verifySpacesByGuid } from "./space-verify-run";
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
    expect(r.json.counts).toEqual({ green: 9, yellow: 0, red: 0, grey: 0 });
    const h = sp.results.find((x: { recipe: string }) => x.recipe === "space.height.slabs@2");
    expect(h.formula).toBe("spodok(SD-nad) - vrch(SD-pod) = 8.8 - 4.85 = 3.95 m");
    expect(h.file).toBe(3.95); // 3950 mm from the file converted to m
    expect(h.tolerance).toBe("dĺžka +- 5 mm");
    expect(h.definition).toMatch(/constant height/);
    expect(h.dimension).toBeUndefined();
    expect(r.json.registry_version).toBe(4);
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
    // Like the server: the engine reads the revision archive (D-135), the revision is from the archive URL -> input signature {MINI: 7}.
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
      expect(saved[0].run).toMatchObject({ scope: "IfcSpace", registry_version: 4, model_revisions: { MINI: 7 }, counts: { green: 9 }, author: "test" });
      expect(saved[0].rows).toHaveLength(9);
      expect(saved[0].rows.every((x) => x.revision === 7 && x.global_id === SPACE && x.method.length > 0)).toBe(true);
      // D-185 UI: the row carries the explanation and formula cells with the source element (columns from the verification_inputs migration).
      const hs = saved[0].rows.find((x) => x.recipe === "space.height.slabs@2")!;
      expect(hs.explanation).toMatch(/od vrchu dosky pod/);
      expect(hs.inputs?.expression).toBe("A - B");
      expect(hs.inputs?.cells.map((c) => [c.key, c.value, c.global_id])).toEqual([["A", 8.8, "0minislab0above0000010"], ["B", 4.85, SLAB]]);
      expect(hs.inputs?.file_meta).toEqual({ method_of_measurement: "BaseQuantities" });
    } finally {
      setArchiveResolver(null);
      clearEngineCache();
    }
    // Without an archive the revision is not known: the run is not stored (D-183), the computation stays.
    const unknown = await run({ verify: true, a: "2.01", save: true }, deps({ verification: store }));
    expect(unknown.json.saved.error).toMatch(/revízia modelu nie je známa/);
    expect(unknown.json.counts.green).toBe(9);
    const failing: VerificationStore = { saveRun: async () => { throw new Error('relation "verification_runs" does not exist'); } };
    const noStore = await run({ verify: true, a: "2.01", save: true });
    expect(noStore.json.saved).toEqual({ ok: false, error: "úložisko overenia nie je nastavené" });
    clearEngineCache(); // a store from a run without an archive has no revision
    setArchiveResolver(async () => "https://example.test/archive/MINI/v007.ifc.gz");
    try {
      const broken = await run({ verify: true, a: "2.01", save: true }, { ...archived, verification: failing });
      expect(broken.json.saved.ok).toBe(false);
      expect(broken.json.saved.error).toMatch(/verification_runs/);
      expect(broken.json.counts.green).toBe(9);
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

  it("NetFloorArea (D-185 dodatok 4): odčíta stĺp, vstavku (IsBuiltIn z typu) a otvor dosky pod; voľný nábytok nie", async () => {
    const r = await run({ verify: true, a: "2.01" });
    const nfa = r.json.spaces[0].results.find((x: { recipe: string }) => x.recipe === "space.netfloorarea.profile@1");
    expect(nfa).toMatchObject({ status: "green", file: 86.24, computed: 86.24, expression: "A - B - C - D", tolerance: "plocha +- 0,5 %" });
    expect(nfa.formula).toBe("88 - 0.16 (SL-stlp) - 0.6 (VS-vstavka) - 1 (OT-otvor) = 86.24 m2");
    // The cells are carried by the host (verifySpacesByGuid, the run row), not the tool output.
    const { verified } = await verifySpacesByGuid([SPACE], deps());
    const cells = verified[0].results.find((x) => x.recipe === "space.netfloorarea.profile@1")!.cells!;
    expect(cells.map((c) => [c.global_id, c.quantity ?? null])).toEqual([
      [SPACE, "Qto_SpaceBaseQuantities.GrossFloorArea"],
      ["0minicolumn00000000100", null],
      ["0minibuiltin0000000100", null],
      ["0miniopening0000000100", null],
    ]);
    expect(nfa.anchors.map((a: { role: string }) => a.role)).toEqual(["teleso miestnosti", "stĺp vnútri miestnosti", "vstavka vnútri miestnosti", "otvor v doske"]);
  });

  it("odmietne prvok, ktorý nie je IfcSpace, a kombináciu s b", async () => {
    const notSpace = await run({ verify: true, a: SLAB });
    expect(notSpace.isError).toBe(true);
    expect(notSpace.content).toMatch(/len miestnosti \(IfcSpace\)/);
    const withB = await run({ verify: true, a: SPACE, b: SLAB });
    expect(withB.isError).toBe(true);
  });

  it("host (D-185 UI): verifySpacesByGuid overí prvok podľa GUID alebo všetky IfcSpace modelu, iný prvok odmietne", async () => {
    const one = await verifySpacesByGuid([SPACE], deps());
    expect(one.verified.map((v) => v.space.globalId)).toEqual([SPACE]);
    expect(one.used).toEqual(["MINI"]);
    const all = await verifySpacesByGuid(null, deps());
    expect(all.verified.map((v) => v.space.globalId).sort()).toEqual(["0minispace202brep00001", SPACE].sort());
    await expect(verifySpacesByGuid([SLAB], deps())).rejects.toThrow(/len pre miestnosti/);
    await expect(verifySpacesByGuid(["0missing00000000000000"], deps())).rejects.toThrow(/nie je v modeloch/);
  });
});
