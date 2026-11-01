import { describe, expect, it } from "vitest";

import { aimStateSha256, checkImportRequest, importRequestFromContents, parseBasedOn, previewImport, type ImportContext, type ImportRequest } from "./import";
import { DEFAULT_AIM_NAMESPACE } from "./model";
import { sha256 } from "./sha256";
import { ASR, buildFixture, fixturePlan, G, PDF, VZT } from "./test-fixture";
import { validateIcdd } from "./validate";

/**
 * Import ICDD (D-181 dodatok "import"): export -> import roundtrip a pravidlá zápisu nad testovacím kontajnerom
 * (2 väzby prvok -> dokument v documents-elements s aim:relationshipId, ostatné vrstvy len na export).
 */

const REL_TERM = "11111111-1111-4111-8111-111111111111"; // VV.01.01.001 -> D.1.1.09 strana 3
const REL_DUCT = "22222222-2222-4222-8222-222222222222"; // PO.01 -> D.1.1.09
const O = { term: "o-term", duct: "o-duct", space: "o-space", d1: "d1", r3: "r3", r4: "r4" };

const zip = buildFixture();
const report = validateIcdd(zip);
const baseRequest = (): ImportRequest =>
  JSON.parse(JSON.stringify(importRequestFromContents(report.contents!, report, sha256(zip), "aim-small.icdd", DEFAULT_AIM_NAMESPACE, fixturePlan().versionID)));

const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({
  current: { ASR: 79, VZT: 11 },
  modelRevisions: [
    { model: "ASR", revision: 79, sha256: sha256(ASR) },
    { model: "VZT", revision: 11, sha256: sha256(VZT) },
    { model: "VZT", revision: 10, sha256: "e".repeat(64) },
  ],
  documents: [
    { id: O.d1, object_type: "document", file_sha256: sha256(PDF), referenced_document_id: null, page: null },
    { id: O.r3, object_type: "document_reference", file_sha256: null, referenced_document_id: O.d1, page: 3 },
    { id: O.r4, object_type: "document_reference", file_sha256: null, referenced_document_id: O.d1, page: 4 },
  ],
  guidNodes: new Map([
    [G.terminal, { object_id: O.term, object_type: "asset" }],
    [G.duct, { object_id: O.duct, object_type: "asset" }],
    [G.space, { object_id: O.space, object_type: "space" }],
  ]),
  copyGuids: new Map([
    [G.terminal, "VZT"],
    [G.duct, "VZT"],
    [G.cowl, "VZT"],
    [G.space, "ASR"],
  ]),
  aimLinks: [
    { id: REL_TERM, from_id: O.term, to_id: O.r3, source: "pdf_link (E4)", valid_until: null },
    { id: REL_DUCT, from_id: O.duct, to_id: O.d1, source: "doc_upload (D-036)", valid_until: null },
  ],
  ifcDocPairs: new Set(),
  fromObjectTypes: ["asset", "asset_type", "space", "floor"],
  plan: fixturePlan(),
  ...over,
});

const elaborated = (r: ImportRequest) => r.links.filter((l) => l.kind === "IsElaboratedBy");
const codes = (p: ReturnType<typeof previewImport>) => p.findings.map((f) => f.code);

describe("import ICDD (D-181 dodatok)", () => {
  it("export -> import: 0 zmien, väzby nájdené podľa aim:relationshipId, vrstvy len na export bez rozdielu", () => {
    const req = baseRequest();
    expect(req.linksets.map((l) => [l.layer, l.exchange])).toEqual([
      ["derived-spatial", "export-only"],
      ["documents-elements", "import"],
      ["documents-identity", "export-only"],
      ["federation", "export-only"],
    ]);
    expect(elaborated(req).map((l) => l.relationshipId).sort()).toEqual([REL_TERM, REL_DUCT]);
    expect(elaborated(req).every((l) => l.basedOn === "VZT=11")).toBe(true);
    const p = previewImport(req, ctx());
    expect(p.changes).toEqual([]);
    expect(p.counts).toMatchObject({ importable: 2, unchanged: 2, add: 0, close: 0 });
    expect(p.findings).toEqual([]);
    expect(p.diff?.same).toBe(true);
    expect(p.applicable).toBe(false);
  });

  it("cudzí nástroj pridá väzbu bez id (aj vo vlastnom linksete bez značky): add so source icdd", () => {
    const req = baseRequest();
    const l = elaborated(req)[0];
    req.links.push({ ...l, relationshipId: null, basedOn: null, source: "tool-x", from: { ...l.from, guid: G.duct }, to: { ...l.to, page: 4 } });
    req.links.push({ ...l, layer: "tool-x-links", relationshipId: null, basedOn: null, from: { ...l.from, guid: G.terminal }, to: { ...l.to, page: 4 } });
    req.linksets.push({ layer: "tool-x-links", exchange: null });
    const p = previewImport(req, ctx());
    expect(p.changes).toEqual([
      expect.objectContaining({ op: "add", from_id: O.duct, to_id: O.r4, replaces: null }),
      expect.objectContaining({ op: "add", from_id: O.term, to_id: O.r4, replaces: null }),
    ]);
    expect(p.applicable).toBe(true);
  });

  it("zmena väzby s tým istým id = uzavrieť starý riadok a vložiť nový (AIM vrstva sa neprepisuje)", () => {
    const req = baseRequest();
    const l = elaborated(req).find((x) => x.relationshipId === REL_DUCT)!;
    l.to = { ...l.to, page: 3 };
    const p = previewImport(req, ctx());
    expect(p.changes).toEqual([
      expect.objectContaining({ op: "close", id: REL_DUCT }),
      expect.objectContaining({ op: "add", from_id: O.duct, to_id: O.r3, replaces: REL_DUCT }),
    ]);
  });

  it("konflikty a neznáme konce sa nezapíšu, len nálezy", () => {
    const at = (mut: (r: ImportRequest) => void, c: Partial<ImportContext> = {}) => {
      const req = baseRequest();
      mut(req);
      const p = previewImport(req, ctx(c));
      expect(p.changes).toEqual([]);
      return codes(p);
    };
    const duct = (r: ImportRequest) => elaborated(r).find((x) => x.relationshipId === REL_DUCT)!;
    expect(at((r) => (duct(r).basedOn = "VZT=10"))).toContain("based_on_other_revision");
    expect(at(() => {}, { current: { ASR: 79, VZT: 12 }, modelRevisions: [...ctx().modelRevisions, { model: "VZT", revision: 12, sha256: "f".repeat(64) }] })).toContain("stale_revision");
    expect(at(() => {}, { modelRevisions: [{ model: "ASR", revision: 79, sha256: sha256(ASR) }] })).toContain("unknown_model_revision");
    expect(at((r) => (duct(r).from.guid = G.cowl))).toContain("element_not_in_aim");
    expect(at((r) => (duct(r).from.guid = "0000000000000000000000"))).toContain("unknown_global_id");
    expect(at(() => {}, { documents: ctx().documents.filter((d) => d.object_type !== "document") })).toContain("unknown_document");
    expect(at((r) => (duct(r).to.page = 9))).toContain("page_without_reference");
    expect(at((r) => (duct(r).to = { file: "ASR_v079.ifc", guid: G.space, ident: null, page: null }))).toContain("invalid_end_type");
    expect(at((r) => (duct(r).from.guid = G.space), { guidNodes: new Map([[G.space, { object_id: O.space, object_type: "document" }]]) })).toContain("invalid_end_type");
    expect(
      at(() => {}, { aimLinks: [{ id: REL_DUCT, from_id: O.duct, to_id: O.d1, source: "doc_upload (D-036)", valid_until: "2026-10-30T00:00:00Z" }, ctx().aimLinks[0]] }),
    ).toContain("relationship_closed");
    expect(at((r) => (duct(r).relationshipId = null), { aimLinks: [ctx().aimLinks[0]], ifcDocPairs: new Set([`${O.duct}|${O.d1}`]) })).toContain("already_in_ifc");
  });

  it("väzba AIM, ktorá v kontajneri chýba, je len nález (nič sa neuzatvára)", () => {
    const extra = { id: "33333333-3333-4333-8333-333333333333", from_id: O.space, to_id: O.d1, source: "pdf_link (E4)", valid_until: null };
    const p = previewImport(baseRequest(), ctx({ aimLinks: [...ctx().aimLinks, extra] }));
    expect(p.changes).toEqual([]);
    expect(p.findings).toEqual([expect.objectContaining({ code: "missing_in_container", key: extra.id })]);
    // kontajner bez importovateľného linksetu: AIM vrstva sa neporovnáva
    const req = baseRequest();
    req.links = req.links.filter((l) => l.layer !== "documents-elements");
    req.linksets = req.linksets.filter((l) => l.layer !== "documents-elements");
    expect(codes(previewImport(req, ctx()))).toEqual(["no_importable_linkset"]);
  });

  it("vrstvy len na export: zmena je nález, nie zápis; značka aim:exchange len obmedzuje", () => {
    const req = baseRequest();
    const d = req.links.find((l) => l.layer === "derived-spatial")!;
    d.role = "inside-changed";
    const p = previewImport(req, ctx());
    expect(p.changes).toEqual([]);
    expect(codes(p).filter((c) => c === "export_only_changed")).toHaveLength(2); // len v kontajneri + len v AIM
    expect(p.diff?.same).toBe(false);

    // značka "import" na exportnej vrstve nič neotvorí; IsElaboratedBy podstrčený do derived-spatial sa nezapíše
    const r2 = baseRequest();
    r2.linksets.find((l) => l.layer === "derived-spatial")!.exchange = "import";
    const e = elaborated(r2)[0];
    r2.links.push({ ...e, layer: "derived-spatial", relationshipId: null, from: { ...e.from, guid: G.duct }, to: { ...e.to, page: 4 } });
    const p2 = previewImport(r2, ctx());
    expect(p2.changes).toEqual([]);
    expect(codes(p2)).toEqual(expect.arrayContaining(["exchange_mark_mismatch", "export_only_changed"]));

    // značka "export-only" na importnej vrstve import zastaví
    const r3 = baseRequest();
    r3.linksets.find((l) => l.layer === "documents-elements")!.exchange = "export-only";
    elaborated(r3)[0].relationshipId = null;
    elaborated(r3)[0].to.page = 4;
    const p3 = previewImport(r3, ctx());
    expect(p3.changes).toEqual([]);
    expect(codes(p3)).toContain("exchange_mark_mismatch");

    // cudzia trieda v cudzom linksete
    const r4 = baseRequest();
    r4.links.push({ ...d, layer: "tool-x" });
    r4.linksets.push({ layer: "tool-x", exchange: null });
    expect(codes(previewImport(r4, ctx()))).toContain("unsupported_class");
  });

  it("kontajner s chybou kontroly ISO sa nedá zapísať", () => {
    const req = baseRequest();
    req.validation = { ok: false, errors: 1, warnings: 0, issues: [{ level: "error", code: "sha256", where: "x", message: "x" }] };
    elaborated(req)[0].relationshipId = null;
    elaborated(req)[0].to.page = 4;
    const p = previewImport(req, ctx());
    expect(p.changes).toHaveLength(1);
    expect(p.applicable).toBe(false);
    expect(codes(p)).toContain("validation_failed");
  });

  it("opakovaný import toho istého kontajnera po zápise je bez zmeny (idempotentný)", () => {
    const req = baseRequest();
    const l = elaborated(req)[0];
    req.links.push({ ...l, relationshipId: null, basedOn: null, from: { ...l.from, guid: G.duct }, to: { ...l.to, page: 4 } });
    const first = previewImport(req, ctx());
    const added = first.changes.find((c) => c.op === "add")!;
    if (added.op !== "add") throw new Error();
    const after = ctx({ aimLinks: [...ctx().aimLinks, { id: "44444444-4444-4444-8444-444444444444", from_id: added.from_id, to_id: added.to_id, source: "icdd:x", valid_until: null }] });
    const second = previewImport(req, after);
    expect(second.changes).toEqual([]);
    expect(second.aimStateSha256).not.toBe(first.aimStateSha256);
  });

  it("odtlačok stavu AIM, basedOn a kontrola tela", () => {
    expect(aimStateSha256(ctx())).toBe(aimStateSha256({ ...ctx(), aimLinks: [...ctx().aimLinks].reverse() }));
    expect(aimStateSha256(ctx())).not.toBe(aimStateSha256({ ...ctx(), current: { ASR: 79, VZT: 12 } }));
    expect(parseBasedOn("ASR=79;VZT=11")).toEqual({ ASR: 79, VZT: 11 });
    expect(checkImportRequest(baseRequest())).toBeNull();
    expect(checkImportRequest({ ...baseRequest(), containerSha256: "x" })).toMatch(/containerSha256/);
    expect(checkImportRequest({ ...baseRequest(), links: [{}] })).toMatch(/väzba/);
  });
});
