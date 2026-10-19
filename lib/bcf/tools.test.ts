import { describe, expect, it, vi } from "vitest";

// Moduly sú server-only (D-026) - mimo RSC runtime treba marker odmockovať.
vi.mock("server-only", () => ({}));

import type { BcfStore, BcfTopicRow, BcfTopicWrite } from "./store";
import {
  BCF_TOOL_DEFINITIONS,
  bcfFirePayload,
  execBcfTool,
  normalizeStatus,
  topicRef,
  viewFromState,
  type BcfDeps,
  type CapturedView,
} from "./tools";

const NOW = new Date("2026-10-19T12:00:00Z");
const G1 = "2O2Fr$t4X7Zf8NOew3FLOH";
const G2 = "1hOSvn6df7F8_7GcBWlS5a";
const VIEW_STATE = {
  frame: "ifc_world",
  units: "m",
  mode: "3d",
  storey_guid: "27hbQtAoP6qvoEYhPARoI7",
  section: { axis: "y", coordinate: 10.2 },
  camera: { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } },
  selection: { count: 3, guids: [G1, G2], summary: { of: 3 } },
};

/** Úložisko v pamäti so správaním `model_tasks` (number, stav, komentáre). */
function memoryStore(seed: Partial<BcfTopicRow>[] = []) {
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
        .sort((a, b) => b.number - a.number);
      return { rows: hit.slice(0, f.limit), total: hit.length };
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
  };
  return { store, rows };
}

function deps(over: Partial<BcfDeps> = {}): BcfDeps & { fired: string[] } {
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

const run = async (name: string, args: Record<string, unknown>, d: BcfDeps) => {
  const res = await execBcfTool(name, args, d);
  return { ...res, json: res.isError ? null : JSON.parse(res.text) };
};

describe("definície (1:1 s @ifc-lite/mcp, D-087)", () => {
  it("mená a parametre originálu ostávajú, zápis má readOnlyHint false", () => {
    const byName = new Map(BCF_TOOL_DEFINITIONS.map((t) => [t.name, t]));
    expect([...byName.keys()]).toEqual([
      "bcf_topic_create",
      "bcf_topic_list",
      "bcf_topic_update",
      "bcf_topic_close",
      "bcf_viewpoint_create",
    ]);
    const props = (n: string) => Object.keys((byName.get(n)!.inputSchema as { properties: object }).properties);
    expect(props("bcf_topic_create")).toEqual(
      expect.arrayContaining(["title", "description", "author", "type", "status", "priority", "assigned_to", "labels"]),
    );
    expect(props("bcf_topic_update")).toEqual(expect.arrayContaining(["guid", "status", "priority", "comment", "modified_by"]));
    expect(props("bcf_viewpoint_create")).toEqual(expect.arrayContaining(["guid", "selection_global_ids"]));
    expect(byName.get("bcf_topic_list")!.annotations).toBeUndefined();
    for (const n of ["bcf_topic_create", "bcf_topic_update", "bcf_topic_close", "bcf_viewpoint_create"]) {
      expect(byName.get(n)!.annotations?.readOnlyHint).toBe(false);
    }
  });
});

describe("pomocné funkcie", () => {
  it("stav v BCF zápise sa prevedie, neznámy odmietne", () => {
    expect(normalizeStatus("In Progress")).toBe("in_progress");
    expect(normalizeStatus("Closed")).toBe("closed");
    expect(normalizeStatus(undefined)).toBeUndefined();
    expect(() => normalizeStatus("Done")).toThrow(/Neznámy stav/);
  });

  it("téma podľa guid alebo čísla", () => {
    expect(topicRef("#12")).toEqual({ number: 12 });
    expect(topicRef(7)).toEqual({ number: 7 });
    expect(topicRef("00000000-0000-4000-8000-0000000000AB")).toEqual({ id: "00000000-0000-4000-8000-0000000000ab" });
    expect(() => topicRef("abc")).toThrow(/guid/);
  });

  it("view_state -> pohľad: orezaný výber sa označí, GUID idú do components", () => {
    const v = viewFromState(VIEW_STATE);
    expect(v.selection).toEqual([G1, G2]);
    expect(v.viewpoint).toMatchObject({ mode: "3d", selection_count: 3, selection_truncated: true, section: { axis: "y" } });
    expect(v.viewpoint).not.toHaveProperty("selection");
  });
});

describe("bcf_topic_create", () => {
  it("bez prvkov vezme výber a pohľad z viewera; téma pre človeka session nespúšťa", async () => {
    const d = deps();
    const r = await run("bcf_topic_create", { title: "Potrubie koliduje s nosníkom", assigned_to: "Projektant VZT", priority: "High" }, d);
    expect(r.isError).toBe(false);
    expect(r.json.topic).toMatchObject({ number: 1, status: "open", components: 2, assigned_to: "Projektant VZT" });
    expect(r.json.viewpoint_saved).toBe(true);
    expect(r.json.session).toBeNull();
    expect(d.fired).toEqual([]);
  });

  it("zadané prvky majú prednosť pred výberom, pohľad sa uloží aj tak", async () => {
    const { store, rows } = memoryStore();
    const r = await run("bcf_topic_create", { title: "t", target_ids_or_refs: ["DD01.06.03"] }, deps({ store }));
    expect(r.json.topic.components).toBe(1);
    expect(rows[0].components).toEqual([G2]);
    expect(rows[0].viewpoint).toMatchObject({ source: "viewer" });
  });

  it("bez viewera vznikne téma bez pohľadu a povie prečo", async () => {
    const r = await run("bcf_topic_create", { title: "t", global_ids: [G1] }, deps({ captureView: async () => "viewer neodpovedal" }));
    expect(r.json.viewpoint_saved).toBe(false);
    expect(r.json.view_note).toMatch(/viewer neodpovedal/);
    expect(r.json.topic.components).toBe(1);
  });

  it("téma pre Claude spustí session, zapíše odkaz, stav a komentár", async () => {
    const { store, rows } = memoryStore();
    const d = deps({ store });
    const r = await run("bcf_topic_create", { title: "Doplň Pset_SpaceCommon.Reference", assigned_to: "Claude", model: "ASR" }, d);
    expect(r.json.session).toEqual({ url: "https://claude.ai/code/session_1" });
    expect(r.json.topic.status).toBe("in_progress");
    expect(rows[0].session_url).toBe("https://claude.ai/code/session_1");
    expect(rows[0].comments[0].comment).toMatch(/session_1/);
    expect(d.fired[0]).toContain("tema: #1");
    expect(d.fired[0]).toContain("model: ASR");
  });

  it("nad stropom a bez routine téma čaká", async () => {
    const busy = memoryStore([
      { status: "in_progress", session_url: "u1" },
      { status: "in_progress", session_url: "u2" },
    ]);
    const full = await run("bcf_topic_create", { title: "t", assigned_to: "claude" }, deps({ store: busy.store, maxSessions: 2 }));
    expect(full.json).toMatchObject({ session: null, queued: true });
    expect(full.json.session_note).toMatch(/#1, #2/);

    const none = await run("bcf_topic_create", { title: "t", assigned_to: "claude" }, deps({ fire: null }));
    expect(none.json).toMatchObject({ session: null, queued: true });
    expect(none.json.session_note).toMatch(/CLAUDE_BCF_ROUTINE_FIRE_URL/);
  });

  it("chybný vstup vráti chybu bez zápisu", async () => {
    const { store, rows } = memoryStore();
    expect((await run("bcf_topic_create", { title: " " }, deps({ store }))).isError).toBe(true);
    expect((await run("bcf_topic_create", { title: "t", due_date: "zajtra" }, deps({ store }))).text).toMatch(/YYYY-MM-DD/);
    expect(rows).toHaveLength(0);
  });
});

describe("bcf_topic_update / close / list / viewpoint", () => {
  it("priradenie Claudovi spustí session raz; komentár sa pripojí", async () => {
    const { store, rows } = memoryStore([{ title: "Okno bez FireRating" }]);
    const d = deps({ store });
    const r = await run("bcf_topic_update", { guid: "#1", assigned_to: "claude", comment: "Oprav podľa IDS" }, d);
    expect(r.json.session).toEqual({ url: "https://claude.ai/code/session_1" });
    expect(r.json.comment_added).toBe(true);
    expect(rows[0].comments.map((c) => c.comment)).toEqual(["Oprav podľa IDS", expect.stringMatching(/session_1/)]);
    const again = await run("bcf_topic_update", { guid: "#1", start_session: true }, d);
    expect(again.json.session).toBeNull();
    expect(again.json.session_note).toMatch(/už bola spustená/);
    expect(d.fired).toHaveLength(1);
  });

  it("session píše stav a výsledok; BCF stav sa prevedie", async () => {
    const { store, rows } = memoryStore([{ assigned_to: "claude", status: "in_progress", session_url: "u" }]);
    const r = await run("bcf_topic_update", { guid: rows[0].id, status: "Resolved", comment: "Revízia v74", modified_by: "Claude (OCB)" }, deps({ store }));
    expect(r.json.topic).toMatchObject({ status: "resolved", comments: 1 });
    expect(rows[0].modified_by).toBe("Claude (OCB)");
  });

  it("close uzavrie s komentárom; neznáma téma je chyba", async () => {
    const { store, rows } = memoryStore([{ title: "x" }]);
    const r = await run("bcf_topic_close", { guid: "1", comment: "Nie je chyba" }, deps({ store }));
    expect(r.json.topic.status).toBe("closed");
    expect(rows[0].comments).toHaveLength(1);
    const miss = await run("bcf_topic_close", { guid: "#9" }, deps({ store }));
    expect(miss.isError).toBe(true);
    expect(miss.text).toMatch(/#9 neexistuje/);
  });

  it("list filtruje a s guid vráti detail s pohľadom a GlobalId", async () => {
    const { store } = memoryStore([
      { title: "a", model: "ASR", components: [G1] },
      { title: "b", model: "VZT", assigned_to: "Claude", viewpoint: { source: "viewer" } },
    ]);
    const all = await run("bcf_topic_list", { model: "VZT" }, deps({ store }));
    expect(all.json).toMatchObject({ count: 1, topics: [{ number: 2, title: "b" }] });
    const mine = await run("bcf_topic_list", { assigned_to: "claude", status: "open" }, deps({ store }));
    expect(mine.json.count).toBe(1);
    const one = await run("bcf_topic_list", { guid: "#1" }, deps({ store }));
    expect(one.json.topic).toMatchObject({ number: 1, global_ids: [G1], global_ids_truncated: false, comment_list: [] });
  });

  it("viewpoint nahradí prvky a pohľad; bez prvkov aj pohľadu je to chyba", async () => {
    const { store, rows } = memoryStore([{ title: "x", components: [G1] }]);
    const r = await run("bcf_viewpoint_create", { guid: "#1", selection_global_ids: [G2] }, deps({ store }));
    expect(r.json).toMatchObject({ selection: 1, viewpoint_from_viewer: true });
    expect(rows[0].components).toEqual([G2]);
    const empty = await run("bcf_viewpoint_create", { guid: "#1", capture_view: false }, deps({ store }));
    expect(empty.isError).toBe(true);
  });
});

describe("payload routine", () => {
  it("nesie len číslo, guid a krátky opis; podrobnosti si session prečíta z témy", () => {
    const text = bcfFirePayload({
      id: "g",
      number: 4,
      model: null,
      topic_type: "Request",
      title: "Premenuj dvere",
      components: [G1, G2],
    } as BcfTopicRow);
    expect(text.split("\n")).toEqual([
      "BCF téma z MCP konektora AIM (D-099).",
      "tema: #4",
      "guid: g",
      "model: federacia",
      "typ: Request",
      "nazov: Premenuj dvere",
      "prvkov: 2",
    ]);
  });
});
