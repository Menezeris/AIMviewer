import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { handleBcfApi, PROJECT_ID, viewpointFromDto, viewpointToDto, type BcfApiContext } from "./api";
import type { BcfTopicRow } from "./store";
import { G1, G2, deps, memoryStore } from "./testing";

const ctx = (over: Partial<BcfApiContext> = {}): BcfApiContext => ({
  deps: deps(),
  user: "samuel",
  authenticated: true,
  writeEnabled: true,
  ...over,
});

const call = (c: BcfApiContext, method: string, path: string, body: unknown = null) => {
  const url = new URL(`https://x/api/bcf/${path}`);
  return handleBcfApi(
    { method, segments: url.pathname.split("/").filter(Boolean).slice(2), query: url.searchParams, body },
    c,
  );
};

const P = `2.1/projects/${PROJECT_ID}`;

describe("objavenie a prihlásenie (ako BCFServerConnectForm)", () => {
  it("čítanie bez tokenu, zápis len s tokenom; bez BCF_API_TOKEN je API len na čítanie", async () => {
    const { store, rows } = memoryStore([{ title: "x" }]);
    const anon = ctx({ deps: deps({ store }), authenticated: false });
    expect((await call(anon, "GET", "versions")).body).toMatchObject({ versions: [{ version_id: "2.1" }] });
    expect((await call(anon, "GET", "2.1/auth")).status).toBe(200);
    expect((await call(anon, "GET", "2.1/current-user")).status).toBe(401);
    const list = await call(anon, "GET", `${P}/topics`);
    expect(list.status).toBe(200);
    // Bez tokenu panel neponúkne zápis: prázdne akcie projektu aj témy.
    expect((list.body as Record<string, unknown>[])[0].authorization).toEqual({ topic_actions: [], topic_status: [] });
    expect((await call(anon, "GET", "2.1/projects")).body).toEqual([
      expect.objectContaining({ authorization: { project_actions: [] } }),
    ]);
    expect(((await call(anon, "GET", `${P}/extensions`)).body as Record<string, unknown>).project_actions).toEqual([]);
    expect((await call(anon, "POST", `${P}/topics`, { title: "t" })).status).toBe(401);
    expect((await call(anon, "POST", `${P}/topics/${rows[0].id}/comments`, { comment: "c" })).status).toBe(401);
    const readOnly = ctx({ deps: deps({ store }), authenticated: false, writeEnabled: false });
    const refused = await call(readOnly, "PUT", `${P}/topics/${rows[0].id}`, { title: "y" });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ message: expect.stringMatching(/v chate/) });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("x");
  });

  it("zápis oznámi zmenu otvoreným viewerom, čítanie nie", async () => {
    const notify = vi.fn(async () => undefined);
    const { store, rows } = memoryStore([{ title: "x" }]);
    const c = ctx({ deps: deps({ store, notify }) });
    await call(c, "GET", `${P}/topics`);
    expect(notify).not.toHaveBeenCalled();
    await call(c, "POST", `${P}/topics`, { title: "t" });
    await call(c, "POST", `${P}/topics/${rows[0].id}/comments`, { comment: "c" });
    expect(notify).toHaveBeenCalledTimes(2);
    // Zlyhané oznámenie zápis nezhodí.
    const broken = ctx({ deps: deps({ store, notify: async () => Promise.reject(new Error("kanál")) }) });
    expect((await call(broken, "POST", `${P}/topics`, { title: "u" })).status).toBe(201);
  });

  it("current-user, projekt a slovník projektu", async () => {
    const c = ctx({ deps: deps({ store: memoryStore([{ priority: "vysoká", assigned_to: "Projektant VZT" }]).store }) });
    expect((await call(c, "GET", "2.1/current-user")).body).toEqual({ id: "samuel", name: "samuel" });
    expect((await call(c, "GET", "2.1/projects")).body).toEqual([
      expect.objectContaining({ project_id: PROJECT_ID, authorization: { project_actions: ["createTopic"] } }),
    ]);
    const ext = (await call(c, "GET", `${P}/extensions`)).body as Record<string, string[]>;
    expect(ext.topic_status).toEqual(["Open", "In Progress", "Resolved", "Closed", "Conflict", "Failed"]);
    expect(ext.priority).toEqual(expect.arrayContaining(["High", "vysoká"]));
    expect(ext.user_id_type).toEqual(["claude", "Projektant VZT"]);
    expect(ext).not.toHaveProperty("topic_label");
    expect((await call(c, "GET", "2.1/projects/iny/topics")).status).toBe(404);
  });
});

describe("témy, komentáre a pohľady", () => {
  it("zoznam stránkuje $top/$skip od najstaršej a stav ide v BCF tvare", async () => {
    const { store } = memoryStore([{ title: "a" }, { title: "b", status: "in_progress" }, { title: "c" }]);
    const c = ctx({ deps: deps({ store }) });
    const page = (await call(c, "GET", `${P}/topics?$top=2&$skip=1`)).body as Record<string, unknown>[];
    expect(page.map((t) => [t.title, t.topic_status, t.index])).toEqual([
      ["b", "In Progress", 2],
      ["c", "Open", 3],
    ]);
  });

  it("panel založí tému pre Claude: spustí session raz, PUT ju znova nespustí", async () => {
    const { store, rows } = memoryStore();
    const d = deps({ store });
    const c = ctx({ deps: d });
    const created = await call(c, "POST", `${P}/topics`, {
      title: "Stena bez FireRating",
      topic_type: "Issue",
      topic_status: "Open",
      assigned_to: "claude",
      labels: ["ASR", "ASR"],
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ topic_status: "In Progress", creation_author: "samuel", labels: ["ASR"] });
    expect(d.fired).toHaveLength(1);
    const guid = (created.body as { guid: string }).guid;
    const put = await call(c, "PUT", `${P}/topics/${guid}`, {
      title: "Stena bez FireRating (2NP)",
      topic_status: "In Progress",
      assigned_to: "claude",
    });
    expect(put.status).toBe(200);
    expect(d.fired).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Stena bez FireRating (2NP)", labels: [], modified_by: "samuel" });
  });

  it("zlý stav je 400, neznáma téma 404", async () => {
    const c = ctx();
    expect((await call(c, "POST", `${P}/topics`, { title: "t", topic_status: "Done" })).status).toBe(400);
    expect((await call(c, "POST", `${P}/topics`, { description: "bez názvu" })).status).toBe(400);
    expect((await call(c, "GET", `${P}/topics/00000000-0000-4000-8000-000000000999`)).status).toBe(404);
    expect((await call(c, "GET", `${P}/topics/nie-guid`)).status).toBe(404);
  });

  it("komentár z panela má autora tokenu", async () => {
    const { store, rows } = memoryStore([{ title: "x" }]);
    const c = ctx({ deps: deps({ store }) });
    const res = await call(c, "POST", `${P}/topics/${rows[0].id}/comments`, { comment: "Over to na 3NP" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ author: "samuel", comment: "Over to na 3NP", topic_guid: rows[0].id });
    expect(((await call(c, "GET", `${P}/topics/${rows[0].id}/comments`)).body as unknown[]).length).toBe(1);
  });

  it("pohľad z panela nahradí pohľad a prvky; GET vráti BCF tvar s výberom", async () => {
    const { store, rows } = memoryStore([{ title: "x", components: [G1] }]);
    const c = ctx({ deps: deps({ store }) });
    const vp = {
      guid: "vp-1",
      perspective_camera: {
        camera_view_point: { x: 1, y: 2, z: 3 },
        camera_direction: { x: 0, y: 1, z: 0 },
        camera_up_vector: { x: 0, y: 0, z: 1 },
        field_of_view: 60,
      },
      components: { selection: [{ ifc_guid: G2 }], visibility: { default_visibility: true } },
      snapshot: { snapshot_type: "png", snapshot_data: "AAAA" },
    };
    expect((await call(c, "POST", `${P}/topics/${rows[0].id}/viewpoints`, vp)).status).toBe(201);
    expect(rows[0].components).toEqual([G2]);
    expect(rows[0].viewpoint).not.toHaveProperty("bcf.snapshot");
    const list = (await call(c, "GET", `${P}/topics/${rows[0].id}/viewpoints`)).body as Record<string, unknown>[];
    expect(list).toEqual([
      expect.objectContaining({ guid: "vp-1", perspective_camera: vp.perspective_camera, components: { selection: [{ ifc_guid: G2, originating_system: "AIM" }] } }),
    ]);
    const sel = await call(c, "GET", `${P}/topics/${rows[0].id}/viewpoints/vp-1/selection`);
    expect(sel.body).toEqual({ selection: [{ ifc_guid: G2, originating_system: "AIM" }] });
    expect((await call(c, "GET", `${P}/topics/${rows[0].id}/viewpoints/vp-1/snapshot`)).status).toBe(404);
    expect((await call(c, "GET", `${P}/topics/${rows[0].id}/viewpoints/iny`)).status).toBe(404);
  });
});

describe("prevod pohľadu z viewera (view_state) do BCF", () => {
  const row = (viewpoint: Record<string, unknown>, components: string[] = []) =>
    ({ id: "t", components, viewpoint }) as unknown as BcfTopicRow;

  it("perspektíva: smer z cieľa, predvolené up a FOV; rez cez výšku = rovina Z", () => {
    const dto = viewpointToDto(
      row(
        {
          guid: "g",
          source: "viewer",
          camera: { position: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 10, z: 10 } },
          section: { axis: "y", coordinate: 4.2, flipped: false },
        },
        [G1],
      ),
    )!;
    expect(dto.perspective_camera).toEqual({
      camera_view_point: { x: 0, y: 0, z: 10 },
      camera_direction: { x: 0, y: 1, z: 0 },
      camera_up_vector: { x: 0, y: 0, z: 1 },
      field_of_view: 60,
    });
    expect(dto.clipping_planes).toEqual([{ location: { x: 0, y: 10, z: 4.2 }, direction: { x: 0, y: 0, z: -1 } }]);
    expect(dto.components).toEqual({ selection: [{ ifc_guid: G1, originating_system: "AIM" }] });
  });

  it("ortografia: celá výška pohľadu; otočený rez osou z (IFC Y) obráti normálu", () => {
    const dto = viewpointToDto(
      row({
        guid: "g",
        camera: {
          position: { x: 0, y: 0, z: 50 },
          target: { x: 0, y: 0, z: 0 },
          up: { x: 0, y: 2, z: 0 },
          projection: "orthographic",
          ortho_size: 12.5,
        },
        section: { axis: "z", coordinate: -3, flipped: true },
      }),
    )!;
    expect(dto.orthogonal_camera).toMatchObject({ view_to_world_scale: 25, camera_up_vector: { x: 0, y: 1, z: 0 } });
    expect(dto.clipping_planes).toEqual([{ location: { x: 0, y: -3, z: 0 }, direction: { x: 0, y: -1, z: 0 } }]);
  });

  it("pohľad z panela sa uloží bez snímky a prvkov; bez guid dostane nový", () => {
    const { viewpoint, selection } = viewpointFromDto({ components: { selection: [{ ifc_guid: G1 }, { ifc_guid: G1 }, {}] } });
    expect(selection).toEqual([G1]);
    expect(viewpoint).toMatchObject({ source: "bcf", bcf: {} });
    expect(typeof viewpoint.guid).toBe("string");
  });
});
