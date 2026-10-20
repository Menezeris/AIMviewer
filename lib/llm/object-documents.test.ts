/**
 * `get_object(include=documents)` (D-104 krok 2, D-115) nad napodobenou DB:
 * `v_object_documents` vracia riadky pre každú cestu (zóna aj nadradená zóna), tool z nich
 * spraví jeden riadok na dokument a stranu s najbližšou cestou a pri dokumente počty
 * objektov podľa typu a nositeľa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

/** Minimálny PostgREST builder: eq / in / is / order / limit / range + count head. */
function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let head = false;
  let order: string | null = null;
  let offset = 0;
  let limit = Infinity;
  const b = {
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      head = !!opts?.head;
      return b;
    },
    eq(col: string, v: unknown) {
      filters.push((r) => r[col] === v);
      return b;
    },
    in(col: string, vs: unknown[]) {
      filters.push((r) => vs.includes(r[col]));
      return b;
    },
    is(col: string, v: unknown) {
      filters.push((r) => (r[col] ?? null) === v);
      return b;
    },
    order(col: string) {
      // Prvé zoradenie rozhoduje; ďalšie (rozstrel pri stránkovaní) mock nepotrebuje.
      order ??= col;
      return b;
    },
    range(from: number, to: number) {
      offset = from;
      limit = to - from + 1;
      return b;
    },
    limit(n: number) {
      limit = n;
      return b;
    },
    then(resolve: (v: { data: Row[] | null; error: null; count: number }) => unknown) {
      let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (order) rows = [...rows].sort((a, z) => Number(a[order!]) - Number(z[order!]));
      // Ako PostgREST na Supabase: najviac 1000 riadkov v odpovedi bez ohľadu na limit.
      rows = rows.slice(offset, offset + Math.min(limit, 1000));
      return Promise.resolve(resolve({ data: head ? null : rows, error: null, count: rows.length }));
    },
  };
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: (t: string) => builder(t) }),
}));

const { AskToolRuntime } = await import("./tools");

const obj = (id: string, object_type: string, name: string, object_ref = name): Row => ({
  id, object_type, name, object_ref, ifc_type: null, predefined_type: null,
});

beforeEach(() => {
  tables.objects = [
    obj("sp", "space", "3.01"),
    obj("proj", "project", "OCB"),
    obj("nj", "zone", "NJ - 3NP"),
    obj("np", "zone", "Nájomné priestory"),
    obj("s1", "group", "S1"),
    obj("d1", "document", "D.1.1.01 Pôdorys 1NP", "OCB_SO01_ASR_D-1-1-01_PODORYS-1NP"),
    obj("d3", "document", "D.1.1.03 Pôdorys 3NP", "OCB_SO01_ASR_D-1-1-03_PODORYS-3NP"),
    obj("d9", "document", "D.1.1.09 Výpis skladieb", "OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB"),
    obj("r3", "document_reference", "S1 - Skladba strechy", "OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB#page=3"),
    obj("st", "asset", "ST01.20.0012"),
  ].map((o) => ({ ...o, valid_until: null }));
  const v = (o: Row): Row => ({ reference_id: null, page: null, via_nearest_id: o.via_id, ...o });
  tables.v_object_documents = [
    v({ object_id: "sp", object_type: "space", document_id: "d3", via: "zone", via_id: "nj", depth: 1 }),
    v({ object_id: "sp", object_type: "space", document_id: "d3", via: "zone", via_id: "np", via_nearest_id: "nj", depth: 2 }),
    v({ object_id: "sp", object_type: "space", document_id: "d1", via: "zone", via_id: "np", via_nearest_id: "nj", depth: 2 }),
    v({ object_id: "st", object_type: "asset", document_id: "d9", reference_id: "r3", page: 3, via: "group", via_id: "s1", depth: 2 }),
    v({ object_id: "np", object_type: "zone", document_id: "d3", via: "direct", via_id: null, depth: 0 }),
  ];
  // Druh dokumentu (D-104, typ informácie ISO 19650).
  tables.rel_external_reference_relationship = [{ id: "x1", from_id: "d9", to_id: "c1", valid_until: null }];
  tables.classification_references = [{ id: "c1", identification: "SH", name: "Výpis" }];
  tables.rel_associates_document = Array.from({ length: 44 }, (_, i) => ({
    id: `p${i}`, from_id: "proj", to_id: `x${i}`, valid_until: null,
  }));
});

async function run(idOrRef: string, include: string[] = ["documents"]) {
  const rt = new AskToolRuntime();
  const res = await rt.exec("get_object", { id_or_ref: idOrRef, include });
  expect(res.isError).toBe(false);
  return JSON.parse(res.content);
}

describe("get_object include=documents (D-104)", () => {
  it("objekt: dokument raz s najbližšou cestou, ďalší nositelia v also_via, dokumentácia stavby len počtom", async () => {
    const out = await run("3.01");
    expect(out.id).toBe("sp");
    expect(out.documents).toEqual([
      expect.objectContaining({
        document: "D.1.1.03 Pôdorys 3NP", via: "zone", via_name: "NJ - 3NP",
        also_via: ["Nájomné priestory"], deep_link: "/drawing/d3",
      }),
      expect.objectContaining({ document: "D.1.1.01 Pôdorys 1NP", via_name: "Nájomné priestory", through: "NJ - 3NP" }),
    ]);
    expect(out.project_documents).toBe(44);
  });

  it("objekt so stranou: deep_link otvorí dokument na strane", async () => {
    const out = await run("ST01.20.0012");
    expect(out.documents[0]).toMatchObject({
      document: "D.1.1.09 Výpis skladieb", type: "SH Výpis", page: 3, via: "group", via_name: "S1",
      deep_link: "/drawing/d9?page=3",
    });
  });

  it("dokument: objekty raz, počty podľa typu a nositeľa", async () => {
    const out = await run("OCB_SO01_ASR_D-1-1-03_PODORYS-3NP");
    expect(out.objects_total).toBe(2);
    expect(out.by_object_type).toEqual({ space: 1, zone: 1 });
    expect(out.by_holder).toEqual({ "zone: NJ - 3NP": 1, priamo: 1 });
  });

  it("dokument so stranami: počty po stranách a návod na prvky v 3D (D-104 krok 4)", async () => {
    const out = await run("OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB");
    expect(out.by_page).toEqual({ "3": 1 });
    expect(out.in_3d).toContain("document='OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB'");
    expect(out.in_3d).toContain("page=");
  });

  it("dokument nad strop odpovede PostgREST: stránkuje, nič neoreže", async () => {
    tables.v_object_documents = Array.from({ length: 2300 }, (_, i) => ({
      object_id: `a${i}`, object_type: "asset", document_id: "d1", reference_id: null, page: null,
      via: "floor", via_id: "f1", via_nearest_id: "f1", depth: 1,
    }));
    const out = await run("OCB_SO01_ASR_D-1-1-01_PODORYS-1NP");
    expect(out.objects_total).toBe(2300);
    expect(out.by_page).toBeUndefined();
  });

  it("odkaz na stranu hľadá cez reference_id", async () => {
    const out = await run("OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB#page=3");
    expect(out.objects_total).toBe(1);
    expect(out.sample[0]).toMatchObject({ id: "st", page: 3, via_name: "S1" });
  });

  it("staré include=drawings vráti dokumenty z modelu", async () => {
    const out = await run("ST01.20.0012", ["drawings"]);
    expect(out.documents[0]).toMatchObject({ document: "D.1.1.09 Výpis skladieb", page: 3 });
    expect(out.drawings).toBeUndefined();
  });
});

describe("style_in_3d document (D-104 krok 4)", () => {
  const decodeLens = (url: string) => {
    const ops = decodeURIComponent(new URL(url, "http://x").searchParams.get("ops") ?? "");
    const payload = ops.split(":")[2];
    return JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  };

  it("xray so stranou: symbolické pravidlo aim_document, GUIDy necestujú v URL", async () => {
    const rt = new AskToolRuntime();
    const res = await rt.exec("style_in_3d", { action: "xray", document: "D.1.1.09", page: 3 });
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content).groups[0]).toMatchObject({ document: "D.1.1.09 Výpis skladieb, s. 3" });
    const wire = decodeLens((rt.actions[0] as { url: string }).url);
    expect(wire.x).toBe(1);
    expect(wire.r[0].g[0].rules).toEqual([{ kind: "aim_document", id: "d9", page: 3 }]);
  });

  it("odkaz na stranu podľa object_ref je ten odkaz, nie celý dokument", async () => {
    const rt = new AskToolRuntime();
    await rt.exec("style_in_3d", { action: "isolate", document: "OCB_SO01_ASR_D-1-1-09_VYPIS-SKLADIEB#page=3" });
    expect(decodeLens((rt.actions[0] as { url: string }).url).r[0].g[0].rules).toEqual([{ kind: "aim_document", id: "r3" }]);
  });

  it("skrytie: prvky dokumentu z v_object_documents, len tie s geometriou", async () => {
    tables.ifc_guid_history = [
      { object_id: "sp", ifc_guid: "0SpaceGuid000000000001", source: "ifc:asr", valid_until: null },
      { object_id: "np", ifc_guid: "0ZoneGuid0000000000001", source: "ifc:asr", valid_until: null },
    ];
    const rt = new AskToolRuntime();
    const res = await rt.exec("style_in_3d", { action: "hide", document: "OCB_SO01_ASR_D-1-1-03_PODORYS-3NP" });
    expect(JSON.parse(res.content)).toMatchObject({ ok: true, elements: 1, document: "D.1.1.03 Pôdorys 3NP" });
    const ops = decodeURIComponent(new URL((rt.actions[0] as { url: string }).url, "http://x").searchParams.get("ops") ?? "");
    expect(ops).toContain("0SpaceGuid000000000001");
    expect(ops).not.toContain("0ZoneGuid0000000000001");
  });

  it("nejednoznačný dokument a strana bez dokumentu sú chyby vstupu", async () => {
    const rt = new AskToolRuntime();
    const amb = await rt.exec("style_in_3d", { action: "xray", document: "Pôdorys" });
    expect(amb.isError).toBe(true);
    expect(amb.content).toContain("nejednoznačný");
    const noDoc = await rt.exec("style_in_3d", { action: "xray", zone: "NJ - 3NP", page: 2 });
    expect(noDoc.isError).toBe(true);
    expect(noDoc.content).toContain("spolu s document");
  });
});
