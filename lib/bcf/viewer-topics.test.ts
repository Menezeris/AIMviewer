import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DOC_ID, G1, G2, deps, memoryStore } from "./testing";
import { execBcfTool, type BcfDeps } from "./tools";
import { compactLocalTopics, localTopicsFromState } from "./viewer-local";

const GUID_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const GUID_B = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const OWN = `https://aim.example/drawing/${DOC_ID}?page=2&region=50_0_25_50#page=2`;

/** `view_state.bcf_local` tak, ako ho pošle fork (`describeLocalTopics`). */
const local = (topics: Record<string, unknown>[], count = topics.length) => ({ mode: "3d", bcf_local: { count, topics } });

const pdfTopic = {
  guid: GUID_A,
  title: "Chýba popis miestnosti",
  description: "Na pôdoryse chýba 1.01",
  topic_type: "Remark",
  topic_status: "Open",
  priority: "High",
  assigned_to: null,
  due_date: "2026-11-01T00:00:00Z",
  labels: ["PDF", "PDF", ""],
  creation_author: "Samuel",
  comments: [{ author: "Samuel", date: "2026-10-22T10:00:00Z", comment: "pozri vpravo hore" }, { comment: "" }],
  viewpoint: {
    guid: "vp",
    perspective_camera: { camera_view_point: { x: 1, y: 2, z: 3 }, camera_direction: { x: 0, y: 1, z: 0 }, camera_up_vector: { x: 0, y: 0, z: 1 }, field_of_view: 60 },
    components: { selection: [{ ifc_guid: G1 }, { ifc_guid: G2 }] },
  },
  document_references: [
    { url: OWN, description: "Pôdorys 1NP, strana 2, oblasť x 50 %, y 0 %, 25 x 50 %" },
    { url: "https://cde.example/D-11.pdf#page=4", description: "Revizto" },
  ],
};

const run = async (args: Record<string, unknown>, d: BcfDeps) => {
  const res = await execBcfTool("bcf_topic", { action: "from_viewer", ...args }, d);
  return { ...res, json: res.isError ? null : JSON.parse(res.text) };
};

describe("lokálne témy viewera (D-158)", () => {
  it("from_viewer uloží tému s tým istým guid, pohľadom, prvkami, komentárom a odkazmi na PDF", async () => {
    const { store, rows, docs } = memoryStore();
    const notify = vi.fn(async () => undefined);
    const d = deps({ store, notify, viewState: async () => local([pdfTopic]) });
    const r = await run({}, d);
    expect(r.isError).toBe(false);
    expect(r.json.saved).toEqual([expect.objectContaining({ guid: GUID_A, number: 1, components: 2, documents: 2 })]);
    expect(rows[0]).toMatchObject({
      id: GUID_A,
      title: "Chýba popis miestnosti",
      topic_type: "Remark",
      status: "open",
      priority: "High",
      due_date: "2026-11-01",
      labels: ["PDF"],
      author: "Samuel",
      components: [G1, G2],
      viewpoint: { guid: "vp", source: "bcf", bcf: { perspective_camera: expect.any(Object) } },
    });
    expect(rows[0].comments.map((c) => [c.author, c.comment])).toEqual([["Samuel", "pozri vpravo hore"]]);
    // Vlastná adresa -> dokument AIM s kódom a revíziou; cudzia ostane ako url.
    expect(docs[0]).toMatchObject({ task_id: GUID_A, document_id: DOC_ID, document_ref: "D.1.1.09", document_revision: "B", page: 2, region: { x: 50, y: 0, width: 25, height: 50 }, url: null });
    expect(docs[1]).toMatchObject({ document_id: null, url: "https://cde.example/D-11.pdf#page=4", description: "Revizto" });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("from_viewer uloží značky odkazu; neplatné zahodí, na cudzom odkaze ich nenesie (D-158 krok 7)", async () => {
    const cloud = { type: "cloud", points: [{ x: 50, y: 0 }, { x: 75, y: 50 }] };
    const topic = {
      ...pdfTopic,
      document_references: [
        { url: OWN, description: "x", markup: [cloud, { type: "text", points: [{ x: 60, y: 10 }] }, { type: "arrow", points: [{ x: 1, y: 2 }] }] },
        { url: "https://cde.example/D-11.pdf#page=4", description: "Revizto", markup: [cloud] },
        { url: `https://aim.example/drawing/${DOC_ID}?page=1`, description: "bez značiek" },
      ],
    };
    const { store, docs } = memoryStore();
    const r = await run({}, deps({ store, viewState: async () => local([topic]) }));
    expect(r.isError).toBe(false);
    expect(docs[0].markup).toEqual([cloud]);
    expect(docs[1].markup).toBeNull();
    expect(docs[2].markup).toBeNull();
    // Starší fork `markup` neposiela: správanie ako doteraz.
    const old = memoryStore();
    await run({}, deps({ store: old.store, viewState: async () => local([{ ...pdfTopic, guid: GUID_B }]) }));
    expect(old.docs[0].markup).toBeNull();
  });

  it("opakované uloženie nič nezdvojí; guids vyberie, neplatné a cudzie guid vynechá", async () => {
    const { store, rows } = memoryStore();
    const state = local([pdfTopic, { guid: GUID_B, title: "Druhá" }, { guid: "nie-uuid", title: "Z iného nástroja" }, { title: "bez guid" }, "x" as never]);
    const d = deps({ store, viewState: async () => state });
    const first = await run({ guids: [GUID_B.toUpperCase()] }, d);
    expect(first.json.saved.map((t: { guid: string }) => t.guid)).toEqual([GUID_B]);
    const all = await run({}, d);
    expect(all.json.saved.map((t: { guid: string }) => t.guid)).toEqual([GUID_A]);
    expect(all.json.skipped).toEqual([
      { guid: GUID_B, title: "Druhá", reason: "už je uložená ako #1" },
      { guid: "nie-uuid", title: "Z iného nástroja", reason: expect.stringMatching(/UUID/) },
    ]);
    expect(rows.map((r) => r.id)).toEqual([GUID_B, GUID_A]);
  });

  it("téma priradená Claudovi sa uloží bez spustenia session", async () => {
    const { store, rows } = memoryStore();
    const d = deps({ store, viewState: async () => local([{ guid: GUID_A, title: "Oprav", assigned_to: "Claude" }]) });
    const r = await run({}, d);
    expect(rows[0].session_url).toBeNull();
    expect(d.fired).toEqual([]);
    expect(r.json.session_note).toMatch(/start_session=true/);
  });

  it("prázdny viewer, nedostupný viewer a chýbajúci kanál", async () => {
    expect((await run({}, deps({ viewState: async () => ({ mode: "3d" }) }))).json).toMatchObject({ saved: [], local_in_viewer: 0 });
    const down = await run({}, deps({ viewState: async () => "viewer neodpovedal" }));
    expect(down.isError).toBe(true);
    expect(down.text).toMatch(/viewer neodpovedal/);
    expect((await run({}, deps())).isError).toBe(true);
  });

  it("súhrn pre get_viewer_state: počet, názvy a odkazy bez pohľadov", () => {
    expect(compactLocalTopics({ bcf_local: { count: 0, topics: [] } })).toBeUndefined();
    expect(compactLocalTopics(local([pdfTopic], 3))).toEqual({
      count: 3,
      topics: [{ guid: GUID_A, title: "Chýba popis miestnosti", status: "Open", documents: ["Pôdorys 1NP, strana 2, oblasť x 50 %, y 0 %, 25 x 50 %", "Revizto"], components: 2 }],
      note: expect.stringMatching(/from_viewer/),
    });
    // Nedôveryhodné tvary sa zahodia, dlhé texty orežú.
    const t = localTopicsFromState({ bcf_local: { topics: [{ guid: GUID_A, title: "x".repeat(500), viewpoint: [1], document_references: [{ url: 5 }] }] } });
    expect(t.topics[0]).toMatchObject({ title: "x".repeat(200), viewpoint: null, document_references: [] });
  });
});
