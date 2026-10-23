/** Spoločné pomôcky testov uložených pohľadov (D-122): úložisko v pamäti a stav viewera. */

import type { ViewWire } from "../viewer-views";

import type { SavedViewRow } from "./plan";
import type { SavedViewStore } from "./store";
import type { SavedViewDeps } from "./tools";
import { saveWire } from "./wire";

export const G1 = "2O2Fr$t4X7Zf8NOew3FLOH";
export const G2 = "1hOSvn6df7F8_7GcBWlS5a";
export const G3 = "0K3dl0Rbv5cvC0BzkOVRSm";
export const STOREY = "27hbQtAoP6qvoEYhPARoI7";

/** Odpoveď `view_state` forku s D-122 (skryté a izolované GUIDy). */
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
    async byId(id) {
      return saved().find((r) => r.id === id) ?? null;
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

/** Stav po `VIEW_CAPTURE`: viewer uložil pohľad a host ho zapísal (`written`) pod `view.id`. */
export const CAPTURED_ID = "5b5a6f0e-2b7b-4a53-8d3e-7a1f6c2d9e01";

export function testDeps(state: unknown = VIEW_STATE) {
  const store = memoryViewStore();
  const deps: SavedViewDeps & { store: ReturnType<typeof memoryViewStore>; captured: { name: string; capture_id: string }[]; changed: number; onCapture: (req: { name: string; capture_id: string }) => Promise<void> } = {
    store,
    captured: [] as { name: string; capture_id: string }[],
    changed: 0,
    // Nový fork: viewer uloží pohľad (`VIEW_SAVE`) a host ho zapíše do DB; `onCapture` nahrádza zápis hosta
    // (prázdny = zápis z viewera je vypnutý).
    onCapture: async (req: { name: string; capture_id: string }): Promise<void> => {
      await saveWire(store, wireView({ name: req.name }), {});
    },
    capture: async (req: { name: string; capture_id: string }) => {
      deps.captured.push(req);
      await deps.onCapture(req);
      return { ok: true as const, view: { id: CAPTURED_ID, name: req.name, objects: 120 } as { id: string; name?: string; objects?: number } | null | undefined, issues: [] as string[] };
    },
    notifyChanged: async () => {
      deps.changed += 1;
    },
    sleep: async () => undefined,
    viewState: async () => state,
    revisions: async () => ({ ASR: 7, VZT: 3 }),
    storeyLabel: async () => "2NP",
    now: () => new Date("2026-10-20T12:30:00Z"),
  };
  return deps;
}

/** Pohľad z panela Presentation (D-161) tak, ako ho pošle viewer: pôdorys 2NP, rez 1,2 m, celý viditeľný model. */
export function wireView(over: Partial<ViewWire> = {}): ViewWire {
  return {
    id: CAPTURED_ID,
    name: "Pôdorys 2NP",
    order: 0,
    transition_ms: 1000,
    source: "visible",
    camera: { position: [10, -5, 30], target: [10, -5, 3], up: [0, 1, 0], fov: 45, projection: "orthographic", ortho_size: 12.5 },
    section: {
      planes: [{ name: "Rez 1", axis: "y", position_percent: 40, coordinate: 4.2, flipped: false, enabled: true, show_gizmo: false, show_cap: true, show_outlines: true }],
      active: 0,
    },
    basket: { scope: "all", hidden_guids: [G3] },
    objects: 120,
    ...over,
  };
}
