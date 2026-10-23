import { describe, expect, it } from "vitest";

import { normLabel, pairLabels, resolveLabels, type DrawingLink, type LabelObject } from "./drawing-labels";
import { applyOverrides, parseLinkEdit, type LinkOverride, type OverrideTarget } from "./drawing-link-overrides";
import { editDrawingLink, parseDraft, textInRegion, type LinkEditDeps } from "./drawing-link-edit";
import type { TextBlock } from "@/lib/llm/document-text";

const b = (t: string, x: number, y: number, w = 4, h = 0.5): TextBlock => ({ t, x, y, w, h });
const room: OverrideTarget = { ref: "1.05", guid: "g-105", name: "Kancelária", ifc_type: "IfcSpace", objectType: "space" };
const zoneT: OverrideTarget = { ref: "PU1", guid: "g-pu1", name: "PU N1.01", ifc_type: "IfcSpatialZone", objectType: "spatial_zone" };
const ov = (o: Partial<LinkOverride> & Pick<LinkOverride, "text" | "action">): LinkOverride => ({
  page: 1,
  bbox: null,
  target: null,
  ...o,
});

const asset = (ref: string): LabelObject => ({ id: ref, ref, guid: `g-${ref}`, name: ref, ifcType: "IfcDoor", objectType: "asset", onFloor: true });

describe("applyOverrides (D-160)", () => {
  const blocks = [b("1.01", 10, 10), b("PU", 30, 30), b("DD01", 50, 50, 0.3), b("08", 50.04, 50.3, 0.2)];
  const labels = pairLabels(blocks);
  const auto = resolveLabels(labels, [asset("DD01.08.0001"), asset("DD01.08.0002")]);

  it("bez ručných riadkov nič nemení", () => {
    expect(applyOverrides(auto, blocks, [])).toEqual(auto);
  });

  it("assign prepíše automatiku: kandidáti typu sa stanú jedným ručným cieľom", () => {
    const before = auto.find((l) => l.code === "DD01.08");
    expect(before?.status).toBe("candidates");
    const out = applyOverrides(auto, blocks, [ov({ text: normLabel("DD01 08"), action: "assign", target: { ...room, ref: "DD01.08.0002", objectType: "asset" } })]);
    const after = out.find((l) => l.code === "DD01.08");
    expect(after).toMatchObject({ status: "unique", via: "manual", kind: "element" });
    expect(after?.targets.map((t) => t.ref)).toEqual(["DD01.08.0002"]);
  });

  it("suppress odstráni odkaz", () => {
    const out = applyOverrides(auto, blocks, [ov({ text: "dd01 08", action: "suppress" })]);
    expect(out.find((l) => l.code === "DD01.08")).toBeUndefined();
  });

  it("assign priradí text, ktorý automatika nenašla (skratka zóny)", () => {
    const out = applyOverrides(auto, blocks, [ov({ text: "pu", action: "assign", target: zoneT })]);
    const l = out.find((x) => x.text === "PU") as DrawingLink;
    expect(l).toMatchObject({ kind: "zone", via: "manual", status: "unique", bbox: { x: 30, y: 30, width: 4, height: 0.5 } });
  });

  it("bbox viaže opravu na jedno miesto, text bez bbox na všetky výskyty", () => {
    const two = [b("PU", 30, 30), b("PU", 70, 70)];
    const here = applyOverrides([], two, [ov({ text: "pu", action: "assign", target: zoneT, bbox: { x: 30, y: 30, width: 4, height: 0.5 } })]);
    expect(here).toHaveLength(1);
    expect(here[0].bbox.x).toBe(30);
    expect(applyOverrides([], two, [ov({ text: "pu", action: "assign", target: zoneT })])).toHaveLength(2);
  });

  it("presnejší riadok (s bbox) vyhráva nad všeobecným", () => {
    const l = auto.find((x) => x.code === "DD01.08") as DrawingLink;
    const out = applyOverrides([l], blocks, [
      ov({ text: normLabel(l.text), action: "assign", target: room }),
      ov({ text: normLabel(l.text), action: "suppress", bbox: l.bbox }),
    ]);
    expect(out).toEqual([]);
  });

  it("assign mimo textovej vrstvy vytvorí odkaz z bbox", () => {
    const out = applyOverrides([], [], [ov({ text: "pu 1", action: "assign", target: zoneT, bbox: { x: 5, y: 5, width: 3, height: 1 } })]);
    expect(out).toHaveLength(1);
    expect(out[0].bbox).toEqual({ x: 5, y: 5, width: 3, height: 1 });
  });
});

describe("parseLinkEdit", () => {
  it("overí text, akciu, cieľ aj bbox", () => {
    expect(parseLinkEdit({ text: "PU", action: "assign" })).toMatch(/target/);
    expect(parseLinkEdit({ text: "PU", action: "zmaz" })).toMatch(/action/);
    expect(parseLinkEdit({ text: "", action: "clear" })).toMatch(/text/);
    expect(parseLinkEdit({ text: "PU", action: "clear", scope: "bbox" })).toMatch(/bbox/);
    expect(parseLinkEdit({ text: "PU", action: "assign", target: "PU1" })).toEqual({ text: "PU", action: "assign", target: "PU1", bbox: null });
  });
});

describe("editDrawingLink", () => {
  const blocks = [b("PU", 30, 30)];
  const writes: unknown[] = [];
  const deps = (over: Partial<LinkEditDeps> = {}): LinkEditDeps => ({
    blocks: async () => blocks,
    resolveTarget: async (i) => (i === "PU1" ? { ok: true, row: { id: "u1", object_ref: "PU1", name: "PU N1.01", ifc_guid: "g", object_type: "spatial_zone" } } : { ok: false, error: "Cieľ nenájdený" }),
    write: async (w) => {
      writes.push(w);
      return { replaced: 1 };
    },
    readDraft: async () => "viewer neodpovedal",
    ...over,
  });
  const doc = { id: "d1", object_ref: "D.1" };

  it("priradí, zapíše normalizovaný text a cieľ", async () => {
    writes.length = 0;
    const r = await editDrawingLink(doc, 2, { text: "PU", action: "assign", target: "PU1" }, deps());
    expect(r).toMatchObject({ ok: true, action: "assign", scope: "page", target: { object_ref: "PU1" }, replaced_previous: 1 });
    expect(writes[0]).toMatchObject({ documentId: "d1", page: 2, text: "pu", action: "assign" });
  });

  it("clear sa zapíše ako suppress, reset bez cieľa", async () => {
    writes.length = 0;
    await editDrawingLink(doc, 1, { text: "PU", action: "clear" }, deps());
    await editDrawingLink(doc, 1, { text: "PU", action: "reset" }, deps());
    expect(writes.map((w) => (w as { action: string }).action)).toEqual(["suppress", "reset"]);
  });

  it("neznámy text, neznámy cieľ ani chýbajúca strana nič nezapíšu", async () => {
    writes.length = 0;
    await expect(editDrawingLink(doc, 1, { text: "XYZ", action: "clear" }, deps())).rejects.toThrow(/nie je/);
    await expect(editDrawingLink(doc, 1, { text: "PU", action: "assign", target: "nic" }, deps())).rejects.toThrow(/nenájdený/);
    await expect(editDrawingLink(doc, null, { text: "PU", action: "clear" }, deps())).rejects.toThrow(/page/);
    expect(writes).toEqual([]);
  });

  it("from_draft vezme text, stranu, bbox a cieľ z viewera", async () => {
    writes.length = 0;
    const draft = { document_id: "d1", page: 3, text: "PU", bbox: { x: 30, y: 30, width: 4, height: 0.5 }, action: "assign" as const, target_guid: "PU1" };
    await editDrawingLink(doc, null, { from_draft: true }, deps({ readDraft: async () => draft }));
    expect(writes[0]).toMatchObject({ page: 3, text: "pu", bbox: draft.bbox });
    await expect(editDrawingLink(doc, null, { from_draft: true }, deps({ readDraft: async () => ({ ...draft, document_id: "iny" }) }))).rejects.toThrow(/inému/);
  });
});

describe("parseDraft", () => {
  const bbox = { x: 1, y: 1, width: 5, height: 1 };
  it("bez návrhu vráti vysvetlenie", () => {
    expect(parseDraft({})).toMatch(/návrh/);
    expect(parseDraft({ link_draft: { document_id: "d", page: 1, text: "PU", action: "clear" } })).toMatch(/neúplný/);
    expect(parseDraft({ link_draft: { document_id: "d", page: 1, text: "PU", bbox, action: "clear" } })).toMatchObject({ action: "clear", bbox });
  });

  it("cieľ priradenia je jediný vybraný prvok, inak vysvetlenie", () => {
    const link_draft = { document_id: "d", page: 1, text: null, bbox, action: "assign" };
    expect(parseDraft({ link_draft })).toMatch(/práve jeden/);
    expect(parseDraft({ link_draft, selection: { items: [{ guid: "a" }, { guid: "b" }] } })).toMatch(/práve jeden/);
    expect(parseDraft({ link_draft, selection: { items: [{ guid: "zona" }] } })).toMatchObject({ target_guid: "zona", text: "" });
  });
});

describe("textInRegion", () => {
  it("spojí riadky v oblasti zhora nadol a zľava doprava", () => {
    const blocks = [b("N1.01", 12, 20.6), b("PU", 10, 20.1), b("mimo", 50, 50)];
    expect(textInRegion(blocks, { x: 9, y: 20, width: 10, height: 2 })).toBe("PU N1.01");
    expect(textInRegion(blocks, { x: 80, y: 80, width: 5, height: 5 })).toBe("");
  });

  it("from_draft bez textu ho doplní z riadkov pod oblasťou; prázdna oblasť nič nezapíše", async () => {
    const w: unknown[] = [];
    const deps = (): LinkEditDeps => ({
      blocks: async () => [b("PU N1.01", 10, 10)],
      resolveTarget: async () => ({ ok: true, row: { id: "u", object_ref: "PU1", name: null, ifc_guid: "g", object_type: "spatial_zone" } }),
      write: async (x) => (w.push(x), { replaced: 0 }),
      readDraft: async () => ({ document_id: "d1", page: 1, text: "", bbox: { x: 9, y: 9, width: 10, height: 2 }, action: "assign", target_guid: "g" }),
    });
    await editDrawingLink({ id: "d1", object_ref: null }, null, { from_draft: true }, deps());
    expect(w[0]).toMatchObject({ text: "pu n1.01" });
    const empty = { ...deps(), readDraft: async () => ({ document_id: "d1", page: 1, text: "", bbox: { x: 80, y: 80, width: 2, height: 2 }, action: "assign" as const, target_guid: "g" }) };
    await expect(editDrawingLink({ id: "d1", object_ref: null }, null, { from_draft: true }, empty)).rejects.toThrow(/žiadny text/);
  });
});
