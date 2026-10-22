import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BcfApiClient,
  fetchProjectAsBCF,
  resolveBcfServiceBaseUrl,
  topicToApiWrite,
  viewpointToApi,
} from "@ifc-lite/bcf-api";

import { handleBcfApi, PROJECT_ID } from "./api";
import { DOC_ID, G1, G2, deps, memoryStore } from "./testing";

/**
 * Protokolová zhoda s klientom, ktorý používa BCF panel viewera (D-099 fáza B):
 * skutočný `@ifc-lite/bcf-api` volá `handleBcfApi` cez náhradný fetch, tak ako
 * by volal `<site>/api/bcf` (token, objavenie, načítanie projektu, zápisy).
 */

const BASE = "https://aim.example/api/bcf";
const TOKEN = "t".repeat(32);

function server(store = memoryStore()) {
  const d = deps({ store: store.store });
  const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const res = await handleBcfApi(
      {
        method: init?.method ?? "GET",
        segments: url.pathname.replace("/api/bcf", "").split("/").filter(Boolean),
        query: url.searchParams,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      },
      { deps: d, user: "samuel", authenticated: headers.get("authorization") === `Bearer ${TOKEN}`, writeEnabled: true, origin: new URL(BASE).origin },
    );
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { "Content-Type": "application/json" } });
  };
  const client = new BcfApiClient({ baseUrl: BASE, getAccessToken: () => TOKEN, fetchFn });
  return { client, fetchFn, d, ...store };
}

describe("@ifc-lite/bcf-api proti /api/bcf", () => {
  it("prihlásenie tokenom ako signInWithToken: báza bez objavovania, current-user", async () => {
    const { client, fetchFn } = server();
    expect(await resolveBcfServiceBaseUrl({ baseUrl: BASE, fetchFn })).toBe(BASE);
    expect(await client.getVersions()).toEqual([expect.objectContaining({ version_id: "2.1" })]);
    expect(await client.getCurrentUser()).toMatchObject({ id: "samuel" });
    const anon = new BcfApiClient({ baseUrl: BASE, fetchFn });
    await expect(anon.getCurrentUser()).rejects.toThrow();
  });

  it("viewer bez tokenu (AIM_BCF_LOAD): fetchProjectAsBCF prejde, zápis nie", async () => {
    const s = server(memoryStore([{ title: "Z chatu", components: [G1] }]));
    const anon = new BcfApiClient({ baseUrl: BASE, fetchFn: s.fetchFn });
    const result = await fetchProjectAsBCF(anon, PROJECT_ID, { includeSnapshots: false });
    expect(result.warnings).toEqual([]);
    expect([...result.project.topics.values()].map((t) => t.title)).toEqual(["Z chatu"]);
    await expect(anon.createTopic(PROJECT_ID, { title: "nie" })).rejects.toThrow();
    expect(s.rows).toHaveLength(1);
  });

  it("pripomienka na dokumente (D-158) je v tom istom zozname panela, opis nesie dokument a stranu; zápis z panela ho neuloží", async () => {
    const store = memoryStore([{ title: "Z 3D", components: [G1] }, { title: "Na výkrese", description: "Chýba popis", components: [G2] }]);
    const s = server(store);
    store.docs.push({
      id: "22222222-2222-4222-8222-000000000001",
      task_id: store.rows[1].id,
      document_id: DOC_ID,
      document_ref: "D.1.1.09",
      document_name: "Pôdorys 1NP",
      document_revision: "B",
      page: 2,
      region: { x: 50, y: 0, width: 50, height: 50 },
      markup: null,
      url: null,
      description: null,
      author: "Claude (MCP)",
      created_at: "2026-10-22T00:00:00Z",
    });
    const anon = new BcfApiClient({ baseUrl: BASE, fetchFn: s.fetchFn });
    const result = await fetchProjectAsBCF(anon, PROJECT_ID, { includeSnapshots: false });
    expect(result.warnings).toEqual([]);
    const topics = [...result.project.topics.values()];
    expect(topics.map((t) => t.title)).toEqual(["Z 3D", "Na výkrese"]);
    expect(topics[0].description).toBeUndefined();
    expect(topics[1].description).toBe("Chýba popis\n\nDokumenty (AIM):\n- D.1.1.09 (rev. B), strana 2, oblasť x 50 %, y 0 %, 50 x 50 %");
    // Panel s tokenom pošle opis späť celý; v DB ostane bez bloku dokumentov.
    await s.client.updateTopic(PROJECT_ID, store.rows[1].id, topicToApiWrite(topics[1]));
    expect(store.rows[1].description).toBe("Chýba popis");
  });

  it("fetchProjectAsBCF načíta témy s komentármi, pohľadom a výberom", async () => {
    const s = server(
      memoryStore([
        {
          title: "Kolízia potrubia s nosníkom",
          priority: "High",
          assigned_to: "Projektant VZT",
          components: [G1, G2],
          comments: [{ guid: "c1", author: "Claude (MCP)", date: "2026-10-19T12:00:00Z", comment: "Založené z chatu" }],
          viewpoint: {
            guid: "vp",
            source: "viewer",
            camera: { position: { x: 5, y: 5, z: 5 }, target: { x: 0, y: 0, z: 0 } },
            section: { axis: "y", coordinate: 3.1 },
          },
        },
        { title: "Druhá", status: "closed" },
      ]),
    );
    const [project] = await s.client.getProjects();
    expect(project.project_id).toBe(PROJECT_ID);
    const result = await fetchProjectAsBCF(s.client, PROJECT_ID, { pageSize: 1 });
    expect(result.warnings).toEqual([]);
    const topics = [...result.project.topics.values()];
    expect(topics.map((t) => [t.title, t.topicStatus])).toEqual([
      ["Kolízia potrubia s nosníkom", "Open"],
      ["Druhá", "Closed"],
    ]);
    const [first] = topics;
    expect(first.comments.map((c) => c.comment)).toEqual(["Založené z chatu"]);
    expect(first.viewpoints).toHaveLength(1);
    expect(first.viewpoints[0].perspectiveCamera?.cameraViewPoint).toEqual({ x: 5, y: 5, z: 5 });
    expect(first.viewpoints[0].clippingPlanes).toEqual([{ location: { x: 0, y: 0, z: 3.1 }, direction: { x: 0, y: 0, z: -1 } }]);
    expect(first.viewpoints[0].components?.selection?.map((c) => c.ifcGuid)).toEqual([G1, G2]);
  });

  it("zápisy z outboxu panela: slovník projektu ich pustí, téma pre Claude spustí session", async () => {
    const s = server();
    const ext = await s.client.getExtensions(PROJECT_ID);
    const write = topicToApiWrite({
      guid: "local",
      title: "Doplň FireRating stenám 2NP",
      topicType: "Request",
      topicStatus: "Open",
      priority: "High",
      assignedTo: "claude",
      creationDate: "",
      creationAuthor: "samuel",
      comments: [],
      viewpoints: [],
    });
    // Rovnaké kontroly ako outbox-preflight.ts vo viewri.
    expect(ext.topic_type).toContain(write.topic_type);
    expect(ext.topic_status).toContain(write.topic_status);
    expect(ext.priority).toContain(write.priority);
    expect(ext.user_id_type).toContain(write.assigned_to);
    expect(ext.project_actions).toContain("createTopic");

    const created = await s.client.createTopic(PROJECT_ID, write);
    expect(created.topic_status).toBe("In Progress");
    expect(s.d.fired).toHaveLength(1);

    const comment = await s.client.createComment(PROJECT_ID, created.guid, { comment: "Len vonkajšie steny" });
    expect(comment.author).toBe("samuel");

    const vp = viewpointToApi({
      guid: "vp-panel",
      perspectiveCamera: {
        cameraViewPoint: { x: 1, y: 2, z: 3 },
        cameraDirection: { x: 0, y: 1, z: 0 },
        cameraUpVector: { x: 0, y: 0, z: 1 },
        fieldOfView: 60,
      },
      components: { selection: [{ ifcGuid: G1 }] },
      snapshot: "data:image/png;base64,AAAA",
    });
    await s.client.createViewpoint(PROJECT_ID, created.guid, vp);
    expect(s.rows[0].components).toEqual([G1]);

    const updated = await s.client.updateTopic(PROJECT_ID, created.guid, { ...write, title: "Doplň FireRating stenám 2NP a 3NP", topic_status: "In Progress" });
    expect(updated.title).toBe("Doplň FireRating stenám 2NP a 3NP");
    expect(s.d.fired).toHaveLength(1);
    const again = await fetchProjectAsBCF(s.client, PROJECT_ID);
    const t = again.project.topics.get(created.guid)!;
    expect(t.comments).toHaveLength(2);
    expect(t.viewpoints[0].guid).toBe("vp-panel");
  });
});
