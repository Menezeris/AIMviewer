import { describe, expect, it } from "vitest";

import { CAPTURED_ID, memoryViewStore, wireView } from "./testing";
import { deleteWire, freeName, listWires, renameWire, saveWire, wireOfRow } from "./wire";

const ID2 = "7c1d2e3f-0000-4000-8000-00000000abcd";
const ID3 = "7c1d2e3f-0000-4000-8000-00000000abce";

describe("zápis pohľadov z viewera (D-161)", () => {
  it("nový pohľad sa vytvorí s id z viewera a prepíše sa podľa neho", async () => {
    const store = memoryViewStore();
    expect(await saveWire(store, wireView({ name: "A" }), { ASR: 7 })).toEqual({ name: "A", renamed: false });
    const row = await store.byId(CAPTURED_ID);
    expect(row).toMatchObject({ id: CAPTURED_ID, name: "A", author: "viewer", model_revisions: { ASR: 7 }, selection: [], isolated: null });
    expect(await saveWire(store, wireView({ name: "A", objects: 5 }), {})).toEqual({ name: "A", renamed: false });
    expect(store.rows.filter((r) => r.kind === "saved")).toHaveLength(1);
    expect(wireOfRow((await store.byId(CAPTURED_ID))!)?.objects).toBe(5);
  });

  it("underlays (D-168, #325) sa uloží do viewpoint a vráti vo VIEWS_LOAD; pohľad bez neho ostane bez neho", async () => {
    const store = memoryViewStore();
    const underlays = { show: true, items: [{ document_id: "5b5a6f0e-2b7b-4a53-8d3e-7a1f6c2d9e01", visible: true, opacity: 0.4 }] };
    await saveWire(store, wireView({ name: "S podkladom", underlays }), {});
    await saveWire(store, wireView({ id: ID2, name: "Bez podkladu", order: 1 }), {});
    const [a, b] = await listWires(store);
    expect(a.underlays).toEqual(underlays);
    expect(b).not.toHaveProperty("underlays");
    expect(wireOfRow((await store.byId(CAPTURED_ID))!)?.underlays).toEqual(underlays);
  });

  it("kolízia mena (aj veľkosť písmen a 'Posledný pohľad') dostane príponu a vráti nové meno", async () => {
    const store = memoryViewStore();
    await saveWire(store, wireView({ name: "Basket 1" }), {});
    expect(await saveWire(store, wireView({ id: ID2, name: "basket 1" }), {})).toEqual({ name: "basket 1 2", renamed: true });
    expect(await saveWire(store, wireView({ id: ID3, name: "BASKET 1" }), {})).toEqual({ name: "BASKET 1 3", renamed: true });
    expect(await freeName(store, "Posledný pohľad")).toBe("Posledný pohľad 2");
    // premenovanie na vlastné meno nie je kolízia
    expect(await freeName(store, "Basket 1", CAPTURED_ID)).toBe("Basket 1");
  });

  it("poradie pásu: order, potom meno; riadky z D-122 sa do viewera neposielajú", async () => {
    const store = memoryViewStore();
    await store.create({ name: "Starý", viewpoint: { frame: "ifc_world", units: "m", mode: "3d", storey_guid: null, camera: null, section: null, selection_count: 0, hidden_count: 0, isolated_count: null } });
    await saveWire(store, wireView({ id: ID2, name: "B", order: 1 }), {});
    await saveWire(store, wireView({ name: "A", order: 0 }), {});
    expect((await listWires(store)).map((w) => w.name)).toEqual(["A", "B"]);
  });

  it("premenovanie a zmazanie; neexistujúci riadok nie je chyba", async () => {
    const store = memoryViewStore();
    await saveWire(store, wireView({ name: "A" }), {});
    await saveWire(store, wireView({ id: ID2, name: "B", order: 1 }), {});
    expect(await renameWire(store, CAPTURED_ID, "b")).toEqual({ name: "b 2" });
    expect(wireOfRow((await store.byId(CAPTURED_ID))!)?.name).toBe("b 2");
    expect(await renameWire(store, ID3, "X")).toBeNull();
    await deleteWire(store, ID3);
    await deleteWire(store, CAPTURED_ID);
    expect((await listWires(store)).map((w) => w.id)).toEqual([ID2]);
  });

  it("súbežné uloženie toho istého mena (unikátny index) sa zopakuje s inou príponou", async () => {
    const store = memoryViewStore();
    let fail = true;
    const create = store.create.bind(store);
    store.create = async (row) => {
      if (fail) {
        fail = false;
        await create({ ...row, id: ID3, name: row.name });
        throw new Error('duplicate key value violates unique constraint "uniq_saved_views_name"');
      }
      return create(row);
    };
    expect(await saveWire(store, wireView({ name: "A" }), {})).toEqual({ name: "A 2", renamed: true });
  });
});
