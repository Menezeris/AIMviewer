import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BcfApiClient, fetchProjectAsBCF } from "@ifc-lite/bcf-api";
import { readBCF, writeBCF, type BCFDocumentReference, type BCFProject } from "@ifc-lite/bcf";

import { handleBcfApi, PROJECT_ID, viewpointToDto } from "./api";
import { importBcfArchive, importBcfProject, identificationCandidates, importStatus, topicIdFromGuid } from "./import";
import { checkImportUrl } from "./import-source";
import type { BcfTopicRow } from "./store";
import { execBcfTool } from "./tools";
import { DOC_ID, G1, G2, deps, memoryStore } from "./testing";

const BASE = "https://aim.example/api/bcf";
const ORIGIN = "https://aim.example";
const T_OLD = "2026-10-01T10:00:00.000Z";

type Mem = ReturnType<typeof memoryStore>;

/** Export z úložiska ako to robí viewer: upstream klient + DocumentReference z `document_references` (D-158 krok 2). */
async function exportProject(m: Mem, version: "2.1" | "3.0"): Promise<Uint8Array> {
  const d = deps({ store: m.store });
  const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const res = await handleBcfApi(
      { method: init?.method ?? "GET", segments: url.pathname.replace("/api/bcf", "").split("/").filter(Boolean), query: url.searchParams, body: null },
      { deps: d, user: "samuel", authenticated: false, writeEnabled: true, origin: ORIGIN },
    );
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { "Content-Type": "application/json" } });
  };
  const client = new BcfApiClient({ baseUrl: BASE, fetchFn });
  const { project } = await fetchProjectAsBCF(client, PROJECT_ID, { includeSnapshots: false });
  for (const topic of project.topics.values()) {
    const res = await fetchFn(`${BASE}/2.1/projects/${PROJECT_ID}/topics/${topic.guid}/document_references`);
    const refs = (await res.json()) as { guid: string; url: string; description: string }[];
    topic.documentReferences = refs.map((r): BCFDocumentReference => (version === "2.1" ? { guid: r.guid, isExternal: true, referencedDocument: r.url, description: r.description } : { guid: r.guid, url: r.url, description: r.description }));
  }
  const blob = await writeBCF({ ...project, version });
  return new Uint8Array(await blob.arrayBuffer());
}

function seeded(): Mem {
  const m = memoryStore([
    {
      title: "Kolízia potrubia s nosníkom",
      description: "Potrubie prechádza nosníkom",
      priority: "High",
      assigned_to: "Projektant VZT",
      labels: ["VZT", "kolizia"],
      topic_type: "Clash",
      due_date: "2026-11-15",
      components: [G1, G2],
      author: "samuel@assetin.sk",
      modified_by: "samuel@assetin.sk",
      comments: [{ guid: "c1", author: "Claude (MCP)", date: "2026-10-19T12:00:00Z", comment: "Založené z chatu" }],
      viewpoint: {
        guid: "6d3c5b9e-1f53-4a1e-9a0a-0c9b6a7f1a11",
        source: "viewer",
        camera: { position: { x: 5, y: 5, z: 5 }, target: { x: 0, y: 0, z: 0 }, aspect: 1.5 },
        section: { axis: "y", coordinate: 3.1 },
      },
      created_at: "2026-09-30T10:00:00.000Z",
      updated_at: T_OLD,
    },
    { title: "Na výkrese", description: "Chýba popis", status: "in_progress", components: [], author: "samuel@assetin.sk", modified_by: "samuel@assetin.sk", created_at: "2026-09-30T10:00:00.000Z", updated_at: T_OLD },
    { title: "Uzavretá", status: "closed", author: "samuel@assetin.sk", modified_by: "samuel@assetin.sk", created_at: "2026-09-30T10:00:00.000Z", updated_at: T_OLD },
  ]);
  m.docs.push({
    id: "22222222-2222-4222-8222-000000000001",
    task_id: m.rows[1].id,
    document_id: DOC_ID,
    document_ref: "D.1.1.09",
    document_name: "Pôdorys 1NP",
    document_revision: "B",
    page: 2,
    region: { x: 50, y: 0, width: 50, height: 50 },
    markup: null,
    url: null,
    description: "Doplniť kótu",
    author: "Claude (MCP)",
    document_sha256: null,
    created_at: "2026-10-22T00:00:00Z",
  });
  return m;
}

const strip = (r: BcfTopicRow) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  topic_type: r.topic_type,
  status: r.status,
  priority: r.priority,
  assigned_to: r.assigned_to,
  due_date: r.due_date,
  labels: [...r.labels].sort(),
  components: [...r.components].sort(),
  comments: r.comments.map((c) => [c.author, c.comment]),
  author: r.author,
});

describe("import .bcfzip do DB (D-158 krok 8)", () => {
  for (const version of ["2.1", "3.0"] as const) {
    it(`roundtrip export -> import (${version}): rovnaký stav, druhý import nič nemení`, async () => {
      const a = seeded();
      const zip = await exportProject(a, version);
      const b = memoryStore();
      const bd = deps({ store: b.store });
      const first = await importBcfArchive(zip, bd);
      expect(first.bcf_version).toBe(version);
      expect([first.created, first.failed, first.skipped, first.conflicts]).toEqual([3, 0, 0, 0]);
      expect(b.rows.map(strip)).toEqual(a.rows.map(strip));
      // Pohľad témy: ten istý guid, kamera aj rez.
      expect(viewpointToDto(b.rows[0])).toMatchObject({ guid: viewpointToDto(a.rows[0])!.guid, perspective_camera: { camera_view_point: { x: 5, y: 5, z: 5 } } });
      expect(viewpointToDto(b.rows[0])!.clipping_planes).toEqual(viewpointToDto(a.rows[0])!.clipping_planes);
      // Odkaz na dokument: ten istý dokument, strana, oblasť, revízia a text; guid odkazu sa zachoval.
      expect(b.docs).toHaveLength(1);
      expect(b.docs[0]).toMatchObject({
        id: a.docs[0].id,
        task_id: a.rows[1].id,
        document_id: DOC_ID,
        document_ref: "D.1.1.09",
        document_revision: "B",
        page: 2,
        region: { x: 50, y: 0, width: 50, height: 50 },
        description: "Doplniť kótu",
      });
      // Opakovaný import: nič nové, nič zmenené.
      const again = await importBcfArchive(zip, bd);
      expect([again.created, again.updated, again.unchanged, again.conflicts]).toEqual([0, 0, 3, 0]);
      expect(b.rows).toHaveLength(3);
      expect(b.docs).toHaveLength(1);
      expect(b.rows[0].comments).toHaveLength(1);
    });
  }

  it("zmenená téma v súbore, novšia než v DB, sa aktualizuje po poliach; komentáre a odkazy sa len pridávajú", async () => {
    const a = seeded();
    const b = memoryStore();
    const bd = deps({ store: b.store });
    const zip = await exportProject(a, "2.1");
    await importBcfArchive(zip, bd);
    // Zdroj sa zmenil neskôr (iný nástroj): stav, komentár a termín.
    a.rows[0].status = "resolved";
    a.rows[0].due_date = "2026-12-01";
    a.rows[0].comments = [...a.rows[0].comments, { guid: "c2", author: "projektant", date: "2026-10-30T08:00:00Z", comment: "Posunuté nosník" }];
    a.rows[0].updated_at = "2099-01-01T00:00:00.000Z";
    const res = await importBcfArchive(await exportProject(a, "2.1"), bd);
    expect([res.updated, res.unchanged, res.conflicts]).toEqual([1, 2, 0]);
    const t = res.topics.find((x) => x.result === "updated")!;
    expect(t.changes).toEqual(expect.arrayContaining(["status", "due_date", "+1 komentárov"]));
    expect(b.rows[0]).toMatchObject({ status: "resolved", due_date: "2026-12-01" });
    expect(b.rows[0].comments.map((c) => c.comment)).toEqual(["Založené z chatu", "Posunuté nosník"]);
    // Totožný súbor znova: už nič.
    const same = await importBcfArchive(await exportProject(a, "2.1"), bd);
    expect(same.unchanged).toBe(3);
    expect(b.rows[0].comments).toHaveLength(2);
  });

  it("zachová pôvodné dátumy a autorov: téma (vznik, zmena) aj komentáre", async () => {
    const a = seeded();
    a.rows[0].created_at = "2026-09-01T08:00:00.000Z";
    a.rows[0].comments = [
      { guid: "c1", author: "Claude (MCP)", date: "2026-09-02T09:30:00Z", comment: "Založené z chatu" },
      { guid: "c2", author: "projektant", date: "2026-09-15T14:45:10Z", comment: "Posunuté nosník" },
    ];
    for (const version of ["2.1", "3.0"] as const) {
      const b = memoryStore();
      await importBcfArchive(await exportProject(a, version), deps({ store: b.store }), { author: "importer" });
      expect(b.rows[0]).toMatchObject({ author: "samuel@assetin.sk", modified_by: "samuel@assetin.sk", created_at: "2026-09-01T08:00:00.000Z", updated_at: T_OLD });
      expect(b.rows[0].comments.map((c) => [c.author, c.date, c.comment])).toEqual([
        ["Claude (MCP)", "2026-09-02T09:30:00.000Z", "Založené z chatu"],
        ["projektant", "2026-09-15T14:45:10.000Z", "Posunuté nosník"],
      ]);
      expect(b.rows[1]).toMatchObject({ created_at: a.rows[1].created_at, updated_at: T_OLD });
    }
  });

  it("guid komentára z BCF sa zachová a druhý import toho istého .bcfzip komentáre nezdvojí", async () => {
    const G_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
    const G_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
    const a = seeded();
    a.rows[0].comments = [
      { guid: G_A, author: "Claude (MCP)", date: "2026-09-02T09:30:00Z", comment: "Založené z chatu" },
      { guid: G_B, author: "projektant", date: "2026-09-15T14:45:10Z", comment: "Posunuté nosník" },
    ];
    const zip = await exportProject(a, "2.1");
    const b = memoryStore();
    const bd = deps({ store: b.store });
    await importBcfArchive(zip, bd);
    expect(b.rows[0].comments.map((c) => c.guid)).toEqual([G_A, G_B]);
    const again = await importBcfArchive(zip, bd);
    expect([again.created, again.updated, again.unchanged]).toEqual([0, 0, 3]);
    expect(b.rows[0].comments.map((c) => c.guid)).toEqual([G_A, G_B]);
    // Komentár s rovnakým guid, ale zmeneným textom (úprava v zdroji) sa nepridá ako nový.
    a.rows[0].comments = [{ ...a.rows[0].comments[0], comment: "Založené z chatu (upravené)" }, a.rows[0].comments[1]];
    a.rows[0].updated_at = "2099-01-01T00:00:00.000Z";
    await importBcfArchive(await exportProject(a, "2.1"), bd);
    expect(b.rows[0].comments).toHaveLength(2);
    // Store s rovnakým guid vráti existujúci komentár, nepridá ho (správanie funkcie v DB).
    const dup = await b.store.addComment(b.rows[0].id, "x", "iný text", undefined, G_A);
    expect(dup?.guid).toBe(G_A);
    expect(b.rows[0].comments).toHaveLength(2);
  });

  it("aktualizácia: updated_at a dátum nového komentára zo súboru, nie čas importu; budúci dátum sa orezá", async () => {
    const a = seeded();
    const b = memoryStore();
    const bd = deps({ store: b.store });
    await importBcfArchive(await exportProject(a, "2.1"), bd);
    a.rows[0].status = "resolved";
    a.rows[0].comments = [...a.rows[0].comments, { guid: "c2", author: "projektant", date: "2026-10-30T08:00:00Z", comment: "Posunuté nosník" }];
    a.rows[0].updated_at = "2026-10-30T09:00:00.000Z";
    await importBcfArchive(await exportProject(a, "2.1"), bd);
    expect(b.rows[0].updated_at).toBe("2026-10-30T09:00:00.000Z");
    expect(b.rows[0].comments[1]).toMatchObject({ author: "projektant", date: "2026-10-30T08:00:00.000Z" });
    // Súbor so zlými hodinami (dátum zmeny v budúcnosti) sa orezá na čas importu.
    a.rows[0].status = "closed";
    a.rows[0].updated_at = "2099-01-01T00:00:00.000Z";
    const before = Date.now();
    await importBcfArchive(await exportProject(a, "2.1"), bd);
    const stamped = Date.parse(b.rows[0].updated_at);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
  });

  it("len nový komentár: updated_at ostane, komentár nesie pôvodný dátum", async () => {
    const a = seeded();
    const b = memoryStore();
    const bd = deps({ store: b.store });
    await importBcfArchive(await exportProject(a, "2.1"), bd);
    a.rows[2].comments = [{ guid: "c9", author: "revizor", date: "2026-10-05T07:00:00Z", comment: "Súhlasím" }];
    await importBcfArchive(await exportProject(a, "2.1"), bd);
    expect(b.rows[2].comments.map((c) => [c.author, c.date])).toEqual([["revizor", "2026-10-05T07:00:00.000Z"]]);
    expect(b.rows[2].updated_at).toBe(T_OLD);
  });

  it("téma v DB novšia než súbor a líši sa = konflikt, nič sa nezapíše; overwrite ju prepíše", async () => {
    const a = seeded();
    const b = memoryStore();
    const bd = deps({ store: b.store });
    const zip = await exportProject(a, "3.0");
    await importBcfArchive(zip, bd);
    // Niekto zmenil tému v DB (updated_at je teraz, novšie než dátum zmeny v súbore).
    await b.store.update(b.rows[0].id, { priority: "Low", status: "closed" });
    b.rows[0].updated_at = "2099-01-01T00:00:00.000Z";
    const res = await importBcfArchive(zip, bd);
    expect(res.conflicts).toBe(1);
    const c = res.topics.find((x) => x.result === "conflict")!;
    expect(c.conflicts).toEqual(expect.arrayContaining([{ field: "priority", db: "Low", incoming: "High" }, { field: "status", db: "closed", incoming: "open" }]));
    expect(b.rows[0]).toMatchObject({ priority: "Low", status: "closed" });
    const forced = await importBcfArchive(zip, bd, { conflict: "overwrite" });
    expect(forced.updated).toBe(1);
    expect(b.rows[0]).toMatchObject({ priority: "High", status: "open" });
  });

  it("dry_run nič nezapíše a ohlási, čo by sa stalo", async () => {
    const zip = await exportProject(seeded(), "2.1");
    const b = memoryStore();
    const res = await importBcfArchive(zip, deps({ store: b.store }), { dryRun: true });
    expect(res).toMatchObject({ dry_run: true, created: 3 });
    expect(b.rows).toHaveLength(0);
    expect(b.docs).toHaveLength(0);
  });

  it("guids vyberie len niektoré témy", async () => {
    const a = seeded();
    const zip = await exportProject(a, "2.1");
    const b = memoryStore();
    const res = await importBcfArchive(zip, deps({ store: b.store }), { guids: [a.rows[2].id.toUpperCase()] });
    expect(res.created).toBe(1);
    expect(b.rows.map((r) => r.title)).toEqual(["Uzavretá"]);
  });

  it("cudzí nástroj: IFC GUID témy, stav Active, dokument podľa kódu (Identification) a #page, neznámy dokument ostane ako url", async () => {
    const project: BCFProject = {
      version: "2.1",
      topics: new Map(),
    };
    const guid = "2O2Fr$t4X7Zf8NOew3FLOH";
    project.topics.set(guid, {
      guid,
      title: "Cudzia téma",
      topicStatus: "Active",
      topicType: "Error",
      creationDate: "2026-10-30T10:00:00Z",
      modifiedDate: "2026-10-30T11:00:00Z",
      documentReferences: [
        { isExternal: true, referencedDocument: "https://sharepoint.example/docs/D.1.1.09.pdf#page=2", description: "výkres" },
        { isExternal: true, referencedDocument: "https://sharepoint.example/docs/neznamy.pdf", description: "cudzí" },
        { isExternal: false, referencedDocument: "", description: "" },
      ],
      comments: [{ guid: "c", comment: "Pozri výkres", author: "cudzi@firma.sk", date: "2026-10-30T10:30:00Z" }],
      viewpoints: [
        { guid: "11111111-aaaa-4aaa-8aaa-111111111111", perspectiveCamera: { cameraViewPoint: { x: 1, y: 2, z: 3 }, cameraDirection: { x: 0, y: 1, z: 0 }, cameraUpVector: { x: 0, y: 0, z: 1 }, fieldOfView: 60 }, components: { selection: [{ ifcGuid: G1 }] } },
        { guid: "22222222-aaaa-4aaa-8aaa-222222222222", components: { selection: [{ ifcGuid: G2 }] } },
      ],
    });
    project.topics.set("nie-uuid", { guid: "nie-uuid", title: "Zlý guid", comments: [], viewpoints: [] });
    const b = memoryStore();
    const res = await importBcfProject(project, deps({ store: b.store }));
    expect([res.created, res.skipped]).toEqual([1, 1]);
    expect(res.topics.find((t) => t.result === "skipped")!.reason).toMatch(/guid/);
    const row = b.rows[0];
    expect(row).toMatchObject({ id: topicIdFromGuid(guid, (await import("@ifc-lite/bcf")).ifcGuidToUuid, (await import("@ifc-lite/bcf")).isValidIfcGuid), title: "Cudzia téma", status: "open", topic_type: "Error", components: [G1, G2] });
    expect((row.viewpoint as { guid: string }).guid).toBe("11111111-aaaa-4aaa-8aaa-111111111111");
    expect(b.docs).toHaveLength(2);
    expect(b.docs[0]).toMatchObject({ document_id: DOC_ID, document_ref: "D.1.1.09", page: 2, description: "výkres" });
    expect(b.docs[1]).toMatchObject({ document_id: null, url: "https://sharepoint.example/docs/neznamy.pdf", description: "cudzí" });
    expect(res.topics[0].documents_foreign).toBe(1);
    expect(res.topics[0].warnings?.join(" ")).toMatch(/ďalších pohľadov/);
    expect(row.comments.map((c) => [c.author, c.comment])).toEqual([["cudzi@firma.sk", "Pozri výkres"]]);
  });

  it("odkaz vzniknutý nad staršou revíziou dokumentu sa nepripíše k aktuálnej (D-158 krok 6)", async () => {
    const a = seeded();
    a.docs[0].document_revision = "A"; // dokument v AIM má revíziu B
    const b = memoryStore();
    await importBcfArchive(await exportProject(a, "2.1"), deps({ store: b.store }));
    expect(b.docs[0]).toMatchObject({ document_revision: "A", document_sha256: null, anchor_pages: null });
  });

  it("neplatný archív a prázdny súbor sú chyba vstupu", async () => {
    const d = deps();
    await expect(importBcfArchive(new Uint8Array(0), d)).rejects.toThrow(/prázdny/);
    await expect(importBcfArchive(new Uint8Array([1, 2, 3, 4]), d)).rejects.toThrow(/bcfzip/);
  });

  it("pomocné: stavy, kandidáti na kód, adresy importu", () => {
    expect(importStatus("In Progress")).toEqual({ status: "in_progress", unknown: false });
    expect(importStatus("ReOpened").status).toBe("open");
    expect(importStatus("Zvláštny")).toEqual({ status: "open", unknown: true });
    expect(identificationCandidates("https://x.sk/a/D.1.1.09.pdf#page=2", "D.1.1.09 (rev. B), strana 2: text")).toEqual(["D.1.1.09.pdf", "D.1.1.09"]);
    const cfg = { supabaseUrl: "https://p.supabase.co", hosts: ["files.example"] };
    expect(() => checkImportUrl("https://p.supabase.co/storage/v1/object/public/documents/a.bcfzip", cfg)).not.toThrow();
    expect(() => checkImportUrl("https://files.example/a.bcfzip", cfg)).not.toThrow();
    for (const bad of ["http://files.example/a.bcfzip", "https://169.254.169.254/latest", "https://evil.example/a.bcfzip", "https://u:p@files.example/a", "nie url"]) {
      expect(() => checkImportUrl(bad, cfg), bad).toThrow();
    }
  });

  it("readBCF ostáva zdrojom parsovania: 2.1 aj 3.0 archív prečíta", async () => {
    for (const version of ["2.1", "3.0"] as const) {
      const back = await readBCF(await exportProject(seeded(), version));
      expect(back.version).toBe(version);
    }
  });

  it("tool bcf_topic action=import: data_base64, dry_run, chyby vstupu", async () => {
    const zip = await exportProject(seeded(), "2.1");
    const b = memoryStore();
    const d = deps({ store: b.store });
    const b64 = Buffer.from(zip).toString("base64");
    const dry = await execBcfTool("bcf_topic", { action: "import", data_base64: b64, dry_run: true }, d);
    expect(dry.isError).toBe(false);
    expect(JSON.parse(dry.text)).toMatchObject({ dry_run: true, created: 3 });
    expect(b.rows).toHaveLength(0);
    const real = await execBcfTool("bcf_topic", { action: "import", data_base64: b64, modified_by: "samuel" }, d);
    expect(JSON.parse(real.text)).toMatchObject({ created: 3, failed: 0 });
    expect(b.rows).toHaveLength(3);
    for (const bad of [{}, { url: "https://evil.example/a.bcfzip" }, { data_base64: b64, conflict: "x" }, { data_base64: b64, url: "https://x.sk/a" }]) {
      const r = await execBcfTool("bcf_topic", { action: "import", ...bad }, d);
      expect(r.isError, JSON.stringify(bad)).toBe(true);
    }
  });
});
