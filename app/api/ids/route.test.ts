import { afterEach, describe, expect, it, vi } from "vitest";

import type { MemoryIdsStore } from "@/lib/ids/testing";

let store: MemoryIdsStore;
vi.mock("@/lib/ids/store", () => ({ supabaseIdsStore: () => store }));

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<ids xmlns="http://standards.buildingsmart.org/IDS" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://standards.buildingsmart.org/IDS http://standards.buildingsmart.org/IDS/1.0/ids.xsd">
  <info><title>Miestnosti na prenájom</title><version>1.0</version></info>
  <specifications>
    <specification name="Podlažie" identifier="IU-O-storey" ifcVersion="IFC4">
      <applicability minOccurs="0" maxOccurs="unbounded"><entity><name><simpleValue>IFCBUILDINGSTOREY</simpleValue></name></entity></applicability>
      <requirements><attribute cardinality="required"><name><simpleValue>Name</simpleValue></name></attribute></requirements>
    </specification>
  </specifications>
</ids>`;
const retitle = (title: string) => XML.replace("Miestnosti na prenájom", title);

const base = "https://aim.test/api/ids";
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(base, { method: "POST", headers: { "content-type": "application/json", host: "aim.test", origin: "https://aim.test", ...headers }, body: JSON.stringify(body) });

/** Nový modul route (brána sa číta pri načítaní) a nové úložisko z tej istej sady modulov (kvôli `instanceof` chýb). */
async function load(enabled: boolean) {
  vi.resetModules();
  if (enabled) vi.stubEnv("IDS_WRITE_ENABLED", "true");
  else vi.unstubAllEnvs();
  store = (await import("@/lib/ids/testing")).memoryIdsStore();
  return import("./route");
}

describe("/api/ids (D-162)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("zápis je predvolene vypnutý (403), čítanie ide", async () => {
    const route = await load(false);
    const res = await route.POST(post({ target: "studio", xml: XML }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("IDS_WRITE_ENABLED");
    expect(store.docs).toHaveLength(0);
    const list = await route.GET(new Request(base));
    expect(list.status).toBe(200);
    expect((await list.json()).items).toEqual([]);
  });

  it("cudzí origin je zablokovaný", async () => {
    const route = await load(true);
    expect((await route.POST(post({ target: "studio", xml: XML }, { origin: "https://evil.test" }))).status).toBe(403);
    expect(store.docs).toHaveLength(0);
  });

  it("nové IDS bez kódu, potom nová verzia nad base_version; GET vráti verziu s XML aj súbor na stiahnutie", async () => {
    const route = await load(true);
    const created = await route.POST(post({ target: "studio", xml: XML }));
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ ok: true, code: "MIESTNOSTI-NA-PRENAJOM", version: 1, created: true });

    const next = await route.POST(post({ target: "studio", xml: retitle("Po úprave"), code: "MIESTNOSTI-NA-PRENAJOM", base_version: 1 }));
    expect(await next.json()).toMatchObject({ ok: true, version: 2, created: false });
    expect(store.rows.map((r) => r.source)).toEqual(["viewer", "viewer"]);

    const got = await route.GET(new Request(`${base}?code=MIESTNOSTI-NA-PRENAJOM`));
    expect(await got.json()).toMatchObject({ code: "MIESTNOSTI-NA-PRENAJOM", version: 2, origin: "chat" });
    const first = await route.GET(new Request(`${base}?code=MIESTNOSTI-NA-PRENAJOM&version=1`));
    expect((await first.json()).xml).toContain("Miestnosti na prenájom");
    const file = await route.GET(new Request(`${base}?code=MIESTNOSTI-NA-PRENAJOM&version=1&format=ids`));
    expect(file.headers.get("content-disposition")).toContain("MIESTNOSTI-NA-PRENAJOM-v1.ids");
    expect(await file.text()).toContain("<ids");
  });

  it("konflikt base_version je 409 s poslednou verziou a zmenami v AIM; nič sa neuloží", async () => {
    const route = await load(true);
    await route.POST(post({ target: "studio", xml: XML }));
    await route.POST(post({ target: "studio", xml: retitle("Verzia 2"), code: "MIESTNOSTI-NA-PRENAJOM", base_version: 1 }));
    const res = await route.POST(post({ target: "studio", xml: retitle("Moja"), code: "MIESTNOSTI-NA-PRENAJOM", base_version: 1 }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.latest_version).toBe(2);
    expect(body.diff).toMatchObject({ from_version: 1, to_version: 2 });
    expect(store.rows).toHaveLength(2);
  });

  it("neplatné telo, neplatné XML a neznáma verzia", async () => {
    const route = await load(true);
    expect((await route.POST(post({ target: "nič", xml: XML }))).status).toBe(400);
    expect((await route.POST(post({ target: "studio", xml: "<ids/>" }))).status).toBe(400);
    expect((await route.POST(new Request(base, { method: "POST", headers: { host: "aim.test" }, body: "{" }))).status).toBe(400);
    expect(store.docs).toHaveLength(0);
    expect((await route.GET(new Request(`${base}?code=NIC`))).status).toBe(404);
    await route.POST(post({ target: "studio", xml: XML }));
    expect((await route.GET(new Request(`${base}?code=MIESTNOSTI-NA-PRENAJOM&version=9`))).status).toBe(404);
    expect((await route.GET(new Request(`${base}?code=MIESTNOSTI-NA-PRENAJOM&version=x`))).status).toBe(400);
  });
});
