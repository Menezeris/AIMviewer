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

/** Minimálny PostgREST builder: eq / in / is / order / limit + count head. */
function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let head = false;
  let order: string | null = null;
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
      order = col;
      return b;
    },
    limit(n: number) {
      limit = n;
      return b;
    },
    then(resolve: (v: { data: Row[] | null; error: null; count: number }) => unknown) {
      let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (order) rows = [...rows].sort((a, z) => Number(a[order!]) - Number(z[order!]));
      rows = rows.slice(0, limit);
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
      document: "D.1.1.09 Výpis skladieb", page: 3, via: "group", via_name: "S1", deep_link: "/drawing/d9?page=3",
    });
  });

  it("dokument: objekty raz, počty podľa typu a nositeľa", async () => {
    const out = await run("OCB_SO01_ASR_D-1-1-03_PODORYS-3NP");
    expect(out.objects_total).toBe(2);
    expect(out.by_object_type).toEqual({ space: 1, zone: 1 });
    expect(out.by_holder).toEqual({ "zone: NJ - 3NP": 1, priamo: 1 });
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
