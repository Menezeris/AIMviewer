import { describe, expect, it } from "vitest";

import {
  assignFromLibrary,
  libraryCatalog,
  LibraryInputError,
  LibrarySchemaMissingError,
  parseLibraryOrigin,
  parseRunSpecs,
  projectCatalog,
  saveViewerRun,
  setModelBinding,
  type LibraryDeps,
} from "./library";
import { memoryIdsLibraryStore, memoryIdsStore, type MemoryIdsStore } from "./testing";
import { execIdsTool, sha256 } from "./tools";

const ids = (title: string, extra = "") => `<?xml version="1.0" encoding="UTF-8"?>
<ids xmlns="http://standards.buildingsmart.org/IDS" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://standards.buildingsmart.org/IDS http://standards.buildingsmart.org/IDS/1.0/ids.xsd">
  <info><title>${title}</title><copyright>Assetin (CC-BY-4.0)</copyright><version>0.1</version></info>
  <specifications>
    <specification name="Podlažie" identifier="IU-O-storey" ifcVersion="IFC4X3_ADD2">
      <applicability minOccurs="1" maxOccurs="unbounded"><entity><name><simpleValue>IFCBUILDINGSTOREY</simpleValue></name></entity></applicability>
      <requirements><attribute cardinality="required"><name><simpleValue>Name</simpleValue></name></attribute></requirements>
    </specification>${extra}
  </specifications>
</ids>`;
const SPACE_SPEC = `
    <specification name="Priestor" identifier="IU-O-space" ifcVersion="IFC4X3_ADD2">
      <applicability minOccurs="0" maxOccurs="unbounded"><entity><name><simpleValue>IFCSPACE</simpleValue></name></entity></applicability>
      <requirements><attribute cardinality="required"><name><simpleValue>LongName</simpleValue></name></attribute></requirements>
    </specification>`;

const M1 = "f".repeat(64);
const M2 = "e".repeat(64);
const ER_PATH = "zadanie/ER/ER-0101 Priestorový model a protokol zamerania – odovzdanie.md";

/** What a library release writes into the DB (Python `assetin`, schema `library`): library IDS and an immutable `import` version. */
async function publish(store: MemoryIdsStore, code: string, xml: string, release: string, manifest: string) {
  let doc = await store.byCode(code);
  doc ??= await store.createDocument({ code, title: code, origin: "library", library_source: "db:library/assetin" });
  return store.addVersion(
    doc.id,
    {
      xml,
      sha256: sha256(xml),
      title: `${code} titul`,
      ids_version: "1.0",
      audit: { vydanie: release, kniznica: "assetin", diagnostiky: { E: 0, W: 14, I: 26 }, specifikacie: ["IU-O-storey (IU-O, IfcBuildingStorey)", "STD-CL-01 (STD, vždy)"] },
      author: "Samuel Augustin",
      source: "import",
      note: `vydanie ${release} knižnice assetin`,
      library_repo: "db:library/assetin",
      library_path: ER_PATH,
      library_commit: `${release}@${manifest}`,
      library_code: code,
    },
    null,
  );
}

function setup(opts: Parameters<typeof memoryIdsLibraryStore>[1] = {}) {
  const store = memoryIdsStore();
  const lib = memoryIdsLibraryStore(store, opts);
  const deps: LibraryDeps = { store, lib };
  return { store, lib, deps };
}

describe("katalóg knižnice z DB (D-182 doplnok V30)", () => {
  it("pôvod vydania: db:library/<kód> a <vydanie>@<manifest sha256>", () => {
    expect(parseLibraryOrigin("db:library/assetin", `2026.11.1@${M1}`)).toEqual({ library: "assetin", release: "2026.11.1", manifest_sha256: M1 });
    expect(parseLibraryOrigin("Menezeris/assetin-library", "1".repeat(40))).toEqual({ library: null, release: "1".repeat(40), manifest_sha256: null });
    expect(parseLibraryOrigin(null, null)).toEqual({ library: null, release: null, manifest_sha256: null });
  });

  it("prázdna DB: karta to povie; chat IDS, archivované a staré git priradenia sa v knižnici neukážu", async () => {
    const { store, deps } = setup();
    expect((await libraryCatalog(deps)).note).toContain("origin = library");
    await store.createDocument({ code: "CHAT", title: "c", origin: "chat" });
    const git = await store.createDocument({ code: "GIT", title: "g", origin: "library" });
    await store.addVersion(git.id, { xml: ids("g"), sha256: "g", title: "g", ids_version: null, audit: null, author: "S", source: "import", note: null, library_repo: "Menezeris/assetin-library", library_path: "ids/GIT.ids", library_commit: "1".repeat(40) }, null);
    await publish(store, "ARCH-OLD", ids("x"), "2026.10.1", M1);
    store.docs.find((d) => d.code === "ARCH-OLD")!.status = "archived";
    const cat = await libraryCatalog(deps);
    expect(cat.items).toEqual([]);
  });

  it("IDS z vydania: posledná verzia, pôvod, špecifikácie a diagnostiky z auditu; väzba na model = v projekte", async () => {
    const { store, deps } = setup();
    await publish(store, "ER-0101.ARCH", ids("ER-0101"), "2026.11.1", M1);
    const cat = await libraryCatalog(deps);
    expect(cat).toMatchObject({ repo: "db:library/assetin", ref: "2026.11.1", commit: `2026.11.1@${M1}`, truncated: false });
    expect(cat.items[0]).toMatchObject({
      path: ER_PATH,
      code: "ER-0101.ARCH",
      sha256: sha256(ids("ER-0101")),
      state: "not_assigned",
      aim: { code: "ER-0101.ARCH", version: 1, origin: "library" },
      release: { library: "assetin", release: "2026.11.1", manifest_sha256: M1 },
      specs: [{ identifier: "IU-O-storey", name: "IU-O-storey (IU-O, IfcBuildingStorey)" }, { identifier: "STD-CL-01", name: "STD-CL-01 (STD, vždy)" }],
      diagnostics: { E: 0, W: 14, I: 26 },
      last_change: { sha: `2026.11.1@${M1}`, author: "Samuel Augustin" },
      models: [],
    });

    await setModelBinding(deps, { code: "ER-0101.ARCH", model: "ASR", bound: true, author: "Samuel" });
    expect((await libraryCatalog(deps)).items[0]).toMatchObject({ state: "assigned", models: ["ASR"] });

        // new release -> a new version of the same IDS, the link stays
    await publish(store, "ER-0101.ARCH", ids("ER-0101", SPACE_SPEC), "2026.11.2", M2);
    expect((await libraryCatalog(deps)).items[0]).toMatchObject({ aim: { version: 2 }, release: { release: "2026.11.2" }, state: "assigned" });
  });

  it("Priradiť k projektu = väzba na model; iná posledná verzia a bez modelu povedia, čo robiť", async () => {
    const { store, deps, lib } = setup();
    await publish(store, "ER-0101.ARCH", ids("ER-0101"), "2026.11.1", M1);
    const item = (await libraryCatalog(deps)).items[0];
    const base = { path: item.path, commit: item.last_change!.sha, sha256: item.sha256, author: "Samuel" };
    await expect(assignFromLibrary(deps, { ...base, author: " " })).rejects.toBeInstanceOf(LibraryInputError);
    await expect(assignFromLibrary(deps, { ...base, sha256: "x" })).rejects.toThrow(/inú poslednú verziu/);
    await expect(assignFromLibrary(deps, base)).rejects.toThrow(/zaškrtni model/);
    await expect(assignFromLibrary(deps, { ...base, path: "NIE" })).rejects.toThrow(/nie je medzi IDS/);
    expect(await assignFromLibrary(deps, { ...base, model: "ASR" })).toEqual({ status: "created", code: "ER-0101.ARCH", version: 1, model: "ASR" });
    expect(await assignFromLibrary(deps, { ...base, path: "ER-0101.ARCH", model: "ASR" })).toMatchObject({ status: "unchanged" });
    expect(lib.bindings).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
  });
});

describe("väzba IDS na model a výsledok z viewera (D-182)", () => {
  async function assigned() {
    const s = setup();
    const row = await publish(s.store, "ER-0101_ARCH", ids("ER-0101"), "2026.11.1", M1);
    return { ...s, sha: row.sha256 };
  }

  it("ručná väzba: zaškrtnutie, opakovanie nič nemení, zrušenie ukončí; neznámy model a chýbajúca migrácia", async () => {
    const { deps, lib } = await assigned();
    expect(await setModelBinding(deps, { code: "ER-0101_ARCH", model: "ASR", bound: true, author: "Samuel", library_container: "IU-C-arch-model" })).toMatchObject({ changed: true });
    expect(await setModelBinding(deps, { code: "ER-0101_ARCH", model: "ASR", bound: true, author: "Samuel" })).toMatchObject({ changed: false });
    expect(await setModelBinding(deps, { code: "ER-0101_ARCH", model: "VZT", bound: true, author: "Samuel" })).toMatchObject({ changed: true });
    expect(await setModelBinding(deps, { code: "ER-0101_ARCH", model: "VZT", bound: false, author: "Jana" })).toMatchObject({ bound: false, changed: true });
    expect(lib.bindings.map((b) => [b.information_container_id, b.valid_until === null, b.ended_by])).toEqual([
      ["c-asr", true, null],
      ["c-vzt", false, "Jana"],
    ]);
    const project = await projectCatalog(deps);
    expect(project.items[0].models).toEqual([{ model: "ASR", library_container: "IU-C-arch-model", created_by: "Samuel", valid_from: expect.any(String) }]);
    await expect(setModelBinding(deps, { code: "ER-0101_ARCH", model: "XYZ", bound: true, author: "S" })).rejects.toThrow(/nie je v AIM/);

    const missing = setup({ schemaMissing: true });
    const doc = await missing.store.createDocument({ code: "A", title: "A", origin: "chat" });
    void doc;
    await expect(setModelBinding(missing.deps, { code: "A", model: "ASR", bound: true, author: "S" })).rejects.toBeInstanceOf(LibrarySchemaMissingError);
    expect((await projectCatalog(missing.deps)).schema_missing).toBe(true);
  });

  const specs = parseRunSpecs([
    {
      specification: { identifier: "IU-O-storey", name: "Podlažie" },
      status: "fail",
      applicableCount: 2,
      entityResults: [
        { globalId: "G1", entityType: "IfcBuildingStorey", passed: true, requirementResults: [{ status: "pass" }] },
        { globalId: "G2", entityType: "IfcBuildingStorey", passed: false, requirementResults: [{ status: "fail", failureReason: "Name missing" }] },
      ],
    },
  ])!;

  it("výsledok sa uloží s pečiatkou revízie, verzie IDS a nástroja; iné IDS ako v AIM ani neznáma revízia sa neuložia", async () => {
    const { deps, store, sha } = await assigned();
    const run = { code: "ER-0101_ARCH", version: 1, ids_sha256: sha, model: "ASR", revision: 79, engine_version: "@ifc-lite/ids 1.4.0", author: "Samuel", specs };
    const lookup = async (g: string[]) => new Map(g.filter((x) => x === "G1").map((x) => [x, { object_id: "obj-1" }]));
    const rdeps = { ...deps, lookup };

    await expect(saveViewerRun(rdeps, { ...run, ids_sha256: "iné" })).rejects.toThrow(/nie je verzia v1/);
    await expect(saveViewerRun(rdeps, { ...run, revision: null })).rejects.toThrow(/nie je známa/);
    await expect(saveViewerRun(rdeps, { ...run, revision: 5 })).rejects.toThrow(/nemá v AIM revíziu v5/);
    await expect(saveViewerRun(rdeps, { ...run, engine_version: "" })).rejects.toThrow(/verzia nástroja/);
    expect(store.runs).toHaveLength(0);

    const saved = await saveViewerRun(rdeps, run);
    expect(saved).toMatchObject({ results: 2, results_failed: 1, stale: false, ids_stale: false, revision: 79 });
    expect(store.runs[0]).toMatchObject({
      trigger: "viewer",
      engine: "ifc-lite",
      engine_version: "@ifc-lite/ids 1.4.0",
      created_by: "Samuel",
      model_label: "ASR",
      model_revisions: { ASR: 79 },
      ids_version_id: store.rows[0].id,
      ids_sha256: sha,
      specs_total: 1,
      specs_passed: 0,
    });
    expect(store.results.map((r) => [r.ifc_guid, r.object_id, r.status, r.reasons])).toEqual([
      ["G1", "obj-1", "pass", []],
      ["G2", null, "fail", ["Name missing"]],
    ]);

        // old revision: it is saved against it and says it is outdated
    const old = await saveViewerRun(rdeps, { ...run, revision: 78 });
    expect(old).toMatchObject({ stale: true, warning: expect.stringContaining("v78") });

        // new library release -> the result over v1 is ids_stale
    await publish(store, "ER-0101_ARCH", ids("ER-0101", SPACE_SPEC), "2026.11.2", M2);
    const project = await projectCatalog(deps);
    expect(project.items[0].runs).toEqual([expect.objectContaining({ model: "ASR", version: 1, stale: true, ids_stale: true, engine_version: "@ifc-lite/ids 1.4.0", based_on: { ASR: 78 } })]);
    expect(project.current_revisions).toEqual({ ASR: 79, VZT: 11 });
  });

  it("tvar výsledkov z viewera: neplatný vstup odmietne, texty oreže", () => {
    expect(parseRunSpecs("x")).toBeNull();
    expect(parseRunSpecs([{ entityResults: "x" }])).toBeNull();
    const [s] = parseRunSpecs([{ specification: { name: "n".repeat(900) }, entityResults: [{ globalId: "G", passed: false, requirementResults: [{ status: "fail", failureReason: "r".repeat(5000) }] }] }])!;
    expect(s.specification!.name!.length).toBe(500);
    expect(s.entityResults![0].requirementResults![0].failureReason!.length).toBe(1000);
  });

  it("ids_document list a get v chate ukážu pôvod z knižnice a modely", async () => {
    const { deps, store, lib } = await assigned();
    await setModelBinding(deps, { code: "ER-0101_ARCH", model: "ASR", bound: true, author: "Samuel" });
    const list = JSON.parse((await execIdsTool("ids_document", { action: "list" }, { store, lib })).text);
    expect(list.items[0]).toMatchObject({ code: "ER-0101_ARCH", origin: "library", library_commit: `2026.11.1@${M1}`, models: ["ASR"] });
    const got = JSON.parse((await execIdsTool("ids_document", { action: "get", ids: "ER-0101_ARCH" }, { store, lib })).text);
    expect(got.library).toEqual({ repo: "db:library/assetin", path: ER_PATH, commit: `2026.11.1@${M1}`, code: "ER-0101_ARCH" });
  });

  it("pracovná kópia ukáže, že knižničné IDS má novšiu verziu", async () => {
    const { deps, store } = await assigned();
    const lib = store.docs[0];
    const v1 = store.rows[0];
    const copy = await store.createDocument({ code: "ER-0101_ARCH-PRACOVNE", title: "kópia", origin: "chat", derived_from: v1.id });
    await store.addVersion(copy.id, { xml: ids("kópia"), sha256: sha256(ids("kópia")), title: "kópia", ids_version: null, audit: null, author: "x", source: "viewer", note: null }, null);
    await store.addVersion(lib.id, { xml: ids("v2"), sha256: "h2", title: "v2", ids_version: null, audit: null, author: "S", source: "import", note: null, library_repo: "db:library/assetin", library_path: ER_PATH, library_commit: `2026.11.2@${M2}` }, null);
    const project = await projectCatalog(deps);
    expect(project.items.find((i) => i.code === "ER-0101_ARCH-PRACOVNE")!.derived_from).toEqual({ code: "ER-0101_ARCH", version: 1, newer_exists: true });
  });
});
