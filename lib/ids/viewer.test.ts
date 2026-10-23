import { describe, expect, it } from "vitest";

import type { IdsOpenReq } from "../viewer-ids";

import { memoryIdsStore, type MemoryIdsStore } from "./testing";
import { execIdsTool, saveFromViewer, type IdsOpenOutcome, type IdsViewerDeps } from "./tools";

/** IDS z viewera (D-162 host PR2): `open`, `from_viewer`, zápis `IDS_SAVE`; motor je skutočný @ifc-lite/mcp, viewer je náhrada. */

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const specOps = (specId: string, facetA: string, facetR: string) => [
  { kind: "spec.add", payload: { specId, name: "Steny", ifcVersions: ["IFC4"] } },
  { kind: "facet.add", payload: { specId, section: "applicability", facetId: facetA, facet: { type: "entity", name: { kind: "equals", value: "IFCWALL" } } } },
  {
    kind: "facet.add",
    payload: {
      specId,
      section: "requirements",
      facetId: facetR,
      facet: { type: "property", propertySet: { kind: "equals", value: "Pset_WallCommon" }, baseName: { kind: "equals", value: "FireRating" } },
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

interface Harness {
  store: MemoryIdsStore;
  opens: IdsOpenReq[];
  /** Čo viewer odpovie na `view_state`. */
  state: { current: unknown };
  openOutcome: { current: IdsOpenOutcome };
  run: (args: Record<string, unknown>) => Promise<{ text: string; isError: boolean; json: Record<string, any> }>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function setup(): Harness {
  const store = memoryIdsStore();
  const opens: IdsOpenReq[] = [];
  const state: { current: unknown } = { current: {} };
  const openOutcome: { current: IdsOpenOutcome } = { current: { ok: true, issues: [] } };
  const viewer: IdsViewerDeps = {
    open: async (req) => {
      opens.push(req);
      return openOutcome.current;
    },
    viewState: async () => state.current,
  };
  const run = async (args: Record<string, unknown>) => {
    const r = await execIdsTool("ids_document", args, { store, viewer });
    let json: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      json = JSON.parse(r.text);
    } catch {
      /* chyba vstupu je obyčajný text */
    }
    return { ...r, json };
  };
  return { store, opens, state, openOutcome, run };
}

async function seedLibrary(store: MemoryIdsStore) {
  const doc = await store.createDocument({ code: "ER-0101_ARCH", title: "ER-0101 knižnica", origin: "library", library_source: "assetin-library@abc:zadanie/x.md" });
  await store.addVersion(doc.id, { xml: LIBRARY_XML, sha256: "h", title: doc.title, ids_version: "1.0", audit: null, author: "import", source: "import", note: null }, null);
}

/** Vytvorí pracovné IDS a vráti jeho XML (základ pre úpravu vo vieweri). */
async function seedChat(h: Harness, code = "CHAT-STENY") {
  await h.run({ action: "create", code, title: "Steny", ops: specOps(U(1), U(2), U(3)) });
  const g = await h.run({ action: "get", ids: code, include_xml: true });
  return g.json.xml as string;
}

const retitle = (xml: string, title: string) => xml.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);

describe("ids_document open (D-162)", () => {
  it("bez voľby otvorí v Studiu, s run alebo spec vo validácii; pošle kód, verziu a voľby", async () => {
    const h = setup();
    await seedChat(h);
    expect((await h.run({ action: "open", ids: "CHAT-STENY" })).json).toMatchObject({ opened: true, target: "studio", version: 1 });
    expect(h.opens[0]).toEqual({ code: "CHAT-STENY", target: "studio", version: 1 });
    const r = await h.run({ action: "open", ids: "CHAT-STENY", run: true });
    expect(r.json).toMatchObject({ target: "validation", run: true });
    expect(r.json.note).toContain("ids_local.validation.results");
    expect(h.opens[1]).toEqual({ code: "CHAT-STENY", target: "validation", version: 1, run: true });
  });

  it("spec: platí identifikátor aj názov (bez ohľadu na veľkosť), neznáma špecifikácia vypíše existujúce a nič neotvorí", async () => {
    const h = setup();
    await seedLibrary(h.store);
    expect((await h.run({ action: "open", ids: "ER-0101_ARCH", spec: "iu-o-storey", run: true })).isError).toBe(false);
    expect(h.opens.at(-1)).toMatchObject({ spec: "iu-o-storey", run: true, target: "validation" });
    expect((await h.run({ action: "open", ids: "ER-0101_ARCH", spec: "Podlažie" })).isError).toBe(false);
    h.opens.length = 0;
    const bad = await h.run({ action: "open", ids: "ER-0101_ARCH", spec: "neexistuje" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("IU-O-storey");
    expect(h.opens).toHaveLength(0);
  });

  it("run patrí len do validácie; neplatný target; verzia, ktorá neexistuje", async () => {
    const h = setup();
    await seedChat(h);
    const a = await h.run({ action: "open", ids: "CHAT-STENY", target: "studio", run: true });
    expect(a.isError).toBe(true);
    expect(a.text).toContain("target=validation");
    expect((await h.run({ action: "open", ids: "CHAT-STENY", target: "bcf" })).isError).toBe(true);
    expect((await h.run({ action: "open", ids: "CHAT-STENY", version: 9 })).text).toContain("nemá verziu 9");
    expect(h.opens).toHaveLength(0);
  });

  it("viewer, ktorý neodpovedal, je chyba s dôvodom, nie ticho 'otvorené'", async () => {
    const h = setup();
    await seedChat(h);
    h.openOutcome.current = { ok: false, reason: "viewer neodpovedal (nie je otvorený s ?live=)" };
    const r = await h.run({ action: "open", ids: "CHAT-STENY" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("viewer neodpovedal");
  });
});

describe("ids_document from_viewer (D-162)", () => {
  const studio = (xml: string, over: Record<string, unknown> = {}) => ({
    ids_local: { studio: { title: "Steny", specs: 1, code: "CHAT-STENY", version: 1, from_aim: true, dirty: true, xml, ...over } },
  });

  it("uloží rozpracované IDS zo Studia ako novú verziu so source=viewer nad verziou, z ktorej viewer vychádzal", async () => {
    const h = setup();
    const xml = await seedChat(h);
    h.state.current = studio(retitle(xml, "Steny po ručnej úprave"));
    const r = await h.run({ action: "from_viewer" });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ saved: true, code: "CHAT-STENY", version: 2, created: false, previous_version: 1 });
    expect(h.store.rows.at(-1)).toMatchObject({ version: 2, source: "viewer", author: "Viewer (AIM)" });
    expect(h.store.docs[0].title).toBe("Steny po ručnej úprave");
    // Claude potom upravuje ďalej nad poslednou verziou, bez konfliktu.
    const op = [{ kind: "doc.setInfo", payload: { field: "version", value: "3" } }];
    expect((await h.run({ action: "apply_ops", ids: "CHAT-STENY", ops: op })).json).toMatchObject({ saved: true, version: 3 });
  });

  it("neupravené IDS z AIM sa neukladá znova", async () => {
    const h = setup();
    const xml = await seedChat(h);
    h.state.current = studio(xml, { dirty: false });
    const r = await h.run({ action: "from_viewer" });
    expect(r.json).toMatchObject({ saved: false, version: 1 });
    expect(h.store.rows).toHaveLength(1);
  });

  it("konflikt: viewer vychádzal zo staršej verzie, zápis sa odmietne a ukáže zmeny v AIM", async () => {
    const h = setup();
    const xml = await seedChat(h);
    const op = [{ kind: "doc.setInfo", payload: { field: "version", value: "2" } }];
    expect((await h.run({ action: "apply_ops", ids: "CHAT-STENY", ops: op })).isError).toBe(false);
    h.state.current = studio(retitle(xml, "Moja úprava"), { version: 1 });
    const r = await h.run({ action: "from_viewer" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Konflikt verzie");
    expect(r.text).toContain("Zmeny v AIM");
    expect(h.store.rows).toHaveLength(2);
  });

  it("knižničná snímka sa neprepíše: uloží sa ako pracovná kópia s väzbou", async () => {
    const h = setup();
    await seedLibrary(h.store);
    h.state.current = { ids_local: { validation: { title: "ER", specs: 1, code: "ER-0101_ARCH", version: 1, from_aim: true, dirty: true, xml: retitle(LIBRARY_XML, "ER upravené") } } };
    const r = await h.run({ action: "from_viewer", target: "validation" });
    expect(r.json).toMatchObject({ saved: true, code: "ER-0101_ARCH-PRACOVNE", created: true, derived_from: "ER-0101_ARCH", version: 1 });
    expect(h.store.docs.find((d) => d.code === "ER-0101_ARCH")?.origin).toBe("library");
    expect(h.store.docs.find((d) => d.code === "ER-0101_ARCH-PRACOVNE")).toMatchObject({ origin: "chat" });
    expect(h.store.docs.find((d) => d.code === "ER-0101_ARCH-PRACOVNE")?.derived_from).toBeTruthy();
  });

  it("IDS, ktoré v AIM ešte nie je, dostane kód z názvu; ids=kód ho uloží pod týmto kódom", async () => {
    const h = setup();
    h.state.current = { ids_local: { studio: { title: "Miestnosti na prenájom", specs: 1, from_aim: false, dirty: true, xml: retitle(LIBRARY_XML, "Miestnosti na prenájom") } } };
    expect((await h.run({ action: "from_viewer" })).json).toMatchObject({ code: "MIESTNOSTI-NA-PRENAJOM", created: true, version: 1 });
    expect((await h.run({ action: "from_viewer", ids: "MOJE-IDS" })).json).toMatchObject({ code: "MOJE-IDS", created: true });
    expect((await h.run({ action: "from_viewer" })).json.code).toBe("MIESTNOSTI-NA-PRENAJOM-2");
  });

  it("chybné stavy: nič otvorené, XML nad stropom, starší fork bez XML, viewer neodpovedal", async () => {
    const h = setup();
    h.state.current = { ids_local: undefined };
    expect((await h.run({ action: "from_viewer" })).text).toContain("nie je otvorené");
    h.state.current = { ids_local: { studio: { title: "A", specs: 1, from_aim: false, dirty: true, xml_truncated: true } } };
    expect((await h.run({ action: "from_viewer" })).text).toContain("Uložiť do AIM");
    h.state.current = { ids_local: { studio: { title: "A", specs: 1, from_aim: false, dirty: true } } };
    expect((await h.run({ action: "from_viewer" })).text).toContain("neposlal XML");
    h.state.current = "viewer neodpovedal (nie je otvorený s ?live=)";
    expect((await h.run({ action: "from_viewer" })).text).toContain("viewer neodpovedal");
    expect(h.store.docs).toHaveLength(0);
  });

  it("XML, ktoré neprejde auditom, sa neuloží", async () => {
    const h = setup();
    h.state.current = { ids_local: { studio: { title: "A", specs: 0, from_aim: false, dirty: true, xml: "<ids/>" } } };
    const r = await h.run({ action: "from_viewer" });
    expect(r.isError).toBe(true);
    expect(h.store.docs).toHaveLength(0);
  });
});

describe("saveFromViewer (D-162, route /api/ids)", () => {
  it("existujúce pracovné IDS bez base_version sa neprepíše naslepo", async () => {
    const h = setup();
    const xml = await seedChat(h);
    await expect(saveFromViewer({ store: h.store }, { xml: retitle(xml, "X"), code: "CHAT-STENY" })).rejects.toThrow("base_version");
    expect(h.store.rows).toHaveLength(1);
  });

  it("nové IDS s kódom, ktorý už v AIM nie je (zmazaný), vznikne znova pod ním", async () => {
    const h = setup();
    const out = await saveFromViewer({ store: h.store }, { xml: LIBRARY_XML, code: "STARE-IDS", base_version: 4 });
    expect(out).toMatchObject({ code: "STARE-IDS", version: 1, created: true });
  });
});
