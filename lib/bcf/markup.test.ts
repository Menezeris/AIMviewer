import { loadImage, createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";

import { documentReferenceToDto, documentView, documentWrite } from "./documents";
import { arrowHead, cloudArcs, MAX_MARKUP, markupHash, parseMarkup, parseMarkupParam, pinGeometry, MarkupParamError } from "./markup";
import { documentSnapshot, sha256Hex, type SnapshotSource } from "./snapshot";
import { snapshotKey, snapshotPlan } from "./snapshot-plan";
import { renderPdfRegion } from "./snapshot-render";
import type { DocumentInfo, TopicDocumentRow } from "./store";

const cloud = { type: "cloud", points: [{ x: 10, y: 10 }, { x: 40, y: 30 }] };

describe("značky: overenie", () => {
  it("platné tvary prejdú, súradnice sa orežú a zaokrúhlia", () => {
    const m = parseMarkup([
      { type: "cloud", points: [{ x: -5, y: 10.123 }, { x: 140, y: 30 }], text: "ignorované" },
      { type: "arrow", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
      { type: "text", points: [{ x: 5, y: 5 }], text: "  veľa \n  medzier   tu " },
      { type: "pin", points: [{ x: 50, y: 50 }] },
      { type: "pin", points: [{ x: 50, y: 50 }], text: "bod" },
    ]);
    expect(m).toEqual([
      { type: "cloud", points: [{ x: 0, y: 10.12 }, { x: 100, y: 30 }] },
      { type: "arrow", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
      { type: "text", points: [{ x: 5, y: 5 }], text: "veľa medzier tu" },
      { type: "pin", points: [{ x: 50, y: 50 }] },
      { type: "pin", points: [{ x: 50, y: 50 }], text: "bod" },
    ]);
  });

  it("neplatné tvary sa zahodia, nie celé pole", () => {
    const m = parseMarkup([
      null,
      "x",
      { type: "star", points: [{ x: 1, y: 1 }] },
      { type: "cloud", points: [{ x: 1, y: 1 }] },
      { type: "text", points: [{ x: 1, y: 1 }] },
      { type: "text", points: [{ x: 1, y: 1 }], text: "   " },
      { type: "arrow", points: [{ x: "1", y: 1 }, { x: 2, y: 2 }] },
      { type: "arrow", points: [{ x: NaN, y: 1 }, { x: 2, y: 2 }] },
      cloud,
    ]);
    expect(m).toEqual([cloud]);
    expect(parseMarkup("nie pole")).toEqual([]);
    expect(parseMarkup(undefined)).toEqual([]);
  });

  it("najviac 20 značiek a text do 200 znakov", () => {
    const many = Array.from({ length: 30 }, () => cloud);
    expect(parseMarkup(many)).toHaveLength(MAX_MARKUP);
    const t = parseMarkup([{ type: "text", points: [{ x: 1, y: 1 }], text: "a".repeat(500) }]);
    expect(t[0].text).toHaveLength(200);
  });

  it("parameter snímky: JSON do 8 kB, chybný je chyba požiadavky", () => {
    expect(parseMarkupParam(null)).toEqual([]);
    expect(parseMarkupParam(JSON.stringify([cloud, { type: "x" }]))).toEqual([cloud]);
    expect(() => parseMarkupParam("{nie json")).toThrow(MarkupParamError);
    expect(() => parseMarkupParam(JSON.stringify([{ type: "text", points: [{ x: 1, y: 1 }], text: "a".repeat(9000) }]))).toThrow(MarkupParamError);
  });

  it("hash: bez značiek null, stabilný, závisí od tvaru aj textu", () => {
    expect(markupHash(null)).toBeNull();
    expect(markupHash([])).toBeNull();
    const a = markupHash([cloud as never]);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(markupHash(parseMarkup([cloud]))).toBe(a);
    expect(markupHash(parseMarkup([{ ...cloud, points: [{ x: 10, y: 10 }, { x: 40, y: 31 }] }]))).not.toBe(a);
    const t = (text: string) => markupHash(parseMarkup([{ type: "text", points: [{ x: 1, y: 1 }], text }]));
    expect(t("a")).not.toBe(t("b"));
  });
});

describe("značky: geometria", () => {
  it("obláčik: oblúky podľa vzorca, každý polkruh leží na hrane", () => {
    // 400 x 200 jednotiek: s = min(18, max(6, 200 / 4)) = 18, hrana 400 = 11 oblúkov (400 / 36 = 11,1), hrana 200 = 6.
    const arcs = cloudArcs(100, 100, 500, 300);
    expect(arcs).toHaveLength(2 * 11 + 2 * 6);
    const top = arcs.slice(0, 11);
    for (const a of top) {
      expect(a.cy).toBeCloseTo(100);
      expect(a.r).toBeCloseTo(400 / 11 / 2);
    }
    expect(top[0].cx - top[0].r).toBeCloseTo(100);
    expect(top[10].cx + top[10].r).toBeCloseTo(500);
    // Hrana hore: oblúk ide z ľavého bodu cez horný vrchol (uhol 3pi/2) k pravému.
    expect(top[0].a0).toBeCloseTo(Math.PI);
    expect(top[0].a1).toBeCloseTo(2 * Math.PI);
  });

  it("obláčik: malý obdĺžnik má aspoň jeden oblúk na hranu, s na dolnom strope 6", () => {
    const arcs = cloudArcs(0, 0, 10, 10);
    expect(arcs.length).toBeGreaterThanOrEqual(4);
    for (const a of arcs) expect(a.r).toBeGreaterThan(0);
    // Rohy v obrátenom poradí dávajú ten istý počet.
    expect(cloudArcs(500, 300, 100, 100)).toHaveLength(cloudArcs(100, 100, 500, 300).length);
  });

  it("šípka: trojuholník 22 x 22 s hrotom v cieli", () => {
    const [tip, l, r] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 })!;
    expect(tip).toEqual({ x: 100, y: 0 });
    expect(l.x).toBeCloseTo(78);
    expect(r.x).toBeCloseTo(78);
    expect(Math.abs(l.y - r.y)).toBeCloseTo(22);
    expect(arrowHead({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
  });

  it("pin: kruh r=12 24 nad hrotom, dotyčnice pod 60 stupňov", () => {
    const g = pinGeometry({ x: 300, y: 300 });
    expect(g.centre).toEqual({ x: 300, y: 276 });
    expect(g.a0).toBeCloseTo(Math.PI / 6);
    expect(g.a1).toBeCloseTo((5 * Math.PI) / 6);
    // Dotyčnica je kolmá na polomer: vzdialenosť hrot - bod dotyku = sqrt(24^2 - 12^2).
    expect(Math.hypot(g.from.x - 300, g.from.y - 300)).toBeCloseTo(Math.sqrt(24 * 24 - 12 * 12));
  });
});

/** Jednostranové biele PDF 842 x 595 bodov. */
function blankPdf(): Uint8Array {
  const content = "0.5 g 0 0 1 1 re f";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let s = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(s.length);
    s += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(s, "latin1"));
}

async function reds(png: Buffer) {
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  const isRed = (x: number, y: number) => {
    const i = (Math.round(y) * img.width + Math.round(x)) * 4;
    return d[i] > 180 && d[i + 1] < 90 && d[i + 2] < 90;
  };
  const count = (x0: number, y0: number, x1: number, y1: number) => {
    let n = 0;
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(img.height, y1); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(img.width, x1); x++) if (isRed(x, y)) n++;
    return n;
  };
  return { width: img.width, height: img.height, isRed, count };
}

describe("značky: render nad stranou PDF", () => {
  it("bez značiek je snímka rovnaká ako doteraz (spätná kompatibilita)", async () => {
    const a = await renderPdfRegion(blankPdf(), 1, null);
    const b = await renderPdfRegion(blankPdf(), 1, null, []);
    expect(Buffer.compare(a.png, b.png)).toBe(0);
  });

  it("šípka, obláčik, pin a text sa nakreslia červenou na správnom mieste", async () => {
    const r = await renderPdfRegion(blankPdf(), 1, null, [
      { type: "cloud", points: [{ x: 10, y: 10 }, { x: 40, y: 40 }] },
      { type: "arrow", points: [{ x: 60, y: 20 }, { x: 90, y: 20 }] },
      { type: "pin", points: [{ x: 70, y: 80 }], text: "A" },
      { type: "text", points: [{ x: 10, y: 90 }], text: "Oprav" },
    ]);
    const px = await reds(r.png);
    const sx = px.width / 100;
    const sy = px.height / 100;
    // Obrys obláčika: červené pixely na hornej hrane (pás okolo y = 10 %), ale nie vo vnútri.
    expect(px.count(12 * sx, 8 * sy, 38 * sx, 12 * sy)).toBeGreaterThan(200);
    expect(px.count(15 * sx, 20 * sy, 35 * sx, 30 * sy)).toBe(0);
    // Šípka: čiara aj plný hrot pri x = 90 %.
    expect(px.count(60 * sx, 19 * sy, 85 * sx, 21 * sy)).toBeGreaterThan(100);
    expect(px.count(86 * sx, 18 * sy, 90 * sx, 22 * sy)).toBeGreaterThan(50);
    // Pin: kvapka nad bodom 70 %, 80 %.
    expect(px.count(68 * sx, 74 * sy, 72 * sx, 80 * sy)).toBeGreaterThan(100);
    // Text nad ľavým dolným rohom 10 %, 90 %.
    expect(px.count(10 * sx, 86 * sy, 20 * sx, 91 * sy)).toBeGreaterThan(40);
    // Mimo značiek biela strana.
    expect(px.count(45 * sx, 45 * sy, 55 * sx, 55 * sy)).toBe(0);
  });

  it("výrez s značkami: bitmapa ostáva podľa plánu, značka je posunutá s výrezom", async () => {
    const region = { x: 20, y: 20, width: 20, height: 10 };
    const r = await renderPdfRegion(blankPdf(), 1, region, [{ type: "arrow", points: [{ x: 22, y: 25 }, { x: 38, y: 25 }] }]);
    const plan = snapshotPlan([842, 595], region);
    const px = await reds(r.png);
    expect([px.width, px.height]).toEqual([plan.width, plan.height]);
    const f = plan.frame!;
    expect(px.count(f.x + 0.1 * f.width, f.y + f.height * 0.5 - 6, f.x + 0.8 * f.width, f.y + f.height * 0.5 + 6)).toBeGreaterThan(100);
  });
});

describe("značky: keš snímky", () => {
  const req = { document_id: "doc", page: 1, region: { x: 1, y: 2, width: 3, height: 4 } };
  const pdf = blankPdf();
  function source() {
    const cache = new Map<string, Buffer>();
    const seen: unknown[] = [];
    const src: SnapshotSource = {
      document: async (id) => ({ id, location: "https://x.supabase.co/storage/v1/object/public/documents/a.pdf", sha256: null }),
      fetchPdf: async () => pdf,
      cacheGet: async (k) => cache.get(k) ?? null,
      cachePut: async (k, png) => void cache.set(k, png),
      render: async (_p, _n, _r, markup) => {
        seen.push(markup);
        return { png: Buffer.from(`png${seen.length}`) };
      },
    };
    return { src, cache, seen, sha: sha256Hex(pdf) };
  }

  it("kľúč: bez značiek nezmenený, so značkami nesie hash", () => {
    const sha = "a".repeat(64);
    expect(snapshotKey(sha, 2, null)).toBe(`snapshots/${sha}/2-full.png`);
    expect(snapshotKey(sha, 2, null, "0123456789abcdef")).toBe(`snapshots/${sha}/2-full-m0123456789abcdef.png`);
    expect(() => snapshotKey(sha, 2, null, "zly")).toThrow();
  });

  it("rôzne značky = rôzny kľúč, rovnaké čítajú keš, bez značiek starý kľúč", async () => {
    const f = source();
    const m1 = parseMarkup([cloud]);
    const m2 = parseMarkup([{ type: "arrow", points: [{ x: 1, y: 1 }, { x: 9, y: 9 }] }]);
    const a = await documentSnapshot(f.src, { ...req, markup: m1 });
    const b = await documentSnapshot(f.src, { ...req, markup: m2 });
    const plain = await documentSnapshot(f.src, req);
    expect(new Set([a.key, b.key, plain.key]).size).toBe(3);
    expect(plain.key).toBe(`snapshots/${f.sha}/1-1_2_3_4.png`);
    expect(a.key).toContain(`-m${markupHash(m1)}.png`);
    const again = await documentSnapshot(f.src, { ...req, markup: m1, sha256: f.sha });
    expect(again.cached).toBe(true);
    expect(f.seen).toEqual([m1, m2, undefined]);
  });
});

const info: DocumentInfo = { id: "11111111-1111-4111-8111-111111111111", object_ref: "D1", name: "N", identification: "D.1", revision: "A", sha256: null, pages: 5, reference_page: null } as DocumentInfo;

describe("značky: odkaz témy a BCF API", () => {
  it("documentWrite uloží overené značky, bez strany ich zahodí, bez značiek null", () => {
    const row = documentWrite(info, { page: 2, markup: [cloud, { type: "x" }] }, "t", null);
    expect(row.markup).toEqual([cloud]);
    expect(documentWrite(info, { page: 2 }, "t", null).markup).toBeNull();
    expect(documentWrite(info, { page: 2, markup: [] }, "t", null).markup).toBeNull();
    expect(documentWrite({ ...info, pages: 3 }, { markup: [cloud] }, "t", null).markup).toBeNull();
  });

  const link = (markup: unknown): TopicDocumentRow =>
    ({ id: "g", task_id: "t", document_id: info.id, document_ref: "D.1", document_name: null, document_revision: "A", page: 2, region: null, markup, url: null, description: null, author: null, document_sha256: null, created_at: "" }) as TopicDocumentRow;

  it("GET document_references: markup len keď nie je prázdny", () => {
    expect(documentReferenceToDto(link([cloud] as never), "https://a.test").markup).toEqual([cloud]);
    expect("markup" in documentReferenceToDto(link(null), "https://a.test")).toBe(false);
    expect("markup" in documentReferenceToDto(link([]), "https://a.test")).toBe(false);
    expect("markup" in documentReferenceToDto(link([{ type: "x" }]), "https://a.test")).toBe(false);
  });

  it("detail témy: markup a markup_count, bez značiek bez polí", () => {
    const v = documentView(link([cloud] as never));
    expect(v.markup).toEqual([cloud]);
    expect(v.markup_count).toBe(1);
    expect("markup" in documentView(link(null))).toBe(false);
  });
});
