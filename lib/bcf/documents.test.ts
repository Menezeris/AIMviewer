import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { handleBcfApi, PROJECT_ID, type BcfApiContext } from "./api";
import {
  documentLabel,
  documentReferenceToDto,
  documentUrl,
  documentWrite,
  parseDocumentArg,
  parseDocumentReferenceDto,
  regionArg,
  TopicDocumentError,
} from "./documents";
import type { DocumentInfo, TopicDocumentRow } from "./store";
import { DOC_ID, DOCUMENTS, G1, deps, memoryStore } from "./testing";
import { execBcfTool, type BcfDeps } from "./tools";

const ORIGIN = "https://aim.example";
const INFO: DocumentInfo = {
  id: DOCUMENTS[0].id,
  object_ref: DOCUMENTS[0].object_ref,
  name: DOCUMENTS[0].name,
  identification: DOCUMENTS[0].identification,
  revision: DOCUMENTS[0].revision,
  pages: DOCUMENTS[0].pages,
  reference_page: null,
};

const run = async (name: string, args: Record<string, unknown>, d: BcfDeps) => {
  const res = await execBcfTool(name, args, d);
  return { ...res, json: res.isError ? null : JSON.parse(res.text) };
};

const row = (over: Partial<TopicDocumentRow> = {}): TopicDocumentRow => ({
  id: "22222222-2222-4222-8222-000000000009",
  task_id: "t",
  document_id: DOC_ID,
  document_ref: "D.1.1.09",
  document_name: "Pôdorys 1NP",
  document_revision: "B",
  page: 2,
  region: { x: 50, y: 0, width: 50, height: 25.5 },
  markup: null,
  url: null,
  description: null,
  author: "a",
  created_at: "2026-10-22T00:00:00Z",
  ...over,
});

describe("argument document (chat, D-158)", () => {
  it("objekt aj samotný kód; strana len celé číslo od 1", () => {
    expect(parseDocumentArg("D.1.1.09")).toEqual({ id_or_ref: "D.1.1.09" });
    expect(parseDocumentArg({ id_or_ref: " DOC.1NP ", page: 2, description: " trhlina " })).toEqual({
      id_or_ref: "DOC.1NP",
      page: 2,
      region: undefined,
      description: "trhlina",
    });
    expect(() => parseDocumentArg({ page: 1 })).toThrow(TopicDocumentError);
    expect(() => parseDocumentArg({ id_or_ref: "x", page: 0 })).toThrow(/page/);
    expect(() => parseDocumentArg({ id_or_ref: "x", page: 1.5 })).toThrow(/page/);
  });

  it("oblasť ako open_drawing region: orezaná do strany, celá mimo strany je chyba", () => {
    expect(regionArg(undefined)).toBeNull();
    expect(regionArg({ x: 90, y: -10, width: 20, height: 30 })).toEqual({ x: 90, y: 0, width: 10, height: 20 });
    expect(() => regionArg({ x: 120, y: 0, width: 10, height: 10 })).toThrow(/region/);
    expect(() => regionArg({ x: "a", y: 0, width: 10, height: 10 })).toThrow(/region/);
  });

  it("strana: z odkazu na časť, overená voči počtu strán; oblasť bez strany len pri jednej strane", () => {
    expect(documentWrite(INFO, { page: 1 }, "t", "a")).toMatchObject({
      task_id: "t",
      document_id: DOC_ID,
      document_ref: "D.1.1.09",
      document_revision: "B",
      page: 1,
      region: null,
    });
    expect(documentWrite({ ...INFO, reference_page: 2 }, {}, "t", "a").page).toBe(2);
    expect(() => documentWrite(INFO, { page: 3 }, "t", "a")).toThrow(/2 strán/);
    expect(() => documentWrite(INFO, { region: { x: 0, y: 0, width: 10, height: 10 } }, "t", "a")).toThrow(/potrebuje page/);
    expect(documentWrite({ ...INFO, pages: 1 }, { region: { x: 0, y: 0, width: 10, height: 10 } }, "t", "a").page).toBe(1);
    // Bez extrahovaného textu počet strán nepoznáme: strana sa neoveruje.
    expect(documentWrite({ ...INFO, pages: null }, { page: 40 }, "t", "a").page).toBe(40);
  });
});

describe("BCF DocumentReference (D-158)", () => {
  it("opis a adresa nesú kód, revíziu, stranu a oblasť; #page podľa RFC 8118", () => {
    expect(documentLabel(row())).toBe("D.1.1.09 (rev. B), strana 2, oblasť x 50 %, y 0 %, 50 x 25,5 %");
    expect(documentUrl(`${ORIGIN}/`, row())).toBe(`${ORIGIN}/drawing/${DOC_ID}?page=2&region=50_0_50_25.5#page=2`);
    expect(documentUrl(ORIGIN, row({ page: null, region: null }))).toBe(`${ORIGIN}/drawing/${DOC_ID}`);
    expect(documentReferenceToDto(row({ description: "trhlina" }), ORIGIN)).toEqual({
      guid: row().id,
      url: `${ORIGIN}/drawing/${DOC_ID}?page=2&region=50_0_50_25.5#page=2`,
      description: "D.1.1.09 (rev. B), strana 2, oblasť x 50 %, y 0 %, 50 x 25,5 %: trhlina",
    });
    expect(documentReferenceToDto(row({ document_id: null, url: "https://cde/x.pdf" }), ORIGIN).url).toBe("https://cde/x.pdf");
  });

  it("vlastná adresa sa rozloží späť, cudzia ostane ako url", () => {
    const own = parseDocumentReferenceDto({ url: documentUrl(ORIGIN, row()), description: "d" }, ORIGIN);
    expect(own).toEqual({ document_id: DOC_ID, page: 2, region: { x: 50, y: 0, width: 50, height: 25.5 }, url: null, description: "d" });
    expect(parseDocumentReferenceDto({ url: `/drawing/${DOC_ID}#page=3` }, ORIGIN)).toMatchObject({ document_id: DOC_ID, page: 3 });
    const foreign = parseDocumentReferenceDto({ url: `https://other.example/drawing/${DOC_ID}?page=2` }, ORIGIN);
    expect(foreign).toMatchObject({ document_id: null, url: `https://other.example/drawing/${DOC_ID}?page=2` });
    expect(() => parseDocumentReferenceDto({ document_guid: "x" }, ORIGIN)).toThrow(/document_guid/);
    expect(() => parseDocumentReferenceDto({}, ORIGIN)).toThrow(/url/);
  });
});

describe("bcf_topic a bcf_topic_list s dokumentom", () => {
  it("create s document: téma má odkaz a pripravené open_drawing; chybný dokument tému nezaloží", async () => {
    const { store, rows, docs } = memoryStore();
    const d = deps({ store });
    const bad = await run("bcf_topic", { action: "create", title: "x", document: { id_or_ref: "NEMA" }, capture_view: false }, d);
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/NEMA/);
    expect(rows).toHaveLength(0);

    const r = await run(
      "bcf_topic",
      {
        action: "create",
        title: "Chýba požiarna klapka",
        document: { id_or_ref: "D.1.1.09", page: 2, region: { x: 50, y: 0, width: 50, height: 50 }, description: "pri šachte" },
        target_ids_or_refs: ["SN02.01.0001"],
        capture_view: false,
      },
      d,
    );
    expect(r.isError).toBe(false);
    expect(r.json.topic).toMatchObject({ number: 1, components: 1, documents: 1 });
    expect(r.json.document).toMatchObject({
      document_id: DOC_ID,
      page: 2,
      label: "D.1.1.09 (rev. B), strana 2, oblasť x 50 %, y 0 %, 50 x 50 %",
      open_drawing: { document_id: DOC_ID, page: 2, region: { x: 50, y: 0, width: 50, height: 50 }, in_viewer: true },
    });
    expect(r.json.hint).toMatch(/open_drawing/);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ task_id: rows[0].id, author: "Claude (MCP)", description: "pri šachte" });
  });

  it("update pridá a zmaže odkaz, zmena posunie modified_by; odkaz na časť dokumentu nesie jeho stranu", async () => {
    const { store, rows, docs } = memoryStore([{ title: "t" }]);
    const d = deps({ store });
    const a = await run("bcf_topic", { action: "update", guid: "#1", document: "REF.1NP.2", modified_by: "Samuel" }, d);
    expect(a.json.document).toMatchObject({ document_id: DOC_ID, page: 2 });
    expect(rows[0].modified_by).toBe("Samuel");
    await run("bcf_topic", { action: "update", guid: "#1", document: { id_or_ref: DOC_ID, page: 1 } }, d);
    expect(docs).toHaveLength(2);
    const one = await run("bcf_topic", { action: "update", guid: "#1", remove_document: docs[0].id }, d);
    expect(one.json.documents_removed).toBe(1);
    expect(docs.map((x) => x.page)).toEqual([1]);
    expect((await run("bcf_topic", { action: "update", guid: "#1", remove_document: docs[0].id.replace(/.$/, "f") }, d)).isError).toBe(true);
    expect((await run("bcf_topic", { action: "update", guid: "#1", remove_document: "x" }, d)).isError).toBe(true);
    expect((await run("bcf_topic", { action: "update", guid: "#1", remove_document: "all" }, d)).json.documents_removed).toBe(1);
    expect(docs).toHaveLength(0);
  });

  it("zoznam: filter dokument a strana, počty odkazov a detail s odkazmi", async () => {
    const { store } = memoryStore([{ title: "a" }, { title: "b" }, { title: "c" }]);
    const d = deps({ store });
    await run("bcf_topic", { action: "update", guid: "#1", document: { id_or_ref: "D.1.1.09", page: 1 } }, d);
    await run("bcf_topic", { action: "update", guid: "#2", document: { id_or_ref: "D.1.1.09", page: 2 } }, d);
    const all = await run("bcf_topic_list", {}, d);
    expect(all.json.topics.map((t: { number: number; documents?: number }) => [t.number, t.documents])).toEqual([
      [3, undefined],
      [2, 1],
      [1, 1],
    ]);
    const onDoc = await run("bcf_topic_list", { document: "DOC.1NP" }, d);
    expect(onDoc.json.count).toBe(2);
    expect(onDoc.json.by_status).toEqual({ open: 2 });
    const onPage = await run("bcf_topic_list", { document: "D.1.1.09", page: 2 }, d);
    expect(onPage.json.topics.map((t: { number: number }) => t.number)).toEqual([2]);
    expect((await run("bcf_topic_list", { document: "NEMA" }, d)).isError).toBe(true);
    const detail = await run("bcf_topic_list", { guid: "#2" }, d);
    expect(detail.json.topic.documents).toEqual([expect.objectContaining({ page: 2, open_drawing: expect.objectContaining({ page: 2 }) })]);
  });

  it("strop odkazov na tému", async () => {
    const { store } = memoryStore([{ title: "t" }]);
    const d = deps({ store });
    for (let i = 0; i < 20; i++) await run("bcf_topic", { action: "update", guid: "#1", document: "D.1.1.09" }, d);
    const over = await run("bcf_topic", { action: "update", guid: "#1", document: "D.1.1.09" }, d);
    expect(over.isError).toBe(true);
    expect(over.text).toMatch(/strop 20/);
  });
});

describe("BCF API document_references", () => {
  const P = `2.1/projects/${PROJECT_ID}`;
  const ctx = (d: BcfDeps, over: Partial<BcfApiContext> = {}): BcfApiContext => ({
    deps: d,
    user: "samuel",
    authenticated: true,
    writeEnabled: true,
    origin: ORIGIN,
    ...over,
  });
  const call = (c: BcfApiContext, method: string, path: string, body: unknown = null) => {
    const url = new URL(`${ORIGIN}/api/bcf/${path}`);
    return handleBcfApi({ method, segments: url.pathname.split("/").filter(Boolean).slice(2), query: url.searchParams, body }, c);
  };

  it("GET bez tokenu, POST a PUT s tokenom; vlastná adresa sa uloží ako dokument AIM, cudzia ako url", async () => {
    const { store, rows, docs } = memoryStore([{ title: "t", components: [G1] }]);
    const d = deps({ store });
    const base = `${P}/topics/${rows[0].id}/document_references`;
    const anon = ctx(d, { authenticated: false });
    expect((await call(anon, "GET", base)).body).toEqual([]);
    expect((await call(anon, "POST", base, { url: "https://x/y.pdf" })).status).toBe(401);

    const own = await call(ctx(d), "POST", base, { url: `${ORIGIN}/drawing/${DOC_ID}?page=2&region=10_20_30_40#page=2`, description: "pozri" });
    expect(own.status).toBe(201);
    expect(docs[0]).toMatchObject({ document_id: DOC_ID, document_ref: "D.1.1.09", page: 2, region: { x: 10, y: 20, width: 30, height: 40 }, url: null, author: "samuel" });
    expect(own.body).toMatchObject({ url: `${ORIGIN}/drawing/${DOC_ID}?page=2&region=10_20_30_40#page=2`, description: "D.1.1.09 (rev. B), strana 2, oblasť x 10 %, y 20 %, 30 x 40 %: pozri" });
    expect(rows[0].modified_by).toBe("samuel");

    // Návrat vlastného exportu: hlavička opisu sa neopakuje.
    const back = await call(ctx(d), "PUT", `${base}/${docs[0].id}`, own.body);
    expect(back.status).toBe(200);
    expect(docs[0].description).toBe("pozri");

    const foreign = await call(ctx(d), "POST", base, { url: "https://cde.example/D-11.pdf#page=4", description: "z Revizto" });
    expect(foreign.body).toMatchObject({ url: "https://cde.example/D-11.pdf#page=4", description: "https://cde.example/D-11.pdf#page=4: z Revizto" });
    expect(docs[1]).toMatchObject({ document_id: null, url: "https://cde.example/D-11.pdf#page=4", description: "z Revizto" });

    await call(ctx(d), "PUT", `${base}/${docs[1].id}`, foreign.body);
    expect(docs[1].description).toBe("z Revizto");

    const list = await call(anon, "GET", base);
    expect((list.body as unknown[]).length).toBe(2);
    expect((await call(ctx(d), "PUT", `${base}/22222222-2222-4222-8222-000000000099`, { url: "https://x" })).status).toBe(404);
    expect((await call(ctx(d), "POST", base, { document_guid: "abc" })).status).toBe(400);
    expect((await call(ctx(d), "DELETE", base)).status).toBe(405);
  });
});
