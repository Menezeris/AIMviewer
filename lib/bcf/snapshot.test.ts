import { loadImage, createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";

import { documentSnapshot, isOwnStorageUrl, sha256Hex, SnapshotError, type SnapshotSource } from "./snapshot";
import { clampRect, snapshotKey, snapshotPlan, SNAPSHOT_LONG_SIDE, viewrect } from "./snapshot-plan";
import { renderPdfRegion, SnapshotRenderError } from "./snapshot-render";

/** Jednostranové PDF 842 x 595 bodov: modrá čiara, čierny text vľavo hore, sivý obdĺžnik vpravo dole. */
function testPdf(pages = 1): Uint8Array {
  const content =
    "0 0 1 RG 4 w 50 50 m 500 300 l S BT /F1 24 Tf 100 500 Td (AIM 1.01) Tj ET 0.5 g 600 50 200 100 re f";
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(" ");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
    ...Array.from(
      { length: pages },
      () => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${4 + pages} 0 R >> >> /Contents ${3 + pages} 0 R >>`,
    ),
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
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

async function pixels(png: Buffer) {
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  return {
    width: img.width,
    height: img.height,
    at: (x: number, y: number) => {
      const i = (Math.round(y) * img.width + Math.round(x)) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    },
    /** Počet tmavých pixelov v obdĺžniku (text, čiary). */
    dark: (x0: number, y0: number, x1: number, y1: number) => {
      let n = 0;
      for (let y = Math.round(y0); y < Math.round(y1); y++) {
        for (let x = Math.round(x0); x < Math.round(x1); x++) {
          const i = (y * img.width + x) * 4;
          if (data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80) n++;
        }
      }
      return n;
    },
  };
}

describe("snímka výrezu: plán", () => {
  it("oblasť s okolím, dlhšia strana 1500 px, rámik na oblasti", () => {
    const p = snapshotPlan([842, 595], { x: 40, y: 40, width: 20, height: 20 });
    expect(p.crop).toEqual({ x: 35, y: 35, width: 30, height: 30 });
    expect(Math.max(p.width, p.height)).toBe(SNAPSHOT_LONG_SIDE);
    // Rámik je v strede výrezu a má 2/3 jeho rozmeru.
    expect(p.frame!.x / p.width).toBeCloseTo(5 / 30, 3);
    expect(p.frame!.width / p.width).toBeCloseTo(20 / 30, 3);
  });

  it("celá strana bez rámika; oblasť pri okraji sa oreže na stranu", () => {
    const full = snapshotPlan([842, 595], null);
    expect(full.frame).toBeNull();
    expect(full.width).toBe(1500);
    expect(full.height).toBe(Math.round(595 * (1500 / 842)));
    const edge = snapshotPlan([842, 595], { x: 0, y: 90, width: 10, height: 10 });
    expect(edge.crop.x).toBe(0);
    expect(edge.crop.y + edge.crop.height).toBe(100);
  });

  it("malá oblasť má strop mierky", () => {
    const p = snapshotPlan([842, 595], { x: 50, y: 50, width: 0.1, height: 0.1 });
    expect(p.scale).toBe(8);
  });

  it("clampRect: mimo strany = null", () => {
    expect(clampRect({ x: 120, y: 0, width: 5, height: 5 })).toBeNull();
    expect(clampRect({ x: -5, y: 95, width: 10, height: 10 })).toEqual({ x: 0, y: 95, width: 5, height: 5 });
  });

  it("kľúč keše: sha256, strana, oblasť; zlé sha256 je chyba", () => {
    const sha = "a".repeat(64);
    expect(snapshotKey(sha, 2, { x: 10, y: 20.123, width: 30, height: 40 })).toBe(`snapshots/${sha}/2-10_20.12_30_40.png`);
    expect(snapshotKey(sha, 1, null)).toBe(`snapshots/${sha}/1-full.png`);
    expect(() => snapshotKey("../x", 1, null)).toThrow();
    expect(() => snapshotKey(sha, 0, null)).toThrow();
  });

  it("viewrect v bodoch od ľavého horného rohu", () => {
    expect(viewrect([842, 595], { x: 50, y: 0, width: 50, height: 50 })).toBe("421,0,421,297.5");
    expect(viewrect(null, { x: 50, y: 0, width: 50, height: 50 })).toBeNull();
    expect(viewrect([842, 595], null)).toBeNull();
  });
});

describe("snímka výrezu: render pdf.js v Node", () => {
  it("výrez s textom a rámikom (text = štandardné písmo cez BinaryDataFactory)", async () => {
    // Oblasť okolo textu "AIM 1.01" (100, 500 bodov zdola = 95 bodov zhora).
    const region = { x: 10, y: 10, width: 20, height: 10 };
    const r = await renderPdfRegion(testPdf(), 1, region);
    expect(r.pageSize).toEqual([842, 595]);
    const px = await pixels(r.png);
    const plan = snapshotPlan([842, 595], region);
    expect([px.width, px.height]).toEqual([plan.width, plan.height]);
    const f = plan.frame!;
    // Ľavý okraj rámika je červený.
    const [rr, gg, bb] = px.at(f.x, f.y + f.height / 2);
    expect(rr).toBeGreaterThan(180);
    expect(gg).toBeLessThan(90);
    expect(bb).toBeLessThan(90);
    // Text je vo výreze (tmavé pixely), pozadie mimo neho biele.
    expect(px.dark(f.x + 5, f.y + 5, f.x + f.width - 5, f.y + f.height - 5)).toBeGreaterThan(200);
    expect(px.at(2, 2)).toEqual([255, 255, 255]);
  });

  it("celá strana: modrá čiara a sivý obdĺžnik, bez rámika", async () => {
    const r = await renderPdfRegion(testPdf(), 1, null);
    const px = await pixels(r.png);
    const s = px.width / 842;
    // Sivý obdĺžnik 600..800 x 50..150 bodov zdola.
    const [g] = px.at(700 * s, (595 - 100) * s);
    expect(g).toBeGreaterThan(110);
    expect(g).toBeLessThan(140);
  });

  it("strana mimo dokumentu je chyba vstupu", async () => {
    await expect(renderPdfRegion(testPdf(2), 3, null)).rejects.toBeInstanceOf(SnapshotRenderError);
  });
});

function fakeSource(over: Partial<SnapshotSource> = {}) {
  const pdf = testPdf();
  const cache = new Map<string, Buffer>();
  const calls = { fetch: 0, render: 0 };
  const src: SnapshotSource = {
    document: async (id) => (id === "doc" ? { id, location: "https://x.supabase.co/storage/v1/object/public/documents/a.pdf", sha256: null } : null),
    fetchPdf: async () => {
      calls.fetch++;
      return pdf;
    },
    cacheGet: async (k) => cache.get(k) ?? null,
    cachePut: async (k, png) => {
      cache.set(k, png);
    },
    render: async () => {
      calls.render++;
      return { png: Buffer.from(`png${calls.render}`) };
    },
    ...over,
  };
  return { src, cache, calls, sha: sha256Hex(pdf) };
}

describe("snímka výrezu: keš", () => {
  const req = { document_id: "doc", page: 1, region: { x: 1, y: 2, width: 3, height: 4 } };

  it("prvá požiadavka renderuje a uloží, so známym sha256 ďalšia číta keš bez PDF", async () => {
    const f = fakeSource();
    const a = await documentSnapshot(f.src, req);
    expect(a.cached).toBe(false);
    expect(a.key).toBe(`snapshots/${f.sha}/1-1_2_3_4.png`);
    expect(f.cache.has(a.key)).toBe(true);
    const b = await documentSnapshot(f.src, { ...req, sha256: f.sha });
    expect(b.cached).toBe(true);
    expect(b.png.toString()).toBe("png1");
    expect(f.calls).toEqual({ fetch: 1, render: 1 });
  });

  it("sha256 dokumentu z ETL stačí na keš", async () => {
    const f = fakeSource();
    await documentSnapshot(f.src, req);
    const doc = f.src.document;
    f.src.document = async (id) => ({ ...(await doc(id))!, sha256: f.sha });
    expect((await documentSnapshot(f.src, req)).cached).toBe(true);
    expect(f.calls.fetch).toBe(1);
  });

  it("odkaz starej revízie bez snímky v keši: snímka z aktuálneho súboru s príznakom", async () => {
    const f = fakeSource();
    const r = await documentSnapshot(f.src, { ...req, sha256: "b".repeat(64) });
    expect(r.revision_changed).toBe(true);
    expect(r.sha256).toBe(f.sha);
  });

  it("zlyhaný zápis do keše snímku nezhodí; neznámy dokument je 404", async () => {
    const f = fakeSource({ cachePut: async () => Promise.reject(new Error("storage")) });
    expect((await documentSnapshot(f.src, req)).png.toString()).toBe("png1");
    await expect(documentSnapshot(f.src, { ...req, document_id: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(documentSnapshot(f.src, { ...req, document_id: "x" })).rejects.toBeInstanceOf(SnapshotError);
  });
});

describe("snímka výrezu: zdroj PDF", () => {
  it("len verejné úložisko projektu", () => {
    const base = "https://abc.supabase.co";
    expect(isOwnStorageUrl("https://abc.supabase.co/storage/v1/object/public/documents/a.pdf", base)).toBe(true);
    expect(isOwnStorageUrl("https://evil.example/storage/v1/object/public/documents/a.pdf", base)).toBe(false);
    expect(isOwnStorageUrl("https://abc.supabase.co/rest/v1/objects", base)).toBe(false);
    expect(isOwnStorageUrl("http://abc.supabase.co/storage/v1/object/public/a.pdf", base)).toBe(false);
    expect(isOwnStorageUrl("https://abc.supabase.co/storage/v1/object/public/a.pdf", undefined)).toBe(false);
  });
});
