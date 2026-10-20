/** Spoločné pomôcky testov uložených pohľadov (D-117): úložisko v pamäti a stav viewera. */

import type { SavedViewRow } from "./plan";
import type { SavedViewStore } from "./store";
import type { SavedViewDeps } from "./tools";

export const G1 = "2O2Fr$t4X7Zf8NOew3FLOH";
export const G2 = "1hOSvn6df7F8_7GcBWlS5a";
export const G3 = "0K3dl0Rbv5cvC0BzkOVRSm";
export const STOREY = "27hbQtAoP6qvoEYhPARoI7";

/** Odpoveď `view_state` forku s D-117 (skryté a izolované GUIDy). */
export const VIEW_STATE = {
  frame: "ifc_world",
  units: "m",
  mode: "3d",
  storey_guid: STOREY,
  section: { axis: "y", crosses: "IFC Z (výška)", position_percent: 40, coordinate: 4.2, flipped: false, show_gizmo: false },
  camera: {
    position: { x: 10, y: -5, z: 30 },
    target: { x: 10, y: -5, z: 3 },
    up: { x: 0, y: 1, z: 0 },
    projection: "orthographic",
    fov_deg: 45,
    ortho_size: 12.5,
    aspect: 1.6,
  },
  selection: { count: 1, guids: [G1], summary: { of: 1 } },
  hidden_count: 1,
  isolated_count: 2,
  hidden_guids: [G3],
  isolated_guids: [G1, G2],
};

export function memoryViewStore(): SavedViewStore & { rows: SavedViewRow[] } {
  const rows: SavedViewRow[] = [];
  let n = 0;
  const stamp = () => `2026-10-20T12:00:${String(n).padStart(2, "0")}Z`;
  const make = (w: Partial<SavedViewRow> & Pick<SavedViewRow, "name" | "viewpoint">, kind: SavedViewRow["kind"]): SavedViewRow => {
    n += 1;
    return {
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      kind,
      description: null,
      selection: [],
      hidden: [],
      isolated: null,
      model_revisions: {},
      author: null,
      created_at: stamp(),
      updated_at: stamp(),
      last_used_at: null,
      ...w,
    };
  };
  const saved = () => rows.filter((r) => r.kind === "saved");
  return {
    rows,
    async list() {
      return [...saved()].reverse();
    },
    async byName(name) {
      return saved().find((r) => r.name.toLowerCase() === name.toLowerCase()) ?? null;
    },
    async last() {
      return rows.find((r) => r.kind === "last") ?? null;
    },
    async create(w) {
      const row = make(w, "saved");
      rows.push(row);
      return row;
    },
    async update(id, patch) {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error("nie je");
      Object.assign(row, patch, { updated_at: stamp() });
      return row;
    },
    async remove(id) {
      rows.splice(rows.findIndex((r) => r.id === id), 1);
    },
    async setLast(w) {
      const i = rows.findIndex((r) => r.kind === "last");
      if (i >= 0) rows.splice(i, 1);
      rows.push(make(w, "last"));
    },
  };
}

export function testDeps(state: unknown = VIEW_STATE): SavedViewDeps & { store: ReturnType<typeof memoryViewStore> } {
  return {
    store: memoryViewStore(),
    viewState: async () => state,
    revisions: async () => ({ ASR: 7, VZT: 3 }),
    storeyLabel: async () => "2NP",
    now: () => new Date("2026-10-20T12:30:00Z"),
  };
}
