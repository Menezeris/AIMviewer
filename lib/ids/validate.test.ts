import { afterEach, describe, expect, it } from "vitest";

import { MINI_BUILDING_BYTES, guid } from "../engine/__fixtures__/mini-building";
import { clearEngineCache } from "../engine/cache";
import type { AimRef } from "../engine/join";
import { execEngineTool, type EngineDeps } from "../engine/tools";

import { resultRows } from "./runs";
import { memoryIdsStore, type MemoryIdsStore } from "./testing";

const STOREY_IDS = `<?xml version="1.0" encoding="UTF-8"?>
<ids xmlns="http://standards.buildingsmart.org/IDS" xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <info><title>Test podlaží</title><version>0.1</version></info>
  <specifications>
    <specification name="Podlažie" identifier="IU-O-storey" ifcVersion="IFC4">
      <applicability minOccurs="0" maxOccurs="unbounded">
        <entity><name><simpleValue>IFCBUILDINGSTOREY</simpleValue></name></entity>
      </applicability>
      <requirements>
        <attribute>
          <name><simpleValue>Name</simpleValue></name>
          <value><xs:restriction base="xs:string"><xs:pattern value="[0-9]{1,2}\\.(NP|PP)"/></xs:restriction></value>
        </attribute>
      </requirements>
    </specification>
    <specification name="Zóny" identifier="IU-O-zone" ifcVersion="IFC4">
      <applicability minOccurs="1" maxOccurs="unbounded">
        <entity><name><simpleValue>IFCZONE</simpleValue></name></entity>
      </applicability>
      <requirements><attribute><name><simpleValue>Name</simpleValue></name></attribute></requirements>
    </specification>
  </specifications>
</ids>`;

const fetchImpl = (async () => new Response(MINI_BUILDING_BYTES, { status: 200, headers: { etag: '"mini"' } })) as typeof fetch;
const AIM: Record<string, AimRef> = {
  [guid("SPA")]: { object_id: "11111111-1111-1111-1111-111111111111", object_ref: "1.01", name: "1.01", object_type: "space" },
};

function deps(store?: MemoryIdsStore, env: Record<string, string> = {}): EngineDeps {
  return {
    sources: () => [{ id: "MINI", label: "Mini", url: "https://example.test/mini.ifc" }],
    lookup: async (guids) => new Map(guids.filter((g) => AIM[g]).map((g) => [g, AIM[g]])),
    resolveTargets: async () => new Map(),
    env,
    fetchImpl,
    ids: store,
  };
}

async function seeded() {
  const store = memoryIdsStore();
  const doc = await store.createDocument({ code: "CHAT-PODLAZIA", title: "Podlažia z chatu", origin: "chat" });
  const v = await store.addVersion(doc.id, { xml: STOREY_IDS, sha256: "a".repeat(64), title: doc.title, ids_version: "0.1", audit: null, author: "t", source: "chat", note: null }, null);
  return { store, doc, v };
}

const run = async (input: Record<string, unknown>, d: EngineDeps) => {
  const res = await execEngineTool("ifc_ids_validate", input, d);
  return { ...res, json: res.isError ? null : JSON.parse(res.content) };
};

describe("ifc_ids_validate nad IDS v DB (D-162)", () => {
  afterEach(() => clearEngineCache());

  it("kód z DB, bez save nič neuloží a nehovorí o záväznom behu", async () => {
    const { store, v } = await seeded();
    const r = await run({ model: "MINI", ids: "CHAT-PODLAZIA" }, deps(store));
    expect(r.isError).toBe(false);
    expect(r.json.ids).toMatchObject({ id: "CHAT-PODLAZIA", origin: "chat", version: 1, sha256: v.sha256 });
    expect(r.json.specifications.map((s: { spec: string }) => s.spec)).toEqual(["IU-O-storey", "IU-O-zone"]);
    expect(store.runs).toHaveLength(0);
    expect(r.json.note).toContain("nič sa neuložilo");
    expect(r.json.note).not.toMatch(/Záväzný zaznamenaný/);
  });

  it("save=true uloží beh s ids_version_id, engine ifc-lite, trigger chat, binding false a riadky", async () => {
    const { store, v } = await seeded();
    const r = await run({ model: "MINI", ids: "CHAT-PODLAZIA", save: true }, deps(store));
    expect(r.isError).toBe(false);
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({
      ids_version_id: v.id,
      engine: "ifc-lite",
      trigger: "chat",
      model_label: "MINI",
      ids_title: "Podlažia z chatu",
      ids_version: "0.1",
      ids_source: "ids_document:CHAT-PODLAZIA@v1",
    });
    expect(store.runs[0].results_total).toBe(store.results.length);
    expect(store.runs[0].results_failed).toBe(store.results.filter((x) => x.status === "fail").length);
    // 2 podlažia (1 chyba v názve), povinná špecifikácia zón bez prvku = riadok bez ifc_guid
    const storeyRows = store.results.filter((x) => x.spec_identifier === "IU-O-storey");
    expect(storeyRows).toHaveLength(2);
    expect(storeyRows.map((x) => x.status).sort()).toEqual(["fail", "pass"]);
    expect(store.results.find((x) => x.spec_identifier === "IU-O-zone")).toMatchObject({ ifc_guid: null, status: "fail" });
    expect(r.json.saved).toMatchObject({ results: store.results.length });
    expect(r.json.note).toContain("binding=false");
  });

  it("version vyberie starší stav; neexistujúca verzia a neznámy kód sú chyby", async () => {
    const { store, doc } = await seeded();
    await store.addVersion(doc.id, { xml: STOREY_IDS.replace("Test podlaží", "Druhá"), sha256: "b".repeat(64), title: "Druhá", ids_version: "0.2", audit: null, author: "t", source: "chat", note: null }, 1);
    const v1 = await run({ model: "MINI", ids: "CHAT-PODLAZIA", version: 1 }, deps(store));
    expect(v1.json.ids.version).toBe(1);
    const last = await run({ model: "MINI", ids: "CHAT-PODLAZIA" }, deps(store));
    expect(last.json.ids.version).toBe(2);
    expect((await run({ model: "MINI", ids: "CHAT-PODLAZIA", version: 9 }, deps(store))).content).toContain("nemá verziu 9");
    const missing = await run({ model: "MINI", ids: "NIC" }, deps(store));
    expect(missing.isError).toBe(true);
    expect(missing.content).toContain("CHAT-PODLAZIA");
  });

  it("save s filtrom spec alebo pre IDS_SOURCES sa odmietne a nič sa neuloží", async () => {
    const { store } = await seeded();
    expect((await run({ model: "MINI", ids: "CHAT-PODLAZIA", save: true, spec: "IU-O-storey" }, deps(store))).content).toContain("spec nepoužívaj");
    const fb = deps(store, { IDS_SOURCES: JSON.stringify({ ZALOHA: "https://example.test/z.ids" }) });
    fb.fetchImpl = (async (url: string | URL | Request) =>
      String(url).endsWith("z.ids") ? new Response(STOREY_IDS) : new Response(MINI_BUILDING_BYTES, { headers: { etag: '"mini"' } })) as typeof fetch;
    const ok = await run({ model: "MINI", ids: "ZALOHA" }, fb);
    expect(ok.isError).toBe(false);
    expect(ok.json.ids.origin).toBeUndefined();
    expect((await run({ model: "MINI", ids: "ZALOHA", save: true }, fb)).content).toContain("save ukladá beh len pre IDS v AIM");
    expect((await run({ model: "MINI", ids: "ZALOHA", version: 1 }, fb)).content).toContain("IDS_SOURCES");
    expect(store.runs).toHaveLength(0);
  });
});

describe("resultRows", () => {
  it("zakázaný/nepoužiteľný prípad: spec bez prvkov a nepovinná nič nezapíše, povinná zapíše riadok bez guid", () => {
    const rows = resultRows(
      [
        { specification: { identifier: "A", name: "povinná" }, status: "fail", entityResults: [] },
        { specification: { identifier: "B", name: "nepovinná" }, status: "pass", entityResults: [] },
        {
          specification: { identifier: "C", name: "s prvkom" },
          status: "fail",
          entityResults: [
            { globalId: "g1", entityType: "IfcWall", passed: false, requirementResults: [{ status: "fail", failureReason: "chýba" }, { status: "pass" }] },
            { globalId: "g2", entityType: "IfcWall", passed: true, requirementResults: [] },
          ],
        },
      ],
      (g) => (g === "g1" ? "obj-1" : null),
    );
    expect(rows.map((r) => [r.spec_identifier, r.ifc_guid, r.status, r.object_id])).toEqual([
      ["A", null, "fail", null],
      ["C", "g1", "fail", "obj-1"],
      ["C", "g2", "pass", null],
    ]);
    expect(rows[1].reasons).toEqual(["chýba"]);
    expect(rows[2].reasons).toEqual([]);
  });
});
