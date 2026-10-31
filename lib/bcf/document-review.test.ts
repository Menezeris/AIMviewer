import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { reviewState } from "./document-review";
import type { DocumentInfo, TopicDocumentRow } from "./store";
import { DOC_ID, DOCUMENTS, deps, memoryStore } from "./testing";
import { execBcfTool, type BcfDeps } from "./tools";

const run = async (name: string, args: Record<string, unknown>, d: BcfDeps) => {
  const res = await execBcfTool(name, args, d);
  return { ...res, json: res.isError ? null : JSON.parse(res.text) };
};

const A = "a".repeat(64);
const B = "b".repeat(64);
const link = (over: Partial<TopicDocumentRow> = {}): TopicDocumentRow => ({
  id: "l1", task_id: "t1", document_id: DOC_ID, document_ref: "D.1.1.09", document_name: null, document_revision: "A",
  page: 2, region: { x: 10, y: 10, width: 20, height: 20 }, markup: null, url: null, description: null, author: null,
  document_sha256: A, created_at: "2026-10-01T00:00:00Z", ...over,
});
const now = (over: Partial<DocumentInfo> = {}): DocumentInfo => ({ ...DOCUMENTS[0], revision: "B", sha256: B, pages: 2, ...over });

describe("reviewState (D-158 krok 6)", () => {
  it("nezmenená revízia: bez príznaku", () => {
    expect(reviewState(link({ document_revision: "B", document_sha256: B }), "open", now())).toMatchObject({ revision_changed: false, needs_review: false });
  });
  it("otvorená téma po novej revízii dostane needs_review, uzavretá a vybavená nie", () => {
    expect(reviewState(link(), "open", now()).needs_review).toBe(true);
    expect(reviewState(link(), "in_progress", now()).needs_review).toBe(true);
    expect(reviewState(link(), "closed", now())).toMatchObject({ revision_changed: true, needs_review: false });
    expect(reviewState(link(), "resolved", now()).needs_review).toBe(false);
  });
  it("potvrdenie platí len pre revíziu, ktorú človek videl; ďalšia revízia príznak vráti", () => {
    const ok = link({ reviewed_sha256: B, reviewed_revision: "B", reviewed_at: "2026-10-31T10:00:00Z", reviewed_by: "Samuel" });
    expect(reviewState(ok, "open", now()).needs_review).toBe(false);
    expect(reviewState(ok, "open", now({ revision: "C", sha256: "c".repeat(64) })).needs_review).toBe(true);
  });
  it("bez sha256 rozhoduje číslo revízie", () => {
    const l = link({ document_sha256: null });
    expect(reviewState(l, "open", now({ sha256: null })).needs_review).toBe(true);
    const ok = link({ document_sha256: null, reviewed_revision: "B", reviewed_at: "2026-10-31T10:00:00Z" });
    expect(reviewState(ok, "open", now({ sha256: null })).needs_review).toBe(false);
  });
  it("poloha neistá: chýbajúca strana, iný počet strán, iná veľkosť strany; inak istá", () => {
    expect(reviewState(link({ page: 3 }), "open", now()).position_uncertain).toBe(true);
    expect(reviewState(link({ anchor_pages: 5 }), "open", now()).position_reason).toContain("5 na 2");
    expect(reviewState(link({ anchor_page_size: [595, 842], page_size: [842, 595] }), "open", now()).position_uncertain).toBe(true);
    expect(reviewState(link({ anchor_pages: 2, anchor_page_size: [595, 842], page_size: [595.5, 842] }), "open", now())).toMatchObject({ position_uncertain: false });
    // starý odkaz bez kotvy: len chýbajúca strana
    expect(reviewState(link(), "open", now({ pages: 9 })).position_uncertain).toBe(false);
  });
});

describe("bcf_topic_list / bcf_topic: pripomienka po novej revízii", () => {
  const setup = () => {
    const m = memoryStore([{ title: "otvorená" }, { title: "uzavretá", status: "closed" }, { title: "bez dokumentu" }]);
    m.store.findDocument = async () => now({ revision: "C", sha256: B, pages: 3 });
    return m;
  };
  const base = { document_id: DOC_ID, document_ref: "D.1.1.09", document_name: null, document_revision: "A", page: 2, region: null, markup: null, url: null, description: null, author: null, document_sha256: A };

  it("detail nesie príznak, pôvodnú revíziu a polohu; uzavretá téma príznak nemá, pôvodné údaje ostávajú", async () => {
    const { store, rows } = setup();
    await store.addDocument({ ...base, task_id: rows[0].id, anchor_pages: 2 });
    await store.addDocument({ ...base, task_id: rows[1].id });
    const open = (await run("bcf_topic_list", { guid: "#1" }, deps({ store }))).json.topic.documents[0];
    expect(open).toMatchObject({
      revision: "A", revision_changed: true, revision_current: "C", needs_review: true,
      position_uncertain: true, original: { revision: "A", sha256: A, page: 2 },
    });
    const closed = (await run("bcf_topic_list", { guid: "#2" }, deps({ store }))).json.topic.documents[0];
    expect(closed).toMatchObject({ revision_changed: true, needs_review: false });
  });

  it("zoznam: needs_review v riadku a filter needs_review=true; context sa kombinuje", async () => {
    const { store, rows } = setup();
    await store.addDocument({ ...base, task_id: rows[0].id });
    await store.addDocument({ ...base, task_id: rows[1].id });
    const all = (await run("bcf_topic_list", {}, deps({ store }))).json.topics as { title: string; needs_review?: number }[];
    expect(all.find((t) => t.title === "otvorená")?.needs_review).toBe(1);
    expect(all.find((t) => t.title === "uzavretá")).not.toHaveProperty("needs_review");
    const f = (await run("bcf_topic_list", { needs_review: true }, deps({ store }))).json;
    expect(f.topics.map((t: { title: string }) => t.title)).toEqual(["otvorená"]);
    const none = (await run("bcf_topic_list", { needs_review: true, context: "3d" }, deps({ store }))).json;
    expect(none.count).toBe(0);
  });

  it("review_document zruší príznak (kto, kedy, revízia), uzavretie ani pôvodná revízia sa nemenia", async () => {
    const { store, rows, docs } = setup();
    const l = await store.addDocument({ ...base, task_id: rows[0].id });
    const r = await run("bcf_topic", { action: "update", guid: "#1", review_document: l.id, modified_by: "Samuel" }, deps({ store }));
    expect(r.json.documents_reviewed).toBe(1);
    expect(docs[0]).toMatchObject({ reviewed_by: "Samuel", reviewed_revision: "C", reviewed_sha256: B, document_revision: "A", document_sha256: A });
    const d = (await run("bcf_topic_list", { guid: "#1" }, deps({ store }))).json.topic.documents[0];
    expect(d).toMatchObject({ needs_review: false, reviewed: { by: "Samuel", revision: "C" } });
    expect((await run("bcf_topic_list", { needs_review: true }, deps({ store }))).json.count).toBe(0);
    // druhé potvrdenie toho istého odkazu je chyba, 'all' nič nenájde a nehlási chybu
    expect((await run("bcf_topic", { action: "update", guid: "#1", review_document: l.id }, deps({ store }))).isError).toBe(true);
    expect((await run("bcf_topic", { action: "update", guid: "#1", review_document: "all" }, deps({ store }))).json.documents_reviewed).toBe(0);
    expect((await run("bcf_topic", { action: "update", guid: "#1", review_document: "x" }, deps({ store }))).isError).toBe(true);
  });
});

describe("značky po novej revízii (D-158 krok 7, bod 4)", () => {
  const cloud = { type: "cloud", points: [{ x: 10, y: 10 }, { x: 30, y: 30 }] };
  it("odkaz so značkami ostáva nezmenený, príznaky ako bez nich", () => {
    const plain = reviewState(link({ anchor_pages: 2 }), "open", now({ pages: 3 }));
    const withMarkup = reviewState(link({ anchor_pages: 2, markup: [cloud] as never }), "open", now({ pages: 3 }));
    expect(withMarkup).toEqual(plain);
    expect(withMarkup).toMatchObject({ needs_review: true, position_uncertain: true });
  });
});
