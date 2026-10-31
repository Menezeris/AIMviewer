import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { handleBcfApi, PROJECT_ID, type BcfApiContext, type SnapshotOutcome } from "./api";
import { documentReferenceToDto, documentUrl, documentView, documentWrite, parseDocumentReferenceDto } from "./documents";
import type { SnapshotRequest } from "./snapshot";
import type { TopicDocumentRow } from "./store";
import { DOC_ID, DOCUMENTS, G1, deps, memoryStore } from "./testing";

const ORIGIN = "https://aim.example";
const P = `2.1/projects/${PROJECT_ID}`;
const SHA = "c".repeat(64);

const call = (c: BcfApiContext, method: string, path: string, body: unknown = null) => {
  const url = new URL(`${ORIGIN}/api/bcf/${path}`);
  return handleBcfApi({ method, segments: url.pathname.split("/").filter(Boolean).slice(2), query: url.searchParams, body }, c);
};

function setup(snapshot?: (r: SnapshotRequest) => Promise<SnapshotOutcome>) {
  const m = memoryStore([{ title: "pripomienka", components: [G1] }]);
  const topic = m.rows[0];
  const base = {
    task_id: topic.id,
    document_id: DOC_ID,
    document_ref: "D.1.1.09",
    document_name: "Pôdorys 1NP",
    document_revision: "B",
    markup: null,
    url: null,
    description: null,
    author: "a",
  };
  const ctx: BcfApiContext = {
    deps: deps({ store: m.store }),
    user: "samuel",
    authenticated: false,
    writeEnabled: false,
    origin: ORIGIN,
    ...(snapshot ? { snapshot } : {}),
  };
  return { ...m, topic, base, ctx };
}

describe("BCF API: snímka výrezu ako pohľad témy (D-158 krok 3)", () => {
  it("odkaz na stranu = pohľad so snímkou; snímka ide z renderu s revíziou odkazu", async () => {
    const asked: SnapshotRequest[] = [];
    const s = setup(async (r) => {
      asked.push(r);
      return { ok: true, png: Buffer.from("PNG"), revisionChanged: false };
    });
    const page = await s.store.addDocument({ ...s.base, page: 2, region: { x: 10, y: 20, width: 30, height: 40 }, document_sha256: SHA });
    // Celý dokument bez strany snímku nemá (nie je čo vyrezať).
    await s.store.addDocument({ ...s.base, page: null, region: null, document_sha256: null });
    const vps = (await call(s.ctx, "GET", `${P}/topics/${s.topic.id}/viewpoints`)).body as Record<string, unknown>[];
    // Bez kalibrácie a bez 3D pohľadu: náhľad zhora (BCF 3.0 chce kameru v každom pohľade).
    expect(vps).toEqual([{ guid: page.id, orthogonal_camera: expect.objectContaining({ camera_direction: { x: 0, y: 0, z: -1 } }), snapshot: { snapshot_type: "png" } }]);
    const one = await call(s.ctx, "GET", `${P}/topics/${s.topic.id}/viewpoints/${page.id}`);
    expect(one.body).toEqual(vps[0]);
    expect((await call(s.ctx, "GET", `${P}/topics/${s.topic.id}/viewpoints/${page.id}/selection`)).body).toEqual({ selection: [] });
    const snap = await call(s.ctx, "GET", `${P}/topics/${s.topic.id}/viewpoints/${page.id}/snapshot`);
    expect(snap.status).toBe(200);
    expect(snap.binary?.bytes.toString()).toBe("PNG");
    expect(snap.binary?.headers["Content-Type"]).toBe("image/png");
    expect(asked).toEqual([{ document_id: DOC_ID, page: 2, region: { x: 10, y: 20, width: 30, height: 40 }, sha256: SHA }]);
  });

  it("uložené značky idú do renderu a GET document_references ich vráti (D-158 krok 7)", async () => {
    const asked: SnapshotRequest[] = [];
    const s = setup(async (r) => {
      asked.push(r);
      return { ok: true, png: Buffer.from("PNG"), revisionChanged: false };
    });
    const cloud = { type: "cloud", points: [{ x: 10, y: 20 }, { x: 40, y: 60 }] };
    const marked = await s.store.addDocument({ ...s.base, page: 2, region: { x: 8, y: 18, width: 34, height: 44 }, markup: [cloud] as never, document_sha256: SHA });
    await call(s.ctx, "GET", `${P}/topics/${s.topic.id}/viewpoints/${marked.id}/snapshot`);
    expect(asked[0].markup).toEqual([cloud]);
    const refs = (await call(s.ctx, "GET", `${P}/topics/${s.topic.id}/document_references`)).body as Record<string, unknown>[];
    expect(refs[0].markup).toEqual([cloud]);
    // Odkaz bez značiek: odpoveď aj požiadavka ako predtým.
    const plain = await s.store.addDocument({ ...s.base, page: 1, region: null, document_sha256: SHA });
    await call(s.ctx, "GET", `${P}/topics/${s.topic.id}/viewpoints/${plain.id}/snapshot`);
    expect("markup" in asked[1]).toBe(false);
    const again = (await call(s.ctx, "GET", `${P}/topics/${s.topic.id}/document_references`)).body as Record<string, unknown>[];
    expect(again.filter((r) => "markup" in r)).toHaveLength(1);
  });

  it("3D pohľad témy ostáva prvý; chyba renderu sa vráti so stavom; bez renderu pohľady dokumentov nie sú", async () => {
    const s = setup(async () => ({ ok: false, status: 502, message: "PDF sa nedalo stiahnuť" }));
    s.topic.viewpoint = { guid: "vp-3d", source: "selection" };
    await s.store.update(s.topic.id, { viewpoint: s.topic.viewpoint });
    const page = await s.store.addDocument({ ...s.base, page: 1, region: null, document_sha256: null });
    const vps = (await call(s.ctx, "GET", `${P}/topics/${s.topic.id}/viewpoints`)).body as Record<string, unknown>[];
    expect(vps.map((v) => v.guid)).toEqual(["vp-3d", page.id]);
    const snap = await call(s.ctx, "GET", `${P}/topics/${s.topic.id}/viewpoints/${page.id}/snapshot`);
    expect(snap).toMatchObject({ status: 502, body: { message: "PDF sa nedalo stiahnuť" } });
    expect((await call(s.ctx, "GET", `${P}/topics/${s.topic.id}/viewpoints/vp-3d/snapshot`)).status).toBe(404);

    // Bez kalibrácie preberie kameru 3D pohľadu témy.
    s.topic.viewpoint = { guid: "vp-3d", source: "viewer", camera: { position: { x: 5, y: 5, z: 5 }, target: { x: 0, y: 0, z: 0 } } };
    await s.store.update(s.topic.id, { viewpoint: s.topic.viewpoint });
    const withCam = (await call(s.ctx, "GET", `${P}/topics/${s.topic.id}/viewpoints`)).body as Record<string, unknown>[];
    expect(withCam[1].perspective_camera).toEqual(withCam[0].perspective_camera);

    const plain = setup();
    await plain.store.addDocument({ ...plain.base, page: 1, region: null, document_sha256: null });
    expect((await call(plain.ctx, "GET", `${P}/topics/${plain.topic.id}/viewpoints`)).body).toEqual([]);
  });
});

describe("odkaz na dokument: viewrect, revízia a snímka v detaile", () => {
  const row = (over: Partial<TopicDocumentRow> = {}): TopicDocumentRow => ({
    id: "22222222-2222-4222-8222-000000000009",
    task_id: "t",
    document_id: DOC_ID,
    document_ref: "D.1.1.09",
    document_name: "Pôdorys 1NP",
    document_revision: "B",
    page: 2,
    region: { x: 50, y: 0, width: 50, height: 50 },
    markup: null,
    url: null,
    description: null,
    author: "a",
    document_sha256: null,
    created_at: "2026-10-22T00:00:00Z",
    ...over,
  });

  it("so známou veľkosťou strany nesie adresa RFC 8118 viewrect a vráti sa späť", () => {
    const url = documentUrl(ORIGIN, row({ page_size: [842, 595] }));
    expect(url).toBe(`${ORIGIN}/drawing/${DOC_ID}?page=2&region=50_0_50_50#page=2&viewrect=421,0,421,297.5`);
    expect(documentReferenceToDto(row({ page_size: [842, 595] }), ORIGIN).url).toBe(url);
    expect(parseDocumentReferenceDto({ url }, ORIGIN)).toMatchObject({ document_id: DOC_ID, page: 2, region: { x: 50, y: 0, width: 50, height: 50 } });
    // Len fragment (cudzí nástroj zahodil query): strana z #page aj s viewrect.
    expect(parseDocumentReferenceDto({ url: `/drawing/${DOC_ID}#page=3&viewrect=1,2,3,4` }, ORIGIN)).toMatchObject({ page: 3 });
  });

  it("odkaz si pamätá sha256 revízie a detail nesie adresu snímky", () => {
    const info = { ...DOCUMENTS[0], sha256: SHA };
    expect(documentWrite(info, { page: 2 }, "t", "a").document_sha256).toBe(SHA);
    expect(documentView(row()).snapshot_url).toBe(`/api/drawing/${DOC_ID}/snapshot?page=2&region=50_0_50_50`);
    expect(documentView(row({ page: null })).snapshot_url).toBeNull();
  });
});
