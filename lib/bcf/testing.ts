/** Spoločné pomôcky testov BCF (D-099): úložisko v pamäti a závislosti tools. */

import type { BcfStore, BcfTopicRow, BcfTopicWrite } from "./store";
import { viewFromState, type BcfDeps, type CapturedView } from "./tools";

export const NOW = new Date("2026-10-19T12:00:00Z");
export const G1 = "2O2Fr$t4X7Zf8NOew3FLOH";
export const G2 = "1hOSvn6df7F8_7GcBWlS5a";
export const VIEW_STATE = {
  frame: "ifc_world",
  units: "m",
  mode: "3d",
  storey_guid: "27hbQtAoP6qvoEYhPARoI7",
  section: { axis: "y", coordinate: 10.2 },
  camera: { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } },
  selection: { count: 3, guids: [G1, G2], summary: { of: 3 } },
};

/** Úložisko v pamäti so správaním `model_tasks` (number, stav, komentáre). */
export function memoryStore(seed: Partial<BcfTopicRow>[] = []) {
  const rows: BcfTopicRow[] = [];
  let n = 0;
  const make = (w: BcfTopicWrite & { title: string }): BcfTopicRow => {
    n += 1;
    return {
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      number: n,
      model: null,
      description: null,
      topic_type: "Issue",
      status: "open",
      priority: null,
      assigned_to: null,
      due_date: null,
      labels: [],
      stage: null,
      components: [],
      viewpoint: null,
      comments: [],
      author: null,
      modified_by: null,
      session_url: null,
      run_url: null,
      base_revision: null,
      result_revision: null,
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      ...w,
    };
  };
  for (const s of seed) rows.push(make({ title: "seed", ...(s as BcfTopicWrite) }));
  const store: BcfStore = {
    async create(w) {
      const r = make(w);
      rows.push(r);
      return r;
    },
    async get(ref) {
      const r = rows.find((x) => (ref.id ? x.id === ref.id : x.number === ref.number));
      return r ? { ...r } : null;
    },
    async list(f) {
      const hit = rows
        .filter((r) => !f.status || r.status === f.status)
        .filter((r) => !f.model || r.model === f.model)
        .filter((r) => !f.assigned_to || r.assigned_to?.toLowerCase() === f.assigned_to.toLowerCase())
        .sort((a, b) => (f.ascending ? a.number - b.number : b.number - a.number));
      const from = f.offset ?? 0;
      return { rows: hit.slice(from, from + f.limit), total: hit.length };
    },
    async update(id, patch) {
      const r = rows.find((x) => x.id === id);
      if (!r) throw new Error("nie je");
      Object.assign(r, patch);
      return { ...r };
    },
    async addComment(id, author, comment) {
      const r = rows.find((x) => x.id === id);
      if (!r) return null;
      const c = { guid: `c${r.comments.length + 1}`, author, date: NOW.toISOString(), comment };
      r.comments = [...r.comments, c];
      return c;
    },
    async runningSessions() {
      return rows.filter((r) => r.status === "in_progress" && r.session_url);
    },
    async vocabulary() {
      const d = (k: "topic_type" | "priority" | "stage" | "assigned_to") =>
        [...new Set(rows.map((r) => r[k]).filter((v): v is string => !!v))].sort();
      return { topic_type: d("topic_type"), priority: d("priority"), stage: d("stage"), assigned_to: d("assigned_to") };
    },
  };
  return { store, rows };
}

export function deps(over: Partial<BcfDeps> = {}): BcfDeps & { fired: string[] } {
  const fired: string[] = [];
  return {
    store: memoryStore().store,
    fire: async (text) => {
      fired.push(text);
      return { sessionId: "session_1", sessionUrl: "https://claude.ai/code/session_1" };
    },
    captureView: async (): Promise<CapturedView | string> => viewFromState(VIEW_STATE),
    resolve: async (input) => ((input.target_ids_or_refs as string[] | undefined)?.length ? [G2] : ((input.global_ids as string[]) ?? [])),
    now: () => NOW,
    maxSessions: 3,
    ...over,
    fired,
  };
}

