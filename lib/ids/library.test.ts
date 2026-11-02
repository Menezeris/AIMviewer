import { describe, expect, it } from "vitest";

import {
  assignFromLibrary,
  libraryCatalog,
  LibraryInputError,
  LibrarySchemaMissingError,
  parseRunSpecs,
  projectCatalog,
  saveViewerRun,
  setModelBinding,
  type LibraryDeps,
} from "./library";
import {
  githubLibrarySource,
  isLibraryIdsPath,
  libraryConfig,
  LibraryNotConfiguredError,
  type LibraryFile,
  type LibrarySource,
} from "./library-source";
import { memoryIdsLibraryStore, memoryIdsStore } from "./testing";
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

const C1 = "1".repeat(40);
const C2 = "2".repeat(40);

/** Repo knižnice v pamäti: commit -> {cesta: obsah}. */
function memorySource(commits: Record<string, Record<string, string>>, headSha: string): LibrarySource & { setHead(sha: string): void } {
  let head = headSha;
  const blobOf = (commit: string, path: string) => `${commit}:${path}`;
  return {
    repo: "Menezeris/assetin-library",
    ref: "main",
    dir: "ids",
    setHead(sha) {
      head = sha;
    },
    async head() {
      return { sha: head, date: "2026-11-02T09:00:00Z" };
    },
    async files(commit) {
      const tree = commits[commit] ?? {};
      const files: LibraryFile[] = Object.keys(tree)
        .filter((p) => isLibraryIdsPath(p, "ids"))
        .sort()
        .map((p) => ({ path: p, blob: blobOf(commit, p), size: tree[p].length }));
      return { files, truncated: false };
    },
    async lastChange(_path, commit) {
      return { sha: commit, date: "2026-11-02T09:00:00Z", author: "Samuel", message: "IDS" };
    },
    async blob(blob) {
      const [commit, ...rest] = blob.split(":");
      return commits[commit][rest.join(":")];
    },
  };
}

function setup(opts: Parameters<typeof memoryIdsLibraryStore>[1] = {}) {
  const store = memoryIdsStore();
  const lib = memoryIdsLibraryStore(store, opts);
  const deps: LibraryDeps = { store, lib };
  return { store, lib, deps };
}

describe("zdroj knižnice (D-182)", () => {
  it("hotové IDS len z priečinka ids/, bez DSS, bsi a testovacích fixtures", () => {
    expect(isLibraryIdsPath("ids/ER-0101_ARCH.ids", "ids")).toBe(true);
    expect(isLibraryIdsPath("ids/projekt/ER-0102_TZB.IDS", "ids")).toBe(true);
    expect(isLibraryIdsPath("ids/dss/Configurations.ids", "ids")).toBe(false);
    expect(isLibraryIdsPath("ids/Configurations.ids", "ids")).toBe(false);
    expect(isLibraryIdsPath("ids/bsi/testcase.ids", "ids")).toBe(false);
    expect(isLibraryIdsPath("tests/fixtures/ids/ER-0101_ARCH.ids", "ids")).toBe(false);
    expect(isLibraryIdsPath("ids/readme.md", "ids")).toBe(false);
    expect(isLibraryIdsPath("idsx/a.ids", "ids")).toBe(false);
  });

  it("konfigurácia: predvolené repo, vetva a priečinok; zlý priečinok odmietne", () => {
    expect(libraryConfig({})).toEqual({ token: null, repo: "Menezeris/assetin-library", ref: "main", dir: "ids" });
    expect(libraryConfig({ LIBRARY_GITHUB_TOKEN: " t ", LIBRARY_IDS_DIR: "/vydanie/ids/" })).toMatchObject({ token: "t", dir: "vydanie/ids" });
    expect(() => libraryConfig({ LIBRARY_IDS_DIR: "../x" })).toThrow();
    expect(() => libraryConfig({ LIBRARY_REPO: "zle" })).toThrow();
    expect(() => githubLibrarySource(libraryConfig({}))).toThrow(LibraryNotConfiguredError);
  });

  it("GitHub: token v hlavičke, strom filtrovaný, blob z base64", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const xml = ids("A");
    const fake = async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
      const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
      if (url.endsWith("/commits/main")) return json({ sha: C1, commit: { committer: { date: "2026-11-02T09:00:00Z" } } });
      if (url.includes("/git/trees/")) {
        return json({
          tree: [
            { path: "ids", type: "tree", sha: "t" },
            { path: "ids/A.ids", type: "blob", sha: "b1", size: xml.length },
            { path: "ids/dss/Configurations.ids", type: "blob", sha: "b2", size: 1 },
            { path: "ids/bsi/x.ids", type: "blob", sha: "b3", size: 1 },
            { path: "tests/fixtures/ids/ER-0101_ARCH.ids", type: "blob", sha: "b4", size: 1 },
          ],
        });
      }
      if (url.includes("/git/blobs/b1")) return json({ content: Buffer.from(xml).toString("base64"), encoding: "base64", size: xml.length });
      return new Response("{}", { status: 404 });
    };
    const src = githubLibrarySource(libraryConfig({ LIBRARY_GITHUB_TOKEN: "secret" }), fake);
    const head = await src.head();
    expect(head.sha).toBe(C1);
    const { files } = await src.files(head.sha);
    expect(files.map((f) => f.path)).toEqual(["ids/A.ids"]);
    expect(await src.blob("b1")).toBe(xml);
    expect(await src.blob("b1")).toBe(xml);
    expect(calls.every((c) => c.auth === "Bearer secret")).toBe(true);
    expect(calls.filter((c) => c.url.includes("/git/blobs/")).length).toBe(1);
  });
});

describe("katalóg a priradenie k projektu (D-182)", () => {
  it("prázdny priečinok: karta to povie, testovací súbor z tests/fixtures sa neponúka", async () => {
    const { deps } = setup();
    const src = memorySource({ [C1]: { "tests/fixtures/ids/ER-0101_ARCH.ids": ids("prototyp") } }, C1);
    const cat = await libraryCatalog(src, deps);
    expect(cat.items).toEqual([]);
    expect(cat.note).toContain("ids/");
  });

  it("priradenie uloží nemennú kópiu s pôvodom; rovnaký obsah nič; nová verzia v knižnici projekt nemení, kým sa nepriradí", async () => {
    const { store, deps } = setup();
    const src = memorySource({ [C1]: { "ids/ER-0101_ARCH.ids": ids("ER-0101") }, [C2]: { "ids/ER-0101_ARCH.ids": ids("ER-0101", SPACE_SPEC) } }, C1);

    const cat = await libraryCatalog(src, deps);
    expect(cat.items).toHaveLength(1);
    const item = cat.items[0];
    expect(item).toMatchObject({ code: "ER-0101_ARCH", state: "not_assigned", title: "ER-0101", specs: [{ identifier: "IU-O-storey", name: "Podlažie" }] });

    await expect(assignFromLibrary(src, deps, { path: item.path, commit: C1, sha256: item.sha256!, author: " " })).rejects.toBeInstanceOf(LibraryInputError);
    await expect(assignFromLibrary(src, deps, { path: item.path, commit: C1, sha256: "x", author: "Samuel" })).rejects.toThrow(/nezhoduje/);

    const a = await assignFromLibrary(src, deps, { path: item.path, commit: C1, sha256: item.sha256!, author: "Samuel" });
    expect(a).toEqual({ status: "created", code: "ER-0101_ARCH", version: 1 });
    expect(store.docs[0]).toMatchObject({ code: "ER-0101_ARCH", origin: "library", library_source: `Menezeris/assetin-library@${C1}:ids/ER-0101_ARCH.ids`, created_by: "Samuel" });
    expect(store.rows[0]).toMatchObject({
      version: 1,
      source: "import",
      author: "Samuel",
      sha256: item.sha256,
      library_repo: "Menezeris/assetin-library",
      library_path: "ids/ER-0101_ARCH.ids",
      library_commit: C1,
      library_code: "ER-0101_ARCH",
    });
    expect(store.rows[0].xml).toBe(ids("ER-0101"));

    expect(await assignFromLibrary(src, deps, { path: item.path, commit: C1, sha256: item.sha256!, author: "Samuel" })).toEqual({ status: "unchanged", code: "ER-0101_ARCH", version: 1 });
    expect((await libraryCatalog(src, deps)).items[0]).toMatchObject({ state: "assigned", aim: { code: "ER-0101_ARCH", version: 1 } });

    src.setHead(C2);
    const cat2 = await libraryCatalog(src, deps);
    expect(cat2.items[0]).toMatchObject({ state: "differs", aim: { version: 1 } });
    expect(store.rows).toHaveLength(1);

    const b = await assignFromLibrary(src, deps, { path: item.path, commit: C2, sha256: cat2.items[0].sha256!, author: "Jana" });
    expect(b).toMatchObject({ status: "new_version", code: "ER-0101_ARCH", version: 2, previous_version: 1 });
    expect(store.rows.map((r) => [r.version, r.library_commit, r.author])).toEqual([
      [1, C1, "Samuel"],
      [2, C2, "Jana"],
    ]);
  });

  it("premenovaný kód v knižnici: najprv voľba, potom história pokračuje pod novým kódom; alebo výslovne nové IDS", async () => {
    const { store, deps } = setup();
    const src = memorySource({ [C1]: { "ids/ER-0101_ARCH.ids": ids("ER-0101") }, [C2]: { "ids/ER-0101_ASR.ids": ids("ER-0101", SPACE_SPEC) } }, C1);
    const first = (await libraryCatalog(src, deps)).items[0];
    await assignFromLibrary(src, deps, { path: first.path, commit: C1, sha256: first.sha256!, author: "Samuel" });

    src.setHead(C2);
    const renamed = (await libraryCatalog(src, deps)).items[0];
    expect(renamed).toMatchObject({ code: "ER-0101_ASR", state: "not_assigned" });
    const choice = await assignFromLibrary(src, deps, { path: renamed.path, commit: C2, sha256: renamed.sha256!, author: "Samuel" });
    expect(choice).toMatchObject({ status: "choice_required", code: "ER-0101_ASR", candidates: ["ER-0101_ARCH"] });
    expect(store.rows).toHaveLength(1);

    const cont = await assignFromLibrary(src, deps, { path: renamed.path, commit: C2, sha256: renamed.sha256!, author: "Samuel", continue_code: "ER-0101_ARCH" });
    expect(cont).toMatchObject({ status: "new_version", code: "ER-0101_ASR", version: 2, renamed_from: "ER-0101_ARCH" });
    expect(store.docs).toHaveLength(1);
    expect(store.docs[0].code).toBe("ER-0101_ASR");
    expect(store.rows.map((r) => r.library_code)).toEqual(["ER-0101_ARCH", "ER-0101_ASR"]);
    expect((await libraryCatalog(src, deps)).items[0]).toMatchObject({ state: "assigned", aim: { code: "ER-0101_ASR", version: 2 } });
  });

  it("výslovne nové IDS pri premenovaní; pracovné IDS s rovnakým kódom je kolízia", async () => {
    const { store, deps } = setup();
    const src = memorySource({ [C1]: { "ids/A.ids": ids("A"), "ids/B.ids": ids("B") } }, C1);
    const [a, b] = (await libraryCatalog(src, deps)).items;
    await assignFromLibrary(src, deps, { path: a.path, commit: C1, sha256: a.sha256!, author: "S" });
    expect(await assignFromLibrary(src, deps, { path: b.path, commit: C1, sha256: b.sha256!, author: "S", as_new: true })).toMatchObject({ status: "created", code: "B" });

    const chat = await store.createDocument({ code: "C", title: "C", origin: "chat" });
    await store.addVersion(chat.id, { xml: ids("C"), sha256: "h", title: "C", ids_version: null, audit: null, author: "x", source: "chat", note: null }, null);
    const src2 = memorySource({ [C2]: { "ids/C.ids": ids("C") } }, C2);
    const c = (await libraryCatalog(src2, deps)).items[0];
    expect(c.state).toBe("collision");
    await expect(assignFromLibrary(src2, deps, { path: c.path, commit: C2, sha256: c.sha256!, author: "S" })).rejects.toThrow(/pracovné IDS/);
  });

  it("súbor s menom, ktoré nie je kód, je v katalógu neplatný a nedá sa priradiť", async () => {
    const { deps } = setup();
    const src = memorySource({ [C1]: { "ids/zlý názov.ids": ids("X") } }, C1);
    const item = (await libraryCatalog(src, deps)).items[0];
    expect(item.state).toBe("invalid");
    await expect(assignFromLibrary(src, deps, { path: item.path, commit: C1, sha256: item.sha256!, author: "S" })).rejects.toBeInstanceOf(LibraryInputError);
  });
});

describe("väzba IDS na model a výsledok z viewera (D-182)", () => {
  async function assigned() {
    const s = setup();
    const src = memorySource({ [C1]: { "ids/ER-0101_ARCH.ids": ids("ER-0101") } }, C1);
    const item = (await libraryCatalog(src, s.deps)).items[0];
    await assignFromLibrary(src, s.deps, { path: item.path, commit: C1, sha256: item.sha256!, author: "Samuel" });
    return { ...s, src, sha: item.sha256! };
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
    const { deps, store, src, sha } = await assigned();
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

    // stará revízia: uloží sa k nej a povie, že je zastaraná
    const old = await saveViewerRun(rdeps, { ...run, revision: 78 });
    expect(old).toMatchObject({ stale: true, warning: expect.stringContaining("v78") });

    // nová verzia IDS v AIM -> výsledok nad v1 je ids_stale
    src.setHead(C2);
    const src2 = memorySource({ [C2]: { "ids/ER-0101_ARCH.ids": ids("ER-0101", SPACE_SPEC) } }, C2);
    const item = (await libraryCatalog(src2, deps)).items[0];
    await assignFromLibrary(src2, deps, { path: item.path, commit: C2, sha256: item.sha256!, author: "Samuel" });
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
    expect(list.items[0]).toMatchObject({ code: "ER-0101_ARCH", origin: "library", library_commit: C1, models: ["ASR"] });
    const got = JSON.parse((await execIdsTool("ids_document", { action: "get", ids: "ER-0101_ARCH" }, { store, lib })).text);
    expect(got.library).toEqual({ repo: "Menezeris/assetin-library", path: "ids/ER-0101_ARCH.ids", commit: C1, code: "ER-0101_ARCH" });
  });

  it("pracovná kópia ukáže, že knižničné IDS má novšiu verziu", async () => {
    const { deps, store } = await assigned();
    const lib = store.docs[0];
    const v1 = store.rows[0];
    const copy = await store.createDocument({ code: "ER-0101_ARCH-PRACOVNE", title: "kópia", origin: "chat", derived_from: v1.id });
    await store.addVersion(copy.id, { xml: ids("kópia"), sha256: sha256(ids("kópia")), title: "kópia", ids_version: null, audit: null, author: "x", source: "viewer", note: null }, null);
    await store.addVersion(lib.id, { xml: ids("v2"), sha256: "h2", title: "v2", ids_version: null, audit: null, author: "S", source: "import", note: null, library_repo: "r", library_path: "ids/ER-0101_ARCH.ids", library_commit: C2 }, null);
    const project = await projectCatalog(deps);
    expect(project.items.find((i) => i.code === "ER-0101_ARCH-PRACOVNE")!.derived_from).toEqual({ code: "ER-0101_ARCH", version: 1, newer_exists: true });
  });
});
