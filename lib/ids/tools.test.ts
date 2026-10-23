import { describe, expect, it } from "vitest";

import { describeDoc, diffDocs } from "./describe";
import { callIds, defaultIdsEngine } from "./engine";
import { IDS_TOOL_DEFINITIONS } from "./tool-defs";
import { memoryIdsStore, type MemoryIdsStore } from "./testing";
import { execIdsTool } from "./tools";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const specOps = (specId: string, facetA: string, facetR: string, entity = "IFCWALL", prop = "FireRating") => [
  { kind: "spec.add", payload: { specId, name: "Steny", ifcVersions: ["IFC4"] } },
  { kind: "facet.add", payload: { specId, section: "applicability", facetId: facetA, facet: { type: "entity", name: { kind: "equals", value: entity } } } },
  {
    kind: "facet.add",
    payload: {
      specId,
      section: "requirements",
      facetId: facetR,
      facet: { type: "property", propertySet: { kind: "equals", value: "Pset_WallCommon" }, baseName: { kind: "equals", value: prop } },
    },
  },
];

const LIBRARY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ids xmlns="http://standards.buildingsmart.org/IDS" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://standards.buildingsmart.org/IDS http://standards.buildingsmart.org/IDS/1.0/ids.xsd">
  <info><title>ER-0101 knižnica</title><version>1.0</version></info>
  <specifications>
    <specification name="Podlažie" identifier="IU-O-storey" ifcVersion="IFC4">
      <applicability minOccurs="0" maxOccurs="unbounded"><entity><name><simpleValue>IFCBUILDINGSTOREY</simpleValue></name></entity></applicability>
      <requirements><attribute cardinality="required"><name><simpleValue>Name</simpleValue></name></attribute></requirements>
    </specification>
  </specifications>
</ids>`;

async function seedLibrary(store: MemoryIdsStore) {
  const doc = await store.createDocument({ code: "ER-0101_ARCH", title: "ER-0101 knižnica", origin: "library", library_source: "assetin-library@abc:zadanie/x.md" });
  await store.addVersion(doc.id, { xml: LIBRARY_XML, sha256: "h", title: doc.title, ids_version: "1.0", audit: null, author: "import", source: "import", note: null }, null);
  return doc;
}

const setup = () => {
  const store = memoryIdsStore();
  const run = async (args: Record<string, unknown>) => {
    const r = await execIdsTool("ids_document", args, { store });
    let json: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      json = JSON.parse(r.text);
    } catch {
      /* chyba vstupu je obyčajný text */
    }
    return { ...r, json };
  };
  return { store, run };
};

describe("ids_document (D-162)", () => {
  it("create z ops, list a get s čitateľnými facetmi; nie je z knižnice", async () => {
    const { run } = setup();
    const c = await run({ action: "create", code: "CHAT-STENY", title: "Steny z chatu", ops: specOps(U(1), U(2), U(3)) });
    expect(c.isError).toBe(false);
    expect(c.json.created).toMatchObject({ code: "CHAT-STENY", origin: "chat", version: 1 });
    expect(c.json.created.label).toContain("nie je z knižnice");

    const l = await run({ action: "list" });
    expect(l.json.items).toHaveLength(1);
    expect(l.json.items[0]).toMatchObject({ code: "CHAT-STENY", origin: "chat", version: 1, last_run: null });

    const g = await run({ action: "get", ids: "CHAT-STENY", include_xml: true });
    const spec = g.json.ids.specifications[0];
    expect(spec.applicability[0].facet).toBe("entity IFCWALL");
    expect(spec.requirements[0]).toMatchObject({ facet: "property Pset_WallCommon.FireRating", optionality: "required" });
    expect(spec.id).toBeTruthy();
    expect(g.json.xml).toContain("<simpleValue>IFCWALL</simpleValue>");
    expect(g.json.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("apply_ops: XML -> ids_read -> ops -> ids_write -> nová verzia; diff ukáže zmenu; verzie sú nemenné", async () => {
    const { store, run } = setup();
    await run({ action: "create", code: "CHAT-STENY", title: "Steny", ops: specOps(U(1), U(2), U(3)) });
    const g = await run({ action: "get", ids: "CHAT-STENY" });
    const specId = g.json.ids.specifications[0].id;
    const r = await run({
      action: "apply_ops",
      ids: "CHAT-STENY",
      note: "pridaj FireRating pre dvere",
      ops: [{ kind: "facet.add", payload: { specId, section: "requirements", facetId: U(9), facet: { type: "attribute", name: { kind: "equals", value: "Name" } } } }],
    });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ saved: true, version: 2, previous_version: 1, applied: 1 });
    expect(store.rows.map((v) => v.version)).toEqual([1, 2]);
    expect(store.rows[0].xml).not.toBe(store.rows[1].xml);
    expect(store.rows[1].note).toBe("pridaj FireRating pre dvere");

    const d = await run({ action: "diff", ids: "CHAT-STENY" });
    expect(d.json).toMatchObject({ from_version: 1, to_version: 2, identical: false });
    expect(d.json.specs_changed[0].changes).toEqual(["+ requirement: attribute Name (required)"]);

    const v = await run({ action: "versions", ids: "CHAT-STENY" });
    expect(v.json.versions.map((x: { version: number }) => x.version)).toEqual([2, 1]);
  });

  it("odmietnutá dávka vráti kódy brány a kandidátov a nič neuloží", async () => {
    const { store, run } = setup();
    await run({ action: "create", code: "CHAT-STENY", title: "Steny", ops: specOps(U(1), U(2), U(3)) });
    const specId = (await run({ action: "get", ids: "CHAT-STENY" })).json.ids.specifications[0].id;
    const r = await run({
      action: "apply_ops",
      ids: "CHAT-STENY",
      ops: [{ kind: "facet.add", payload: { specId, section: "applicability", facetId: U(8), facet: { type: "entity", name: { kind: "equals", value: "IFCWALLL" } } } }],
    });
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ saved: false, refused: true });
    expect(r.json.issues[0].code).toMatch(/^GATE-/);
    expect(r.json.issues[0].path).toBeTruthy();
    expect(r.json.issues[0].candidates).toContain("IfcWall");
    expect(store.rows).toHaveLength(1);
  });

  it("zlý tvar operácie je tiež odmietnutie bez zápisu", async () => {
    const { store, run } = setup();
    await run({ action: "create", code: "CHAT-STENY", title: "Steny", ops: specOps(U(1), U(2), U(3)) });
    const r = await run({ action: "apply_ops", ids: "CHAT-STENY", ops: [{ kind: "spec.nenajdem", payload: {} }] });
    expect(r.isError).toBe(true);
    expect(r.json.refused).toBe(true);
    expect(store.rows).toHaveLength(1);
  });

  it("knižničná snímka apply_ops odmietne s radou create derived_from; odvodená kópia ide upraviť", async () => {
    const { store, run } = setup();
    await seedLibrary(store);
    const r = await run({ action: "apply_ops", ids: "ER-0101_ARCH", ops: [{ kind: "doc.setInfo", payload: { field: "title", value: "x" } }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("derived_from='ER-0101_ARCH'");
    expect(store.rows).toHaveLength(1);

    const g = await run({ action: "get", ids: "ER-0101_ARCH" });
    expect(g.json).toMatchObject({ origin: "library", library_source: "assetin-library@abc:zadanie/x.md" });
    expect(g.json.label).toContain("len na čítanie");

    const c = await run({ action: "create", code: "CHAT-ER0101", derived_from: "ER-0101_ARCH" });
    expect(c.isError).toBe(false);
    const g2 = await run({ action: "get", ids: "CHAT-ER0101" });
    expect(g2.json.derived_from).toEqual({ code: "ER-0101_ARCH", version: 1 });
    expect(g2.json.origin).toBe("chat");
    expect(g2.json.note).toBe("Odvodené z ER-0101_ARCH v1");

    const a = await run({ action: "apply_ops", ids: "CHAT-ER0101", ops: [{ kind: "doc.setInfo", payload: { field: "version", value: "1.1" } }] });
    expect(a.isError).toBe(false);
    expect(a.json.version).toBe(2);
    // snímka ostala nedotknutá
    expect((await store.version(store.docs[0].id))?.version).toBe(1);
    expect(store.rows.filter((v) => v.document_id === store.docs[0].id)).toHaveLength(1);
  });

  it("derived_from smie len knižničné IDS", async () => {
    const { run } = setup();
    await run({ action: "create", code: "CHAT-STENY", title: "Steny", ops: specOps(U(1), U(2), U(3)) });
    const r = await run({ action: "create", code: "KOPIA", derived_from: "CHAT-STENY" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("knižničnému");
  });

  it("konflikt: base_version nie je posledná", async () => {
    const { run } = setup();
    await run({ action: "create", code: "CHAT-STENY", title: "Steny", ops: specOps(U(1), U(2), U(3)) });
    const op = (v: string) => [{ kind: "doc.setInfo", payload: { field: "version", value: v } }];
    expect((await run({ action: "apply_ops", ids: "CHAT-STENY", ops: op("2") })).isError).toBe(false);
    const r = await run({ action: "apply_ops", ids: "CHAT-STENY", base_version: 1, ops: op("3") });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Konflikt verzie");
    expect(r.text).toContain("diff");
  });

  it("create: xml musí prejsť auditom, kód je jedinečný, presne jeden zdroj", async () => {
    const { store, run } = setup();
    const bad = await run({ action: "create", code: "ZLE", xml: "<x/>" });
    expect(bad.isError).toBe(true);
    expect(bad.json.refused).toBe(true);
    expect(store.docs).toHaveLength(0);

    const ok = await run({ action: "create", code: "Z-XML", xml: LIBRARY_XML });
    expect(ok.isError).toBe(false);
    expect(store.docs[0]).toMatchObject({ code: "Z-XML", origin: "chat", title: "ER-0101 knižnica" });

    expect((await run({ action: "create", code: "Z-XML", xml: LIBRARY_XML })).text).toContain("už existuje");
    expect((await run({ action: "create", code: "x y", xml: LIBRARY_XML })).text).toContain("code:");
    expect((await run({ action: "create", code: "A", xml: LIBRARY_XML, ops: specOps(U(1), U(2), U(3)) })).text).toContain("presne jedno");
    expect((await run({ action: "create", code: "B" })).text).toContain("presne jedno");
  });

  it("odmietnuté create (ops) nezanechá dokument bez verzie", async () => {
    const { store, run } = setup();
    const r = await run({ action: "create", code: "CHAT-ZLE", title: "x", ops: specOps(U(1), U(2), U(3), "IFCWALLL") });
    expect(r.isError).toBe(true);
    expect(store.docs).toHaveLength(0);
  });

  it("zlyhaný zápis prvej verzie zruší dokument", async () => {
    const store = memoryIdsStore();
    const failing = { ...store, addVersion: async () => { throw new Error("DB padla"); } };
    const r = await execIdsTool("ids_document", { action: "create", code: "CHAT-X", title: "x", ops: specOps(U(1), U(2), U(3)) }, { store: failing });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("DB padla");
    expect(store.docs).toHaveLength(0);
  });

  it("open a from_viewer bez živého viewera povedia, že nie je nastavený", async () => {
    const { run } = setup();
    for (const action of ["open", "from_viewer"]) {
      const r = await run({ action, ids: "X" });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("LIVE_CHANNEL");
    }
  });

  it("apply_ops bez ops vráti schému operácií a príklady; neznámy kód vypíše existujúce", async () => {
    const { run } = setup();
    const s = await run({ action: "apply_ops", ids: "NIC" });
    expect(s.isError).toBe(false);
    expect(s.json.examples.length).toBeGreaterThan(0);
    expect(JSON.stringify(s.json.ops_schema)).toContain("spec.add");
    await run({ action: "create", code: "CHAT-STENY", title: "Steny", ops: specOps(U(1), U(2), U(3)) });
    const miss = await run({ action: "get", ids: "NIC" });
    expect(miss.isError).toBe(true);
    expect(miss.text).toContain("CHAT-STENY");
    expect((await run({ action: "zle" })).text).toContain("action:");
  });

  it("export vráti XML so súborom a hashom", async () => {
    const { run } = setup();
    await run({ action: "create", code: "CHAT-STENY", title: "Steny", ops: specOps(U(1), U(2), U(3)) });
    const r = await run({ action: "export", ids: "CHAT-STENY" });
    expect(r.json).toMatchObject({ filename: "CHAT-STENY-v1.ids", version: 1 });
    expect(r.json.xml).toContain("<ids");
  });

  it("opis tool nehovorí o záväznom behu a register má presne jeden tool", () => {
    expect(IDS_TOOL_DEFINITIONS.map((t) => t.name)).toEqual(["ids_document"]);
    expect(IDS_TOOL_DEFINITIONS[0].description).toContain("nie je záväzný");
  });
});

describe("describeDoc a diffDocs", () => {
  it("rozdiel podľa identifikátora špecifikácie, zmena kardinality a pridané/odobraté špecifikácie", async () => {
    const engine = await defaultIdsEngine();
    const a = describeDoc((await callIds(engine, "ids_read", { ids_xml: LIBRARY_XML })).doc);
    const b = structuredClone(a);
    b.specifications[0].occurs = "1-unbounded";
    b.specifications[0].requirements[0].optionality = "optional";
    b.specifications.push({ ...a.specifications[0], identifier: "IU-O-NEW", name: "Nová" });
    const d = diffDocs(a, b);
    expect(d.identical).toBe(false);
    expect(d.specs_added).toEqual(["IU-O-NEW"]);
    expect(d.specs_changed[0].spec).toBe("IU-O-storey");
    expect(d.specs_changed[0].changes).toContain("~ occurs: 0-unbounded -> 1-unbounded");
    expect(diffDocs(a, structuredClone(a)).identical).toBe(true);
  });
});
